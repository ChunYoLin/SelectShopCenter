import { prisma } from "./lib/prisma";
import { persistProducts } from "./storage";
import { ArknetsScraper } from "./scrapers/arknets";
import { ShopifyScraper } from "./scrapers/shopify";
import { LoftmanScraper } from "./scrapers/loftman";
import type { ScrapedProduct, ScrapeTarget, ShopScraper } from "./scrapers/types";

/**
 * 爬蟲進入點。
 * 用法:
 *   ts-node src/index.ts arknets   # 只爬單一店
 *   ts-node src/index.ts all       # 爬所有已註冊的店 (npm run scrape:all)
 *
 * 新增選品店：
 *  - Shopify 站 → 只要在 SHOPIFY_SHOPS 加一行 (name + url)，自動收錄該站所有品牌。
 *  - 其他平台 → 實作 ShopScraper，加進 registry + targets。
 * 之後跑 `npm run scrape:all` 就會一併爬到。
 */

/** targets 用萬用字元：代表「爬該店所有品牌」(需 scraper 支援 scrapeAllBrands) */
const ALL_BRANDS = "*";

/**
 * Shopify 選品店清單 —— 新增一家 Shopify 店只要在此加一行。
 * 用通用 ShopifyScraper 引擎，預設以萬用字元收錄該站「所有品牌」。
 */
const SHOPIFY_SHOPS: Array<{ key: string; name: string; url: string }> = [
  { key: "diverse", name: "diverse", url: "https://www.diverse-web.com/" },
];

const registry: Record<string, ShopScraper> = {
  arknets: new ArknetsScraper(),
  loftman: new LoftmanScraper(),
};

/**
 * 每家店要爬的目標 (品牌 → 品牌頁)。
 * ARKnets 實測未販售 AURALEE，故以 COMOLI 為例 (品牌頁 /brand/{CODE}/)。
 */
const targets: Record<string, ScrapeTarget[]> = {
  arknets: [
    { brand: "COMOLI", listUrl: "https://www.arknets.co.jp/brand/B1023/" },
  ],
  // LOFTMAN 品牌分類頁 (伺服器端渲染)；已確認販售 AURALEE。
  loftman: [
    { brand: "AURALEE", listUrl: "https://loftman.co.jp/shop/c/cauralee/" },
  ],
};

// 註冊所有 Shopify 店 (全部品牌模式)
for (const s of SHOPIFY_SHOPS) {
  registry[s.key] = new ShopifyScraper(s.name, s.url);
  targets[s.key] = [{ brand: ALL_BRANDS, listUrl: s.url }];
}

/** 爬取單一選品店的所有目標品牌並寫入資料庫 */
async function scrapeShop(shopKey: string): Promise<void> {
  const scraper = registry[shopKey];
  const shopTargets = targets[shopKey];
  if (!scraper || !shopTargets) {
    console.error(`未知的選品店: "${shopKey}"。可用: ${Object.keys(registry).join(", ")}, all`);
    process.exitCode = 1;
    return;
  }

  // 目標為萬用字元 "*" → 爬「站上所有品牌」(需 scraper 支援 scrapeAllBrands)
  const allBrandsMode =
    shopTargets.length === 1 && shopTargets[0]!.brand === ALL_BRANDS;

  let brandProducts: Map<string, ScrapedProduct[]>;
  if (allBrandsMode && scraper.scrapeAllBrands) {
    console.log(`\n===== 開始爬取 ${scraper.shopName} (全部品牌) =====`);
    brandProducts = await scraper.scrapeAllBrands();
  } else {
    console.log(`\n===== 開始爬取 ${scraper.shopName} (${shopTargets.length} 個品牌) =====`);
    // 支援 scrapeMany 的店 (如 diverse)：一趟掃描把多品牌一起抓回，再逐一寫入
    brandProducts = scraper.scrapeMany
      ? await scraper.scrapeMany(shopTargets.map((t) => t.brand))
      : await scrapePerTarget(scraper, shopTargets);
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  for (const [brand, products] of brandProducts) {
    if (products.length === 0) {
      if (!allBrandsMode) {
        console.warn(`[${scraper.shopName}] ${brand} 沒有抓到任何商品，略過寫入。`);
      }
      continue;
    }
    const result = await persistProducts(scraper, brand, products);
    totalCreated += result.created;
    totalUpdated += result.updated;
    console.log(
      `[${scraper.shopName}] ${brand} → 新增 ${result.created}、更新 ${result.updated}`,
    );
  }
  console.log(
    `[${scraper.shopName}] 完成：共 ${brandProducts.size} 個品牌，新增 ${totalCreated}、更新 ${totalUpdated} 筆`,
  );
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
