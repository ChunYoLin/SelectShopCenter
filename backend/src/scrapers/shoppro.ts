import * as cheerio from "cheerio";
import { fetchHtml, politeDelay } from "../utils/http";
import { normalizeText, parseYen, toAbsoluteUrl } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * colorme / Shop-Pro (GMO) 平台選品店的通用爬蟲。
 *
 * 已跨 8 家實測 (WASTE / COTYLE / THIRTY'THIRTY' / kiretto / mizuoka / hazy / kink…)：
 *  - 伺服器端渲染，但**編碼是 EUC-JP**，必須指定 encoding 否則日文亂碼。
 *  - 商品卡外層 class 因佈景各異 → 以商品連結 `a[href*="pid="]` 為錨點，往上找 li/div 當卡片。
 *  - 無單一「全部商品」頁 → 由首頁擷取分類連結 (?mode=cate / ?mode=grp)，各自 `&page=N` 翻頁。
 *  - Shop-Pro 無品牌欄位 → 由商品標題的【…】標記推斷品牌 (best-effort)。
 */
const MAX_PAGES = 200; // 單一分類最多翻頁數 (靠「無新商品」提前結束)
const EUC = { encoding: "euc-jp" } as const;

/** 標題【…】裡不是品牌的雜訊 token (季節/特價/日期/發售等) */
const NON_BRAND =
  /(A\/W|S\/S|SALE|RESTOCK|RE-?STOCK|RELEASE|COMING|PRE-?ORDER|予約|再入荷|入荷|受注|受付|販売|発売|NEW|OFF|％|%|ポイント|福袋|限定|会員|Available|RECOMMEND|\d{1,2}(st|nd|rd|th)|[月日時]|：|:)/i;

export class ShopProScraper implements ShopScraper {
  constructor(
    public readonly shopName: string,
    public readonly shopUrl: string,
  ) {}

  public async scrape(target: ScrapeTarget): Promise<ScrapedProduct[]> {
    const map = await this.scrapeMany([target.brand]);
    return map.get(target.brand) ?? [];
  }

  public async scrapeMany(brands: string[]): Promise<Map<string, ScrapedProduct[]>> {
    const wanted = new Map<string, string>();
    for (const b of brands) wanted.set(b.trim().toUpperCase(), b);
    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    for (const b of brands) buckets.set(b, new Map());
    await this.crawl((brand, sp) => {
      const orig = wanted.get(brand.toUpperCase());
      if (orig) buckets.get(orig)!.set(sp.productUrl, sp);
    });
    return this.bucketsToResult(buckets);
  }

  public async scrapeAllBrands(minCount = 1): Promise<Map<string, ScrapedProduct[]>> {
    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    await this.crawl((brand, sp) => {
      let bucket = buckets.get(brand);
      if (!bucket) buckets.set(brand, (bucket = new Map()));
      bucket.set(sp.productUrl, sp);
    });
    for (const [brand, bucket] of buckets) {
      if (bucket.size < minCount) buckets.delete(brand);
    }
    console.log(`[${this.shopName}] 共發現 ${buckets.size} 個品牌 (門檻 ≥${minCount} 筆)`);
    return this.bucketsToResult(buckets);
  }

  private async crawl(onProduct: (brand: string, sp: ScrapedProduct) => void): Promise<void> {
    const home = await fetchHtml(this.shopUrl, EUC);
    const categories = this.extractCategoryUrls(home);
    console.log(`[${this.shopName}] 找到 ${categories.length} 個分類`);

    const seen = new Set<string>(); // 全域 pid 去重 (分類會重疊)
    for (const cat of categories) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `${cat}${cat.includes("?") ? "&" : "?"}page=${page}`;
        const html = await fetchHtml(url, EUC);
        const cards = this.extractCards(html, url);
        let added = 0;
        for (const { brand, sp } of cards) {
          if (seen.has(sp.productUrl)) continue;
          seen.add(sp.productUrl);
          onProduct(brand, sp);
          added++;
        }
        if (cards.length === 0 || added === 0) break; // 空頁/重複頁 → 換下一分類
        await politeDelay();
      }
    }
    console.log(`[${this.shopName}] 掃描完成，共 ${seen.size} 件不重複商品`);
  }

  /** 由首頁擷取分類/群組列表頁 URL (去重) */
  private extractCategoryUrls(html: string): string[] {
    const $ = cheerio.load(html);
    const urls = new Set<string>();
    $('a[href*="mode=cate"], a[href*="mode=grp"]').each((_i, a) => {
      const href = $(a).attr("href");
      const abs = toAbsoluteUrl(href ?? null, this.shopUrl);
      // 只保留列表頁 (含 cbid 或 gid)，去掉 csid 差異造成的重複
      if (abs && /mode=(cate|grp)/.test(abs)) urls.add(abs.split("&page=")[0]!);
    });
    return [...urls];
  }

  private extractCards(
    html: string,
    pageUrl: string,
  ): Array<{ brand: string; sp: ScrapedProduct }> {
    const $ = cheerio.load(html);
    const out: Array<{ brand: string; sp: ScrapedProduct }> = [];
    const seenPid = new Set<string>();

    $('a[href*="pid="]').each((_i, a) => {
      const href = $(a).attr("href") ?? "";
      const pid = href.match(/pid=(\d+)/)?.[1];
      if (!pid || seenPid.has(pid)) return;
      seenPid.add(pid);

      const card = $(a).closest("li");
      const scope = card.length ? card : $(a).closest("div");
      const img = scope.find("img").first();
      const alt = img.attr("alt") ?? "";
      const name = normalizeText(alt || $(a).text());
      if (name === "") return;

      const priceText = (scope.text().match(/[\d,]+\s*円/) ?? [""])[0];
      const soldOut = /sold\s*out|売り切れ|在庫なし|is-soldout|mask-soldout/i.test(
        scope.html() ?? "",
      );

      out.push({
        brand: this.brandFromTitle(name),
        sp: {
          name,
          priceYen: parseYen(priceText),
          imageUrl: toAbsoluteUrl(img.attr("src") ?? null, pageUrl),
          productUrl: `${this.shopUrl.replace(/\/$/, "")}/?pid=${pid}`,
          inStock: !soldOut,
        },
      });
    });
    return out;
  }

  /** 從標題的【…】標記推斷品牌；濾掉季節/特價/日期等雜訊 token，取不到則以店名為品牌 */
  private brandFromTitle(title: string): string {
    const tokens = [...title.matchAll(/[【\[]([^】\]]{1,30})[】\]]/g)].map((m) => m[1]!.trim());
    for (const t of tokens) {
      if (t && !NON_BRAND.test(t)) return t;
    }
    return this.shopName;
  }

  private bucketsToResult(
    buckets: Map<string, Map<string, ScrapedProduct>>,
  ): Map<string, ScrapedProduct[]> {
    const result = new Map<string, ScrapedProduct[]>();
    for (const [brand, bucket] of buckets) result.set(brand, [...bucket.values()]);
    return result;
  }
}
