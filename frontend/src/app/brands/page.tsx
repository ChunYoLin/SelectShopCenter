import { prisma } from "@/lib/prisma";
import BrandBrowser, { type BrandStat } from "@/components/BrandBrowser";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  // 每個品牌的商品數與跨店數
  const rows = await prisma.$queryRaw<Array<{ name: string; products: bigint; shops: bigint }>>`
    SELECT b.name, COUNT(p.id) AS products, COUNT(DISTINCT p."shopId") AS shops
    FROM brands b JOIN products p ON p."brandId" = b.id
    GROUP BY b.name
    ORDER BY products DESC
  `;
  const brands: BrandStat[] = rows.map((r) => ({
    name: r.name,
    products: Number(r.products),
    shops: Number(r.shops),
  }));

  const multiShop = brands.filter((b) => b.shops >= 2).length;

  return (
    <main className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">品牌一覽</h1>
          <p className="text-sm text-neutral-500">
            共 {brands.length} 個品牌，其中 {multiShop} 個跨 2 家以上選品店。
          </p>
        </div>
        <a href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← 回搜尋
        </a>
      </header>

      <BrandBrowser brands={brands} />
    </main>
  );
}
