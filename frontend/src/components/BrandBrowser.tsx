"use client";

import { useMemo, useState } from "react";

export interface BrandStat {
  name: string;
  products: number;
  shops: number;
}

const RENDER_CAP = 600; // 一次最多渲染的品牌數，避免上千筆卡頓

type Sort = "products" | "shops" | "name";

export default function BrandBrowser({ brands }: { brands: BrandStat[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("products");
  const [multiOnly, setMultiOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let list = brands.filter((b) => (q ? b.name.includes(q) : true));
    if (multiOnly) list = list.filter((b) => b.shops >= 2);
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "shops") return b.shops - a.shops || b.products - a.products;
      return b.products - a.products;
    });
    return list;
  }, [brands, query, sort, multiOnly]);

  const shown = filtered.slice(0, RENDER_CAP);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋品牌…"
          className="w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          排序
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm"
          >
            <option value="products">商品數</option>
            <option value="shops">跨店數</option>
            <option value="name">名稱</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={multiOnly}
            onChange={(e) => setMultiOnly(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          只看多店品牌
        </label>
        <span className="text-sm text-neutral-400">
          {filtered.length} 個品牌{filtered.length > RENDER_CAP ? `（顯示前 ${RENDER_CAP}）` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((b) => (
          <a
            key={b.name}
            href={`/?brand=${encodeURIComponent(b.name)}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm hover:border-neutral-900"
          >
            <span className="truncate">{b.name}</span>
            <span className="flex flex-shrink-0 items-center gap-1 text-xs text-neutral-400">
              {b.products}
              {b.shops >= 2 && (
                <span className="rounded-full bg-emerald-50 px-1.5 text-emerald-700">
                  {b.shops}店
                </span>
              )}
            </span>
          </a>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-neutral-500">找不到符合「{query}」的品牌。</p>
      )}
    </div>
  );
}
