/**
 * 爬蟲共用型別 — 讓每家選品店的 scraper 遵循相同介面，
 * 之後新增 1LDK / LOFTMAN 時只要實作同一個 ShopScraper 即可。
 */

/** 單一爬蟲任務的目標：某家店的某個品牌頁面 */
export interface ScrapeTarget {
  /** 品牌名稱 (例: "AURALEE") */
  brand: string;
  /** 該品牌在此選品店的商品列表頁 URL */
  listUrl: string;
}

/** 爬蟲抓到、清洗後、準備寫入 DB 的商品資料 */
export interface ScrapedProduct {
  name: string;
  priceYen: number | null;
  imageUrl: string | null;
  productUrl: string; // 唯一鍵
  inStock: boolean;
}

/** 每家選品店需實作的介面 */
export interface ShopScraper {
  /** 選品店識別碼 (CLI 參數 / DB name) */
  readonly shopName: string;
  readonly shopUrl: string;
  /** 執行爬取，回傳清洗後的商品陣列 */
  scrape(target: ScrapeTarget): Promise<ScrapedProduct[]>;
  /**
   * (選用) 一次爬取多個品牌。
   * 適用於需掃描整個目錄的站台 (如 diverse Shopify)：一趟掃描就把多個品牌分桶回傳，
   * 避免每個品牌各掃一次整個目錄。回傳的 Map 以「輸入的品牌名稱」為 key。
   */
  scrapeMany?(brands: string[]): Promise<Map<string, ScrapedProduct[]>>;
  /**
   * (選用) 一次爬取「站上所有品牌」。
   * 適用於能列出完整品牌清單的站台 (如 diverse Shopify)：一趟掃描就把所有 vendor
   * 分桶回傳。可用 minCount 過濾掉商品數過少的雜訊品牌。
   */
  scrapeAllBrands?(minCount?: number): Promise<Map<string, ScrapedProduct[]>>;
}
