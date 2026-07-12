import { prisma } from "./lib/prisma";
import { persistProducts } from "./storage";
import { ArknetsScraper } from "./scrapers/arknets";
import { DiverseScraper } from "./scrapers/diverse";
import { LoftmanScraper } from "./scrapers/loftman";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./scrapers/types";

/**
 * 爬蟲進入點。
 * 用法:
 *   ts-node src/index.ts arknets   # 只爬單一店
 *   ts-node src/index.ts all       # 爬所有已註冊的店 (npm run scrape:all)
 *
 * 新增選品店時：實作 ShopScraper → 在 registry 加一筆 → 在 targets 加要爬的品牌，
 * 之後跑 `npm run scrape:all` 就會一併爬到。
 */

const registry: Record<string, ShopScraper> = {
  arknets: new ArknetsScraper(),
  diverse: new DiverseScraper(),
  loftman: new LoftmanScraper(),
};

/**
 * 每家店要爬的目標 (品牌 → 品牌頁)。
 *
 * 註：實測 ARKnets 目前「未販售 AURALEE」(不在其 479 個品牌清單內)，
 *     故改用 ARKnets 實際引進、且已驗證品牌代碼的品牌作為範例。
 *     品牌頁網址格式：https://www.arknets.co.jp/brand/{BRAND_CODE}/
 *     其他已確認代碼：MARKAWARE=B0441, GRAPHPAPER=B1126, A.P.C.=B0515, ACRONYM=B1160
 */
const targets: Record<string, ScrapeTarget[]> = {
  arknets: [
    { brand: "COMOLI", listUrl: "https://www.arknets.co.jp/brand/B1023/" },
  ],
  // diverse 為 Shopify 商店：用 scrapeMany 一趟掃描整個目錄，一次分桶下列所有品牌。
  // (vendor 名稱大小寫不拘，會正規化比對；不存在的品牌會回傳 0 筆並記錄。)
  diverse: [
    "AURALEE",
    "COMOLI",
    "Graphpaper",
    "MARKAWARE",
    "A.PRESSE",
    "ATON",
    "CIOTA",
    "HERILL",
    "Hender Scheme",
    "NEAT",
    "TEATORA",
    "DAIWA PIER39",
    "YOKO SAKAMOTO",
    "beautiful people",
  ].map((brand) => ({ brand, listUrl: "https://www.diverse-web.com/" })),
  // LOFTMAN 品牌分類頁 (伺服器端渲染)；已確認販售 AURALEE。
  loftman: [
    { brand: "AURALEE", listUrl: "https://loftman.co.jp/shop/c/cauralee/" },
  ],
};

/** 爬取單一選品店的所有目標品牌並寫入資料庫 */
async function scrapeShop(shopKey: string): Promise<void> {
  const scraper = registry[shopKey];
  const shopTargets = targets[shopKey];
  if (!scraper || !shopTargets) {
    console.error(`未知的選品店: "${shopKey}"。可用: ${Object.keys(registry).join(", ")}, all`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n===== 開始爬取 ${scraper.shopName} (${shopTargets.length} 個品牌) =====`);

  // 支援 scrapeMany 的店 (如 diverse)：一趟掃描把多品牌一起抓回，再逐一寫入
  const brandProducts = scraper.scrapeMany
    ? await scraper.scrapeMany(shopTargets.map((t) => t.brand))
    : await scrapePerTarget(scraper, shopTargets);

  for (const target of shopTargets) {
    const products = brandProducts.get(target.brand) ?? [];
    if (products.length === 0) {
      console.warn(`[${scraper.shopName}] ${target.brand} 沒有抓到任何商品，略過寫入。`);
      continue;
    }
    const result = await persistProducts(scraper, target.brand, products);
    console.log(
      `[${scraper.shopName}] ${target.brand} 寫入完成 → 新增 ${result.created} 筆、更新 ${result.updated} 筆`,
    );
  }
}

/** 不支援 scrapeMany 的店：逐一品牌各自爬取，組成與 scrapeMany 相同的 Map 結構 */
async function scrapePerTarget(
  scraper: ShopScraper,
  shopTargets: ScrapeTarget[],
): Promise<Map<string, ScrapedProduct[]>> {
  const map = new Map<string, ScrapedProduct[]>();
  for (const target of shopTargets) {
    console.log(`\n=== ${scraper.shopName} / ${target.brand} ===`);
    map.set(target.brand, await scraper.scrape(target));
  }
  return map;
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "all").toLowerCase();
  const shopKeys = arg === "all" ? Object.keys(registry) : [arg];
  for (const shopKey of shopKeys) {
    await scrapeShop(shopKey);
  }
}

main()
  .catch((err) => {
    console.error("爬蟲執行失敗:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
