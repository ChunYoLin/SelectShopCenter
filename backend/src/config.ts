import * as dotenv from "dotenv";

dotenv.config();

/** 讀取數字型環境變數，缺少或非法時回退預設值 */
function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 讀取布林型環境變數 ("true"/"1" → true) */
function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export const config = {
  scraper: {
    headless: boolEnv("SCRAPER_HEADLESS", true),
    minDelayMs: numEnv("SCRAPER_MIN_DELAY_MS", 1500),
    maxDelayMs: numEnv("SCRAPER_MAX_DELAY_MS", 3500),
    maxPages: numEnv("SCRAPER_MAX_PAGES", 3),
    // Shopify (diverse) 全目錄分頁的安全上限。實測 diverse 目錄約 80~120 頁 (250 筆/頁)，
    // 設 130 讓爬蟲能一路掃到「空白頁」自然結束；此值只是防呆上限。
    shopifyMaxPages: numEnv("SHOPIFY_MAX_PAGES", 130),
    // 模擬一般桌機瀏覽器，降低被判定為 bot 的機率
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },
} as const;
