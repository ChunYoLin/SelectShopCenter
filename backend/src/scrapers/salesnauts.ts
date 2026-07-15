import * as cheerio from "cheerio";
import { fetchHtml, politeDelay } from "../utils/http";
import { normalizeText, parseYen, toAbsoluteUrl } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * Salesnauts / ItemBox 平台選品店爬蟲。
 *
 * 已於 ACRMTSM / MARK / chemical-c 實測，三家 DOM 完全相同：
 *  - 伺服器端渲染 (UTF-8)、無 WAF。
 *  - 全站商品列表：`/products?page=N` (1-based)，翻頁到空頁為止。
 *  - 品牌乾淨地放在 `span.brand-name`，適合跨店聚合。
 */
const SELECTORS = {
  card: "li.product-list__item",
  link: 'a[href^="/products/detail/"]',
  name: "h2.product-name",
  brand: "span.brand-name",
  price: "span.price",
  image: "img.item-images",
  statuses: "ul.statuses",
} as const;

// 單一分類/全站最多翻頁數 (ACRMTSM 實測約 160 頁，留足餘裕，靠空頁自然結束)
const MAX_PAGES = 400;

export class SalesnautsScraper implements ShopScraper {
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
      if (!orig) return;
      buckets.get(orig)!.set(sp.productUrl, sp);
    });
    return this.bucketsToResult(buckets);
  }

  public async scrapeAllBrands(minCount = 1): Promise<Map<string, ScrapedProduct[]>> {
    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    await this.crawl((brand, sp) => {
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

  /** 逐頁掃描 /products?page=N，以 productUrl 去重 */
  private async crawl(onProduct: (brand: string, sp: ScrapedProduct) => void): Promise<void> {
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${this.shopUrl.replace(/\/$/, "")}/products?page=${page}`;
      const html = await fetchHtml(url);
      const cards = this.extractCards(html, url);
      let added = 0;
      for (const { brand, sp } of cards) {
        if (seen.has(sp.productUrl)) continue;
        seen.add(sp.productUrl);
        onProduct(brand, sp);
        added++;
      }
      if (page % 20 === 0 || cards.length === 0) {
        console.log(`[${this.shopName}] p${page}: ${cards.length} 卡片 (累計 ${seen.size})`);
      }
      if (cards.length === 0 || added === 0) break; // 空頁或重複頁 → 結束
      await politeDelay();
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
      const productUrl = toAbsoluteUrl(link.attr("href") ?? null, pageUrl);
      const name = normalizeText(card.find(SELECTORS.name).first().text());
      if (!productUrl || name === "") return;

      const brand = normalizeText(card.find(SELECTORS.brand).first().text()) || this.shopName;
      const img = card.find(SELECTORS.image).first();
      const imgSrc = img.attr("data-image-original") ?? img.attr("src") ?? null;
      // 售罄：卡片 class 含 soldout，或狀態列含「在庫なし」
      const soldOut =
        card.hasClass("soldout") ||
        /在庫なし|sold\s*out|売り切れ/i.test(card.find(SELECTORS.statuses).text());

      out.push({
        brand,
        sp: {
          name,
          priceYen: parseYen(card.find(SELECTORS.price).first().text()),
          imageUrl: toAbsoluteUrl(imgSrc, pageUrl),
          productUrl,
          inStock: !soldOut,
        },
      });
    });
    return out;
  }

  private bucketsToResult(
    buckets: Map<string, Map<string, ScrapedProduct>>,
  ): Map<string, ScrapedProduct[]> {
    const result = new Map<string, ScrapedProduct[]>();
    for (const [brand, bucket] of buckets) result.set(brand, [...bucket.values()]);
    return result;
  }
}
