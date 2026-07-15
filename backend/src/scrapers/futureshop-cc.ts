import * as cheerio from "cheerio";
import { config } from "../config";
import { fetchHtml, politeDelay } from "../utils/http";
import { normalizeText, parseYen, toAbsoluteUrl } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * futureshop「Commerce Creator」(fs-c-* 樣板) 選品店爬蟲。
 *
 * 與 ARKnets/LOFTMAN 的舊版 futureshop 樣板 (block-thumbnail-t) 不同，這是新版樣板，
 * class 皆以 `fs-c-` 開頭，商品頁網址為 `/c/{分類}/gd{id}`、圖片 lazy-load 於 `data-layzr`。
 *
 * 已於 1LDK (onlinestore.1ldkshop.com) 實測。該站以「分類」組織商品(mens/womans/…)，
 * 品牌放在商品卡的 catch-copy(例:"UNIVERSAL PRODUCTS. for 1LDK")，
 * 故策略為：分頁掃各分類根頁，逐商品取出品牌並分桶。
 */
const SELECTORS = {
  card: ".fs-c-productListItem",
  // 商品連結：1LDK 為 /c/{分類}/gd{id}，MAKES 為 /c/{品牌}/{商品碼}，兩者皆含 "/c/"
  link: '.fs-c-productListItem__image a[href], .fs-c-productName a[href], a[href*="/c/"]',
  name: ".fs-c-productName__name",
  copy: ".fs-c-productName__copy", // catch-copy，內含品牌
  priceSelling: ".fs-c-productPrice--selling .fs-c-price__value",
  priceAny: ".fs-c-price__value",
  image: "img.fs-c-productListItem__image__image, img",
} as const;

export class FutureshopCcScraper implements ShopScraper {
  /**
   * @param shopName       選品店名稱
   * @param shopUrl        首頁 (結尾含 "/")
   * @param categoryPaths  要掃描的分類根路徑，例: ["/c/mens", "/c/womans"]
   */
  constructor(
    public readonly shopName: string,
    public readonly shopUrl: string,
    private readonly categoryPaths: string[],
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

    await this.crawlCategories((brand, sp) => {
      const orig = wanted.get(brand.toUpperCase());
      if (!orig) return;
      buckets.get(orig)!.set(sp.productUrl, sp);
    });
    return this.bucketsToResult(buckets);
  }

  public async scrapeAllBrands(minCount = 1): Promise<Map<string, ScrapedProduct[]>> {
    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    await this.crawlCategories((brand, sp) => {
      let bucket = buckets.get(brand);
      if (!bucket) {
        bucket = new Map();
        buckets.set(brand, bucket);
      }
      bucket.set(sp.productUrl, sp);
    });
    for (const [brand, bucket] of buckets) {
      if (bucket.size < minCount) buckets.delete(brand);
    }
    console.log(`[${this.shopName}] 共發現 ${buckets.size} 個品牌 (門檻 ≥${minCount} 筆)`);
    return this.bucketsToResult(buckets);
  }

  /** 逐分類分頁掃描；以 productUrl 全域去重，對每個商品呼叫 onProduct(brand, product) */
  private async crawlCategories(
    onProduct: (brand: string, sp: ScrapedProduct) => void,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const cat of this.categoryPaths) {
      for (let page = 1; page <= config.scraper.shopifyMaxPages; page++) {
        const url = `${this.shopUrl.replace(/\/$/, "")}${cat}?page=${page}`;
        const html = await fetchHtml(url);
        const cards = this.extractCards(html, url);
        let added = 0;
        for (const { brand, sp } of cards) {
          if (seen.has(sp.productUrl)) continue;
          seen.add(sp.productUrl);
          onProduct(brand, sp);
          added++;
        }
        console.log(
          `[${this.shopName}] ${cat} p${page}: ${cards.length} 卡片，新增 ${added} (累計 ${seen.size})`,
        );
        if (cards.length === 0 || added === 0) break; // 空頁或無新商品 → 換下一分類
        await politeDelay();
      }
    }
  }

  private extractCards(
    html: string,
    pageUrl: string,
  ): Array<{ brand: string; sp: ScrapedProduct }> {
    const $ = cheerio.load(html);
    const out: Array<{ brand: string; sp: ScrapedProduct }> = [];

    $(SELECTORS.card).each((_i, el) => {
      const card = $(el);
      const link = card.find(SELECTORS.link).first();
      const href = link.attr("href") ?? null;
      const productUrl = toAbsoluteUrl(href, pageUrl);
      const name = normalizeText(card.find(SELECTORS.name).first().text());
      if (!productUrl || name === "") return;

      const priceText =
        card.find(SELECTORS.priceSelling).first().text() ||
        card.find(SELECTORS.priceAny).first().text();
      const img = card.find(SELECTORS.image).first();
      const imgSrc = img.attr("data-layzr") ?? img.attr("data-src") ?? img.attr("src") ?? null;
      const soldOut = /sold\s*out|売り切れ|在庫[な無]/i.test(card.text());

      out.push({
        brand: this.brandFromCopy(card.find(SELECTORS.copy).first().text()),
        sp: {
          name,
          priceYen: parseYen(priceText),
          imageUrl: toAbsoluteUrl(imgSrc, pageUrl),
          productUrl,
          inStock: !soldOut,
        },
      });
    });
    return out;
  }

  /**
   * 從 catch-copy 取品牌。不同店的 copy 格式不同：
   *  - 1LDK: "UNIVERSAL PRODUCTS. for 1LDK" → 取 " for " 之前
   *  - MAKES: "COMOLI ／ コモリ"            → 取全形 "／" 之前
   * 取不到則以店名為品牌。
   */
  private brandFromCopy(copy: string): string {
    let b = normalizeText(copy);
    const slash = b.indexOf("／"); // 全形斜線 (品牌 ／ 日文讀音)
    if (slash >= 0) b = b.slice(0, slash);
    const forIdx = b.search(/\sfor\s/i); // "{BRAND} for {店名}"
    if (forIdx >= 0) b = b.slice(0, forIdx);
    b = b.replace(/\s*[×].*$/, ""); // "{BRAND} × {店名}"
    b = b.replace(/\s*[（(].*$/, ""); // 去掉後綴的日文讀音 "(ユニバーサル…)"
    return b.trim() || this.shopName;
  }

  private bucketsToResult(
    buckets: Map<string, Map<string, ScrapedProduct>>,
  ): Map<string, ScrapedProduct[]> {
    const result = new Map<string, ScrapedProduct[]>();
    for (const [brand, bucket] of buckets) result.set(brand, [...bucket.values()]);
    return result;
  }
}
