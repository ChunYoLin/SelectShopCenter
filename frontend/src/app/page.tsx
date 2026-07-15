import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import SearchControls, {
  type BrandOption,
  type SortMode,
  type ViewMode,
} from "@/components/SearchControls";

export const dynamic = "force-dynamic"; // 每次都讀最新 DB 資料

interface SearchParams {
  brand?: string;
  stock?: string;
  view?: string;
  shop?: string;
  sort?: string;
}

interface ProductView {
  id: number;
  name: string;
  priceYen: number | null;
  imageUrl: string | null;
  productUrl: string;
  inStock: boolean;
}

function formatYen(yen: number | null): string {
  if (yen === null) return "—";
  return `¥${yen.toLocaleString("ja-JP")}`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const brandQuery = (searchParams.brand ?? "").trim();
  const inStockOnly = searchParams.stock === "in";
  const view: ViewMode = searchParams.view === "list" ? "list" : "grid";
  const sort: SortMode =
    searchParams.sort === "price_asc"
      ? "price_asc"
      : searchParams.sort === "price_desc"
        ? "price_desc"
        : "default";

  // 排序：先按選品店分組，組內再依所選規則排序 (null 價一律排最後)
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ shopId: "asc" }, { priceYen: { sort: "asc", nulls: "last" } }]
      : sort === "price_desc"
        ? [{ shopId: "asc" }, { priceYen: { sort: "desc", nulls: "last" } }]
        : [{ shopId: "asc" }, { id: "asc" }];

  // 品牌建議清單 (datalist)
  const brandRows = await prisma.brand.findMany({
    select: { name: true, _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
  const brandOptions: BrandOption[] = brandRows.map((b) => ({
    name: b.name,
    count: b._count.products,
  }));
  // 搜尋列的 datalist / 選單只放「商品數最多」的前 300 個常見品牌 (避免上千 option)；
  // 完整清單在 /brands 頁瀏覽/搜尋。
  const topBrandsForControls: BrandOption[] = [...brandOptions]
    .sort((a, b) => b.count - a.count)
    .slice(0, 300)
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedShop = (searchParams.shop ?? "").trim();

  // 依品牌查詢商品 (不含庫存/選品店篩選，讓上方狀態列能顯示各店完整狀態)
  const products = brandQuery
    ? await prisma.product.findMany({
        where: { brand: { name: brandQuery.toUpperCase() } },
        include: { shop: true },
        orderBy,
      })
    : [];

  // 每家選品店的狀態統計 (總數 / 有庫存數)，套用「只顯示有庫存」後的顯示數
  const stats = new Map<string, { total: number; inStock: number; shown: number }>();
  for (const p of products) {
    const s = stats.get(p.shop.name) ?? { total: 0, inStock: 0, shown: 0 };
    s.total += 1;
    if (p.inStock) s.inStock += 1;
    if (!inStockOnly || p.inStock) s.shown += 1;
    stats.set(p.shop.name, s);
  }
  const shopOrder = [...stats.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name]) => name);

  // 實際要顯示的商品：套用庫存篩選 + (若有) 單一選品店篩選
  const visible = products.filter(
    (p) =>
      (!inStockOnly || p.inStock) &&
      (selectedShop === "" || p.shop.name === selectedShop),
  );
  const byShop = new Map<string, typeof products>();
  for (const p of visible) {
    const list = byShop.get(p.shop.name) ?? [];
    list.push(p);
    byShop.set(p.shop.name, list);
  }

  // 產生保留其他參數的網址 (供狀態列切換選品店用)
  const hrefFor = (shop: string | null) => {
    const q = new URLSearchParams();
    if (brandQuery) q.set("brand", brandQuery);
    if (inStockOnly) q.set("stock", "in");
    if (view !== "grid") q.set("view", view);
    if (sort !== "default") q.set("sort", sort);
    if (shop) q.set("shop", shop);
    return q.toString() ? `/?${q.toString()}` : "/";
  };

  return (
    <main className="space-y-8">
      <header className="flex items-baseline justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">日本選品店情報聚合</h1>
          <p className="text-sm text-neutral-500">
            搜尋品牌，一次比較各家日本選品店的商品。
          </p>
        </div>
        <a href="/brands" className="text-sm text-neutral-500 hover:text-neutral-900">
          品牌一覽 →
        </a>
      </header>

      <SearchControls
        brands={topBrandsForControls}
        initialBrand={brandQuery}
        initialInStock={inStockOnly}
        initialView={view}
        initialSort={sort}
      />

      {!brandQuery ? (
        <EmptyState brands={brandOptions} />
      ) : products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          找不到「{brandQuery}」的商品
          {inStockOnly ? "（已套用「只顯示有庫存」）" : ""}。
        </p>
      ) : (
        <div className="space-y-8">
          {/* 上方狀態列：各選品店的狀態 + 快速切換 */}
          <div className="sticky top-0 z-10 -mx-4 flex flex-wrap gap-2 bg-neutral-50/90 px-4 py-3 backdrop-blur">
            <ShopChip
              href={hrefFor(null)}
              label="全部"
              count={visible.length}
              active={selectedShop === ""}
            />
            {shopOrder.map((shopName) => {
              const s = stats.get(shopName)!;
              return (
                <ShopChip
                  key={shopName}
                  href={hrefFor(shopName)}
                  label={shopName}
                  count={inStockOnly ? s.shown : s.total}
                  hint={inStockOnly ? undefined : `${s.inStock} 有貨`}
                  active={selectedShop === shopName}
                />
              );
            })}
          </div>

          <p className="text-sm text-neutral-500">
            「{brandQuery.toUpperCase()}」{selectedShop ? `在 ${selectedShop} ` : ""}共{" "}
            {visible.length} 件{inStockOnly ? "（僅有庫存）" : ""}
            {selectedShop ? "" : `，來自 ${byShop.size} 家選品店`}。
          </p>

          {[...byShop.entries()].map(([shopName, items]) => (
            <section key={shopName} id={`shop-${shopName}`} className="scroll-mt-20 space-y-4">
              <h2 className="flex items-baseline gap-2 border-b border-neutral-200 pb-2">
                <span className="text-lg font-semibold">{shopName}</span>
                <span className="text-sm text-neutral-400">{items.length} 件</span>
              </h2>
              {view === "list" ? (
                <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                  {items.map((p) => (
                    <ProductRow key={p.id} product={p} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

/** 上方狀態列的選品店切換晶片：顯示店名 + 數量 (+ 有貨數)，可點擊只看該店。 */
function ShopChip({
  href,
  label,
  count,
  hint,
  active,
}: {
  href: string;
  label: string;
  count: number;
  hint?: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition " +
        (active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-900")
      }
    >
      <span className="font-medium">{label}</span>
      <span className={active ? "text-neutral-300" : "text-neutral-400"}>{count}</span>
      {hint && (
        <span
          className={
            "rounded-full px-1.5 text-[11px] " +
            (active ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700")
          }
        >
          {hint}
        </span>
      )}
    </a>
  );
}

/** 清單檢視：一列一件商品，縮圖小、資訊橫向排列，方便一目了然比較。 */
function ProductRow({ product }: { product: ProductView }) {
  return (
    <a
      href={product.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-4 px-3 py-2 transition hover:bg-neutral-50"
    >
      <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">
            無圖
          </div>
        )}
      </div>

      <p className="min-w-0 flex-1 truncate text-sm text-neutral-800">{product.name}</p>

      {!product.inStock && (
        <span className="flex-shrink-0 rounded bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
          SOLD OUT
        </span>
      )}

      <p className="w-24 flex-shrink-0 text-right text-sm font-semibold tabular-nums">
        {formatYen(product.priceYen)}
      </p>
    </a>
  );
}

function ProductCard({ product }: { product: ProductView }) {
  return (
    <a
      href={product.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-neutral-100">
        {product.imageUrl ? (
          // 使用原生 img 以避免為多個外部 CDN 網域設定 next/image
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            無圖片
          </div>
        )}
        {!product.inStock && (
          <span className="absolute left-2 top-2 rounded bg-neutral-900/80 px-2 py-0.5 text-[11px] font-medium text-white">
            SOLD OUT
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm text-neutral-800">{product.name}</p>
        <p className="mt-auto text-sm font-semibold">{formatYen(product.priceYen)}</p>
      </div>
    </a>
  );
}

function EmptyState({ brands }: { brands: BrandOption[] }) {
  // 只在首頁秀「商品數最多」的前 24 個品牌，完整清單導去 /brands
  const top = [...brands].sort((a, b) => b.count - a.count).slice(0, 24);
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8">
      <p className="text-center text-sm text-neutral-500">
        目前收錄 {brands.length} 個品牌，熱門品牌：
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {top.map((b) => (
          <a
            key={b.name}
            href={`/?brand=${encodeURIComponent(b.name)}`}
            className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
          >
            {b.name}
            <span className="text-xs text-neutral-400">{b.count}</span>
          </a>
        ))}
      </div>
      <p className="mt-4 text-center text-sm">
        <a href="/brands" className="text-neutral-900 underline hover:no-underline">
          瀏覽全部 {brands.length} 個品牌 →
        </a>
      </p>
    </div>
  );
}
