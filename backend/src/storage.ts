import { prisma } from "./lib/prisma";
import { normalizeBrandName } from "./utils/parse";
import type { ScrapedProduct, ShopScraper } from "./scrapers/types";

export interface PersistResult {
  created: number;
  updated: number;
}

/**
 * 將爬取結果寫入資料庫。
 *  - Shop:  以 name 為唯一鍵 upsert (不存在則新增)
 *  - Brand: 以正規化後的 name 為唯一鍵 upsert (不存在則新增)
 *  - Product: 以 productUrl 為唯一鍵 upsert
 *             (存在則更新價格 / 庫存 / 名稱 / 圖片；不存在則新增)
 */
export async function persistProducts(
  scraper: ShopScraper,
  brandName: string,
  products: ScrapedProduct[],
): Promise<PersistResult> {
  // 1. 確保 Shop 存在
  const shop = await prisma.shop.upsert({
    where: { name: scraper.shopName },
    create: { name: scraper.shopName, url: scraper.shopUrl },
    update: { url: scraper.shopUrl },
  });

  // 2. 確保 Brand 存在 (正規化名稱)
  const normalizedBrand = normalizeBrandName(brandName);
  const brand = await prisma.brand.upsert({
    where: { name: normalizedBrand },
    create: { name: normalizedBrand },
    update: {},
  });

  // 3. 逐筆 upsert 商品
  let created = 0;
  let updated = 0;

  for (const p of products) {
    const existing = await prisma.product.findUnique({
      where: { productUrl: p.productUrl },
      select: { id: true },
    });

    await prisma.product.upsert({
      where: { productUrl: p.productUrl },
      create: {
        name: p.name,
        priceYen: p.priceYen,
        imageUrl: p.imageUrl,
        productUrl: p.productUrl,
        inStock: p.inStock,
        shopId: shop.id,
        brandId: brand.id,
      },
      update: {
        // 重複商品 → 更新可能變動的欄位 (價格 / 庫存 / 名稱 / 圖片)
        name: p.name,
        priceYen: p.priceYen,
        imageUrl: p.imageUrl,
        inStock: p.inStock,
        brandId: brand.id,
      },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated };
}
