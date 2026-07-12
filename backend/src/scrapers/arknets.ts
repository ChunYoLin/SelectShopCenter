import { chromium, type Browser, type Page } from "playwright";
import { config } from "../config";
import { politeDelay, sleep } from "../utils/http";
import { normalizeText, parseYen, toAbsoluteUrl } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * ARKnets (https://www.arknets.co.jp/) 爬蟲。
 *
 * 已對照實際線上 DOM 驗證 (2026-07)：
 *  - 站台位於 AWS WAF「JavaScript challenge」後方，靜態 curl/Cheerio 會收到
 *    HTTP 202 空白挑戰頁，因此**必須用真實瀏覽器 (Playwright)** 執行挑戰 JS。
 *  - 品牌頁網址：https://www.arknets.co.jp/brand/{BRAND_CODE}/   例: COMOLI = B1023
 *  - 商品卡片為 <dl class="block-thumbnail-t--goods">，圖片為 lazy-load，
 *    需捲動頁面觸發載入。
 */
const SELECTORS = {
  // 商品列表中的每一張商品卡片
  productCard: "dl.block-thumbnail-t--goods",
  // 卡片內元素 (相對於 productCard)
  detailLink: "a[href^='/g/g']", // 商品詳細頁連結
  brandName: ".block-thumbnail-t--goods-name", // 品牌 (例: COMOLI)
  itemName: ".variation-name", // 商品名稱 (例: コットンメッシュ ノースリーブ)
  price: ".js-enhanced-ecommerce-goods-price", // 價格 (例: ￥19,800)
  image: "dt img", // 商品縮圖
  // 售罄標記 (站方可能以下列任一 class 呈現；找不到即視為有庫存)
  soldOut: ".block-icon--soldout, .soldout, .icon-soldout, .stock-none",
  // 下一頁 (品牌頁多為單頁載入，保留以支援有分頁的品牌)
  nextPage: "a[rel='next'], .pager .next a, a.next",
} as const;

export class ArknetsScraper implements ShopScraper {
  public readonly shopName = "ARKnets";
  public readonly shopUrl = "https://www.arknets.co.jp/";

  public async scrape(target: ScrapeTarget): Promise<ScrapedProduct[]> {
    const browser: Browser = await chromium.launch({
      headless: config.scraper.headless,
    });

    try {
      const context = await browser.newContext({
        userAgent: config.scraper.userAgent, // 偽裝一般桌機瀏覽器
        locale: "ja-JP",
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();

      const all: ScrapedProduct[] = [];
      const seen = new Set<string>(); // 以 productUrl 去重
      let url: string | null = target.listUrl;
      let pageNo = 0;

      while (url && pageNo < config.scraper.maxPages) {
        pageNo += 1;
        console.log(`[ARKnets] 第 ${pageNo} 頁: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        const appeared = await this.waitForProducts(page);
        if (!appeared) {
          console.warn("[ARKnets] 逾時仍未出現商品卡片 (可能 WAF 挑戰未過或此頁無商品)");
          break;
        }
        await this.autoScroll(page); // 觸發圖片 lazy-load

        const items = await this.extractProducts(page, url);
        for (const item of items) {
          if (seen.has(item.productUrl)) continue;
          seen.add(item.productUrl);
          all.push(item);
        }

        url = await this.findNextPage(page, url);
        if (url) await politeDelay(); // 禮貌延遲，避免過度請求
      }

      console.log(`[ARKnets] 共抓取 ${all.length} 筆商品`);
      return all;
    } finally {
      await browser.close();
    }
  }

  /**
   * 等待商品卡片出現。
   * ARKnets 的 AWS WAF 挑戰會先回一個過場頁，由瀏覽器執行 JS 後才 reload 出真頁面，
   * 因此以輪詢方式等待，比單次 waitForSelector 更穩定。
   */
  private async waitForProducts(page: Page): Promise<boolean> {
    const deadline = 45_000;
    const step = 1_500;
    for (let waited = 0; waited < deadline; waited += step) {
      const count = await page
        .locator(SELECTORS.productCard)
        .count()
        .catch(() => 0);
      if (count > 0) return true;
      await sleep(step);
    }
    return false;
  }

  /** 捲動到底部觸發 lazy-load，確保所有商品圖片與卡片都進入 DOM */
  private async autoScroll(page: Page): Promise<void> {
    let previousCount = -1;
    for (let i = 0; i < 15; i++) {
      const count = await page.locator(SELECTORS.productCard).count();
      await page.mouse.wheel(0, 3000);
      await sleep(900);
      // 連續兩輪卡片數不再增加即視為載入完畢
      if (count === previousCount) break;
      previousCount = count;
    }
  }

  /** 在頁面 DOM 內抽取商品卡片並清洗 */
  private async extractProducts(page: Page, pageUrl: string): Promise<ScrapedProduct[]> {
    const raw = await page.$$eval(
      SELECTORS.productCard,
      (cards, sel) =>
        cards.map((card) => {
          const q = (s: string): Element | null => card.querySelector(s);
          const link = q(sel.detailLink) as HTMLAnchorElement | null;
          const img = q(sel.image) as HTMLImageElement | null;
          return {
            href: link?.getAttribute("href") ?? null,
            // 商品名稱優先取 .variation-name，退回連結 title
            name: q(sel.itemName)?.textContent ?? link?.getAttribute("title") ?? null,
            price: q(sel.price)?.textContent ?? null,
            img: img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? null,
            soldOut: q(sel.soldOut) !== null,
          };
        }),
      SELECTORS,
    );

    const cleaned: ScrapedProduct[] = [];
    for (const r of raw) {
      const productUrl = toAbsoluteUrl(r.href, pageUrl);
      const name = normalizeText(r.name);
      if (!productUrl || name === "") continue; // 無效卡片跳過

      cleaned.push({
        name,
        priceYen: parseYen(r.price),
        imageUrl: toAbsoluteUrl(r.img, pageUrl),
        productUrl,
        inStock: !r.soldOut,
      });
    }
    return cleaned;
  }

  /** 解析下一頁 URL，沒有則回傳 null */
  private async findNextPage(page: Page, pageUrl: string): Promise<string | null> {
    const href = await page
      .$eval(SELECTORS.nextPage, (el) => el.getAttribute("href"))
      .catch(() => null);
    return toAbsoluteUrl(href, pageUrl);
  }
}
