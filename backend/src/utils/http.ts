import { config } from "../config";

/** 暫停指定毫秒數 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 逾時 + 指數退避重試的 fetch 核心；回傳 Response 供上層決定如何解析 */
async function fetchWithRetry(
  url: string,
  accept: string,
  opts: { retries?: number; timeoutMs?: number },
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": config.scraper.userAgent, Accept: accept },
        signal: ac.signal,
      });
      // 429 / 5xx → 退避重試
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * 2 ** attempt); // 1.5s, 3s, 6s…
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch 失敗 (${url}): ${String(lastErr)}`);
}

/**
 * 取得 JSON，內建逾時與針對 HTTP 429 / 5xx 的指數退避重試。
 * 適用於 Shopify 這類會對高頻請求回 429 的 API。
 */
export async function fetchJson<T>(
  url: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetchWithRetry(url, "application/json", opts);
  const ct = res.headers.get("content-type") ?? "";
  // 非 JSON 回應 (常見於被限流時的 HTML 過場頁) → 視為失敗
  if (!ct.includes("json")) {
    throw new Error(`fetchJson 非 JSON 回應 (${url}): ${res.status} ${ct.slice(0, 30)}`);
  }
  return (await res.json()) as T;
}

/**
 * 取得 HTML 純文字，內建逾時與退避重試。適用於伺服器端渲染的站台 (如 LOFTMAN)。
 * encoding：非 UTF-8 站台需指定 (例: Shop-Pro 為 "euc-jp")，否則日文會亂碼。
 */
export async function fetchHtml(
  url: string,
  opts: { retries?: number; timeoutMs?: number; encoding?: string } = {},
): Promise<string> {
  const res = await fetchWithRetry(url, "text/html", opts);
  if (opts.encoding && opts.encoding.toLowerCase() !== "utf-8") {
    const buf = await res.arrayBuffer();
    return new TextDecoder(opts.encoding).decode(buf);
  }
  return res.text();
}

/**
 * 隨機延遲 — 防封鎖機制之一。
 * 在 [minDelayMs, maxDelayMs] 之間取隨機值，避免固定間隔被辨識為機器人。
 */
export function politeDelay(): Promise<void> {
  const { minDelayMs, maxDelayMs } = config.scraper;
  const lo = Math.min(minDelayMs, maxDelayMs);
  const hi = Math.max(minDelayMs, maxDelayMs);
  const ms = lo + Math.random() * (hi - lo);
  return sleep(ms);
}
