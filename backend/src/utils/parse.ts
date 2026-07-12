/**
 * 資料清洗工具 — 將爬取到的原始字串正規化成資料庫欄位。
 */

/** 壓縮多餘空白、換行、tab，並去除頭尾空白 */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 從價格字串解析出日圓整數。
 * 支援 "¥12,100" / "12,100円" / "12100" / "税込 12,100" 等格式。
 * 無法解析時回傳 null。
 */
export function parseYen(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 將相對網址補成絕對網址；已是絕對網址則原樣回傳 */
export function toAbsoluteUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** 品牌名稱正規化：轉大寫、壓縮空白，作為 upsert / 搜尋的一致鍵 */
export function normalizeBrandName(raw: string): string {
  return normalizeText(raw).toUpperCase();
}
