import { config } from "../config";
import { fetchJson, politeDelay } from "../utils/http";
import { normalizeBrandName, normalizeText, parseYen } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * 通用 Shopify 選品店爬蟲引擎。
 *
 * 任何 Shopify 商店都能重用：直接打公開的 `/products.json` API 取結構化資料，
 * 不需瀏覽器。新增一家 Shopify 店只要 `new ShopifyScraper(name, url)` 即可。
 *
 * 已於 diverse (diverse-web.com) 實測：
 *  - 分頁掃全目錄 (250 筆/頁)，以 `vendor` 欄位分桶成品牌。
 *  - 高頻請求會回 HTTP 429，由 fetchJson 退避重試 + politeDelay 處理。
 */

/** Shopify products.json 回應中，我們用得到的欄位 */
interface ShopifyVariant {
  price: string; // 例: "10500" (日圓，整數字串)
  available: boolean;
}
interface ShopifyProduct {
  title: string;
  handle: string; // 商品頁 slug → /products/{handle}
  vendor: string; // 品牌
  images: { src: string }[];
  variants: ShopifyVariant[];
}
interface ProductsJsonResponse {
  products: ShopifyProduct[];
}

export class ShopifyScraper implements ShopScraper {
  /**
   * @param shopName  選品店名稱 (DB 主鍵 / CLI key)
   * @param shopUrl   商店首頁 (結尾需含 "/")，例: "https://www.diverse-web.com/"
   */
  constructor(
    public readonly shopName: string,
    public readonly shopUrl: string,
  ) {}

  /** 單一品牌 (相容 ShopScraper 介面)：內部走多品牌流程再取該品牌 */
  public async scrape(target: ScrapeTarget): Promise<ScrapedProduct[]> {
    const map = await this.scrapeMany([target.brand]);
    return map.get(target.brand) ?? [];
  }

  /**
   * 一次掃描整個 Shopify 目錄，把指定的多個品牌 (vendor) 一起分桶回傳。
   * 不論要幾個品牌，都只掃一趟目錄，大幅省下重複掃描。
   */
  public async scrapeMany(brands: string[]): Promise<Map<string, ScrapedProduct[]>> {
    // 正規化品牌名 → 原始輸入名 (回傳 Map 用原始名當 key)
    const wanted = new Map<string, string>();
    for (const b of brands) wanted.set(normalizeBrandName(b), b);

    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    for (const b of brands) buckets.set(b, new Map());

    await this.crawlCatalog((p) => {
      const origName = wanted.get(normalizeBrandName(p.vendor));
      if (!origName) return; // 非目標品牌
      const sp = this.toScrapedProduct(p);
      buckets.get(origName)!.set(sp.productUrl, sp);
    });

    return this.bucketsToResult(buckets);
  }

  /**
   * 一次掃描整個目錄，把「站上所有品牌」分桶回傳。
   * minCount：商品數少於此值的品牌會被略過 (過濾一次性聯名 / 雜訊品牌)。
   */
  public async scrapeAllBrands(minCount = 1): Promise<Map<string, ScrapedProduct[]>> {
    const buckets = new Map<string, Map<string, ScrapedProduct>>();

    await this.crawlCatalog((p) => {
      const vendor = normalizeText(p.vendor);
      if (!vendor) return;
      const sp = this.toScrapedProduct(p);
      let bucket = buckets.get(vendor);
      if (!bucket) {
        bucket = new Map();
        buckets.set(vendor, bucket);
      }
      bucket.set(sp.productUrl, sp);
    });

    // 套用最少商品數門檻
    for (const [vendor, bucket] of buckets) {
      if (bucket.size < minCount) buckets.delete(vendor);
    }
    console.log(`[${this.shopName}] 共發現 ${buckets.size} 個品牌 (門檻 ≥${minCount} 筆)`);
    return this.bucketsToResult(buckets);
  }

  /** 分頁掃描整個 Shopify 目錄，對每個商品呼叫 onProduct */
  private async crawlCatalog(onProduct: (p: ShopifyProduct) => void): Promise<void> {
    const maxPages = config.scraper.shopifyMaxPages;
    let reachedEnd = false;
    let lastPage = 0;
    let total = 0;

    for (let page = 1; page <= maxPages; page++) {
      lastPage = page;
      const url = `${this.shopUrl}products.json?limit=250&page=${page}`;
      const data = await fetchJson<ProductsJsonResponse>(url);
      const products = data.products ?? [];
      if (products.length === 0) {
        reachedEnd = true; // 掃到空白頁 = 已到目錄尾端
        break;
      }
      total += products.length;
      for (const p of products) onProduct(p);
      if (page % 10 === 0) console.log(`[${this.shopName}] 第 ${page} 頁: 已掃 ${total} 筆`);

      await politeDelay(); // 禮貌延遲，降低被限流機率
    }

    if (!reachedEnd) {
      console.warn(
        `[${this.shopName}] ⚠️ 掃描於第 ${lastPage} 頁達到上限 (SHOPIFY_MAX_PAGES=${maxPages}) ` +
          `仍未到目錄尾端，資料可能不完整；請調高 SHOPIFY_MAX_PAGES。`,
      );
    }
  }

  /** 把「去重桶」轉為回傳用的陣列 Map */
  private bucketsToResult(
    buckets: Map<string, Map<string, ScrapedProduct>>,
  ): Map<string, ScrapedProduct[]> {
    const result = new Map<string, ScrapedProduct[]>();
    for (const [brand, bucket] of buckets) {
      result.set(brand, [...bucket.values()]);
    }
    return result;
  }

  /** 將 Shopify 商品轉為統一的 ScrapedProduct */
  private toScrapedProduct(p: ShopifyProduct): ScrapedProduct {
    // 以最低 variant 價格作為代表價；任一 variant 有貨即視為有庫存
    const prices = p.variants
      .map((v) => parseYen(v.price))
      .filter((n): n is number => n !== null);
    const priceYen = prices.length > 0 ? Math.min(...prices) : null;
    const inStock = p.variants.some((v) => v.available);

    return {
      name: normalizeText(p.title),
      priceYen,
      imageUrl: p.images[0]?.src ?? null,
      productUrl: `${this.shopUrl}products/${p.handle}`, // 唯一鍵
      inStock,
    };
  }
}
