import { config } from "../config";
import { fetchJson, politeDelay } from "../utils/http";
import { normalizeBrandName, normalizeText, parseYen } from "../utils/parse";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./types";

/**
 * diverse (https://www.diverse-web.com/) 爬蟲。
 *
 * 已對照實際站台驗證 (2026-07)：
 *  - 這是一個 **Shopify** 商店 → 直接使用 Shopify 公開的 `/products.json` API，
 *    取得結構化資料，**不需要瀏覽器 (Playwright)**，比 DOM 解析更穩定。
 *  - 該站未建立 per-vendor collection，故無法用 `/collections/{brand}` 直取單一品牌；
 *    改為分頁掃全目錄 (250 筆/頁) 後以 `vendor` 欄位過濾。
 *  - 站台在高頻請求時會回 HTTP 429，已由 fetchJson 的退避重試 + politeDelay 處理。
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

export class DiverseScraper implements ShopScraper {
  public readonly shopName = "diverse";
  public readonly shopUrl = "https://www.diverse-web.com/";

  /** 單一品牌 (相容 ShopScraper 介面)：內部走多品牌流程再取該品牌 */
  public async scrape(target: ScrapeTarget): Promise<ScrapedProduct[]> {
    const map = await this.scrapeMany([target.brand]);
    return map.get(target.brand) ?? [];
  }

  /**
   * 一次掃描整個 Shopify 目錄，把多個品牌 (vendor) 一起分桶回傳。
   * 不論要幾個品牌，都只掃一趟目錄 (~90 頁)，大幅省下重複掃描。
   */
  public async scrapeMany(brands: string[]): Promise<Map<string, ScrapedProduct[]>> {
    // 正規化品牌名 → 原始輸入名 (回傳 Map 用原始名當 key)
    const wanted = new Map<string, string>();
    for (const b of brands) wanted.set(normalizeBrandName(b), b);

    // 每個品牌各自的去重桶
    const buckets = new Map<string, Map<string, ScrapedProduct>>();
    for (const b of brands) buckets.set(b, new Map());

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

      let hit = 0;
      for (const p of products) {
        const origName = wanted.get(normalizeBrandName(p.vendor));
        if (!origName) continue; // 非目標品牌
        const sp = this.toScrapedProduct(p);
        buckets.get(origName)!.set(sp.productUrl, sp);
        hit++;
      }
      if (page % 10 === 0 || hit > 0) {
        console.log(`[diverse] 第 ${page} 頁: 掃 ${total} 筆，本頁命中 ${hit} 筆`);
      }

      await politeDelay(); // 禮貌延遲，降低被限流機率
    }

    if (!reachedEnd) {
      console.warn(
        `[diverse] ⚠️ 掃描於第 ${lastPage} 頁達到上限 (SHOPIFY_MAX_PAGES=${maxPages}) 仍未到目錄尾端，` +
          `資料可能不完整；請調高 SHOPIFY_MAX_PAGES。`,
      );
    }

    const result = new Map<string, ScrapedProduct[]>();
    for (const [brand, bucket] of buckets) {
      console.log(`[diverse] ${brand}: ${bucket.size} 筆`);
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
