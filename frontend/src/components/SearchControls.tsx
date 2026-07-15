"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ViewMode = "grid" | "list";
export type SortMode = "default" | "price_asc" | "price_desc";
export interface BrandOption {
  name: string;
  count: number;
}

interface Props {
  brands: BrandOption[];
  initialBrand: string;
  initialInStock: boolean;
  initialView: ViewMode;
  initialSort: SortMode;
}

/**
 * 搜尋列 + 庫存篩選 (D) + 檢視切換 (格狀 / 清單)。
 * 三個狀態都反映在網址參數 (brand / stock / view)，方便分享與重新整理。
 */
export default function SearchControls({
  brands,
  initialBrand,
  initialInStock,
  initialView,
  initialSort,
}: Props) {
  const router = useRouter();
  const [brand, setBrand] = useState(initialBrand);
  const [inStock, setInStock] = useState(initialInStock);
  const [view, setView] = useState<ViewMode>(initialView);
  const [sort, setSort] = useState<SortMode>(initialSort);

  function apply(next: {
    brand?: string;
    inStock?: boolean;
    view?: ViewMode;
    sort?: SortMode;
  }) {
    const b = next.brand ?? brand;
    const s = next.inStock ?? inStock;
    const v = next.view ?? view;
    const so = next.sort ?? sort;
    const params = new URLSearchParams();
    if (b.trim()) params.set("brand", b.trim());
    if (s) params.set("stock", "in");
    if (v !== "grid") params.set("view", v);
    if (so !== "default") params.set("sort", so);
    router.push(params.toString() ? `/?${params.toString()}` : "/");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ brand });
        }}
      >
        <input
          list="brand-options"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="搜尋品牌，例如 AURALEE"
          className="w-56 rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
        <datalist id="brand-options">
          {brands.map((b) => (
            <option key={b.name} value={b.name} />
          ))}
        </datalist>

        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          搜尋
        </button>

        {/* 品牌選單：直接從清單挑一個品牌 */}
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          品牌
          <select
            value={brands.some((b) => b.name === brand) ? brand : ""}
            onChange={(e) => {
              const next = e.target.value;
              setBrand(next);
              apply({ brand: next });
            }}
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="">選擇熱門品牌…</option>
            {brands.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}（{b.count}）
              </option>
            ))}
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => {
              setInStock(e.target.checked);
              apply({ inStock: e.target.checked });
            }}
            className="h-4 w-4 rounded border-neutral-300"
          />
          只顯示有庫存
        </label>

        {/* 價格排序 */}
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          排序
          <select
            value={sort}
            onChange={(e) => {
              const next = e.target.value as SortMode;
              setSort(next);
              apply({ sort: next });
            }}
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="default">預設</option>
            <option value="price_asc">價格低 → 高</option>
            <option value="price_desc">價格高 → 低</option>
          </select>
        </label>
      </form>

      {/* 檢視切換：格狀 / 清單 */}
      <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-neutral-300 text-sm">
        {(["grid", "list"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => {
              setView(mode);
              apply({ view: mode });
            }}
            className={
              "px-3 py-2 transition " +
              (view === mode
                ? "bg-neutral-900 text-white"
                : "bg-white text-neutral-600 hover:bg-neutral-100")
            }
          >
            {mode === "grid" ? "▦ 格狀" : "☰ 清單"}
          </button>
        ))}
      </div>
    </div>
  );
}
