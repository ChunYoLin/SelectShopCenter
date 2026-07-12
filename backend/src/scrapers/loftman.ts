import * as cheerio from "cheerio";
import { config } from "../config";
import { fetchHtml, politeDelay } from "../utils/http";
import { normalizeText, parseYen, toAbsoluteUrl } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * LOFTMAN (https://loftman.co.jp/shop/) 爬蟲。
 *
 * 已對照實際站台驗證 (2026-07)：
 *  - ASP.NET EC，品牌分類頁**伺服器端渲染、無 WAF 挑戰** → 直接用 HTTP fetch +
 *    **Cheerio** 解析即可，不需瀏覽器 (與 ARKnets 同平台主題，但 ARKnets 有 WAF 故需 Playwright)。
 *  - 品牌分類頁：`/shop/c/c{brand}/`；分頁為 `/shop/c/c{brand}_p{N}/` (第 2 頁起)。
 *  - 有販售 AURALEE (`/shop/c/cauralee/`，約 41 筆)。
 */
const SELECTORS = {
  productCard: "dl.block-thumbnail-t--goods",
  nameLink: ".block-thumbnail-t--goods-name a", // 商品名 + 詳細頁連結
  price: ".js-enhanced-ecommerce-goods-price", // 現售價 "PRICE : ￥32,340"
  image: "img", // 縮圖 (lazy-load，圖網址在 data-src)
  soldOut: ".block-icon--auto-out-of-stock", // 售罄標記 (SOLD OUT)
} as const;

export class LoftmanScraper implements ShopScraper {
  public readonly shopName = "LOFTMAN";
  public readonly shopUrl = "https://loftman.co.jp/shop/";

  public async scrape(target: ScrapeTarget): Promise<ScrapedProduct[]> {
    const byUrl = new Map<string, ScrapedProduct>(); // 以 productUrl 去重

    for (let page = 1; page <= config.scraper.maxPages + 1; page++) {
      const url = this.pageUrl(target.listUrl, page);
      const html = await fetchHtml(url);
      const items = this.extractProducts(html, url);

      // 統計本頁新增的「不重複」商品；末頁之後的分頁會回傳與前頁相同內容
      let added = 0;
      for (const item of items) {
        if (byUrl.has(item.productUrl)) continue;
        byUrl.set(item.productUrl, item);
        added++;
      }
      console.log(
        `[LOFTMAN] 第 ${page} 頁: ${items.length} 筆，新增 ${added} 筆 (累計 ${byUrl.size})`,
      );

      // 沒有新商品 (空頁或重複頁) 即視為到底
      if (added === 0) break;
      await politeDelay();
    }

    console.log(`[LOFTMAN] ${target.brand} 共抓取 ${byUrl.size} 筆商品`);
    return [...byUrl.values()];
  }

  /**
   * 由品牌頁 URL 推導第 N 頁 URL。
   * 例: https://loftman.co.jp/shop/c/cauralee/ + page 2 → .../c/cauralee_p2/
   */
  private pageUrl(listUrl: string, page: number): string {
    if (page <= 1) return listUrl;
    const slug = listUrl.replace(/\/+$/, ""); // 去除結尾斜線 → .../cauralee
    return `${slug}_p${page}/`;
  }

  /** 用 Cheerio 解析商品卡片 */
  private extractProducts(html: string, pageUrl: string): ScrapedProduct[] {
    const $ = cheerio.load(html);
    const out: ScrapedProduct[] = [];

    $(SELECTORS.productCard).each((_i, el) => {
      const card = $(el);
      const link = card.find(SELECTORS.nameLink).first();
      const href = link.attr("href") ?? null;
      const name = normalizeText(link.attr("title") ?? link.text());

      const img = card.find(SELECTORS.image).first();
      const imgSrc = img.attr("data-src") ?? img.attr("src") ?? null;

      const productUrl = toAbsoluteUrl(href, pageUrl);
      if (!productUrl || name === "") return; // 無效卡片跳過

      out.push({
        name,
        priceYen: parseYen(card.find(SELECTORS.price).first().text()),
        imageUrl: toAbsoluteUrl(imgSrc, pageUrl),
        productUrl,
        inStock: card.find(SELECTORS.soldOut).length === 0,
      });
    });

    return out;
  }
}
