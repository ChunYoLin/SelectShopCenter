# 日本選品店情報聚合平台 (Japan Select Shops Aggregator)

搜尋品牌（如 AURALEE），一次瀏覽多家日本選品店（ARKnets、diverse、LOFTMAN…）的商品。

> **目前進度**：三家選品店爬蟲（ARKnets / diverse / LOFTMAN）+ Next.js 前端
> （品牌搜尋、跨店比較、庫存篩選）皆已可運作。

## 專案結構

```
japan-select-shops/
├── .gitignore
├── README.md
├── backend/                     # Node.js + TypeScript 後端與爬蟲
│   ├── prisma/
│   │   ├── schema.prisma        # Shop / Brand / Product 模型
│   │   └── seed.ts              # 預建選品店資料
│   └── src/
│       ├── config.ts            # 讀取環境變數
│       ├── index.ts             # 爬蟲進入點 (CLI)
│       ├── storage.ts           # 清洗結果寫入 DB (upsert)
│       ├── lib/prisma.ts        # Prisma Client 單例
│       ├── utils/               # http (retry/延遲) / parse (價格/URL 清洗)
│       └── scrapers/
│           ├── types.ts         # ShopScraper 共用介面
│           ├── arknets.ts       # ARKnets 爬蟲 (Playwright，有 WAF)
│           ├── diverse.ts       # diverse 爬蟲 (Shopify JSON API)
│           └── loftman.ts       # LOFTMAN 爬蟲 (Cheerio，伺服器端渲染)
└── frontend/                    # Next.js (App Router) + Tailwind
    ├── prisma/schema.prisma     # 與 backend 相同 (唯讀共用同一 DB)
    └── src/
        ├── app/page.tsx         # 搜尋頁：依品牌查詢、按選品店分組
        ├── components/SearchControls.tsx  # 搜尋列 + 庫存篩選 (client)
        └── lib/prisma.ts
```

三個爬蟲刻意用**三種不同工具**，示範「依目標網站決定技術」：

| 選品店 | 平台 | 抓取方式 | 原因 |
|---|---|---|---|
| ARKnets | ASP.NET | **Playwright** | 站台有 AWS WAF JS 挑戰，需真實瀏覽器 |
| diverse | Shopify | **純 fetch + JSON API** | Shopify 提供結構化 `/products.json` |
| LOFTMAN | ASP.NET | **fetch + Cheerio** | 伺服器端渲染、無 WAF，靜態 HTML 解析即可 |

## 技術棧

- **Backend / Scraper**：Node.js + TypeScript（Playwright / Cheerio / fetch）
- **Database**：PostgreSQL + Prisma ORM
- **Frontend**：Next.js (App Router) + Tailwind CSS
- **Search**：目前為 DB 關鍵字查詢，之後可導入 Meilisearch

## 快速開始

### 1. 安裝依賴

```bash
cd backend
npm install
npx playwright install chromium        # 下載 Playwright 瀏覽器
sudo npx playwright install-deps chromium   # 安裝 Chromium 所需系統函式庫 (建議)
```

> 若無法使用 `sudo`：本專案已在 `backend/.native-libs/` 附帶 Chromium 缺少的系統
> 函式庫 (libnss3 / libnspr4 / libasound2)，`npm run scrape:arknets` 會自動透過
> `LD_LIBRARY_PATH` 載入,免 sudo 即可執行。

### 2. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env，填入你的 PostgreSQL 連線字串
```

（本機若沒有 PostgreSQL，可用 Docker 快速啟動：）

```bash
docker run --name jss-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=japan_select_shops -p 5432:5432 -d postgres:16
```

### 3. 建立資料庫結構

```bash
npm run prisma:migrate -- --name init   # 建立 migration 並套用
npm run db:seed                          # (選用) 預建選品店
```

### 4. 執行爬蟲

```bash
npm run scrape:all       # ★ 一次爬所有已註冊的選品店 (加新店後跑這個)
npm run scrape:arknets   # 只爬 ARKnets (Playwright，需系統函式庫)
npm run scrape:diverse   # 只爬 diverse (Shopify JSON API，純 fetch)
npm run scrape:loftman   # 只爬 LOFTMAN (Cheerio，純 fetch)
```

### 新增選品店 / 品牌的流程

1. 在 `src/scrapers/` 實作一個 `ShopScraper`（挑最適合該站的工具：Playwright / JSON / Cheerio）。
2. 在 `src/index.ts` 的 `registry` 註冊，並在 `targets` 加要爬的品牌。
3. 跑 `npm run scrape:all` — 前端的品牌選單／清單是**依 DB 動態產生**，新品牌會自動出現。

> **一次掃描、多品牌入庫**：diverse 因為要掃整個 Shopify 目錄，實作了選用的
> `scrapeMany(brands[])`，**一趟掃描就把多個品牌一起分桶入庫**（`targets.diverse`
> 是一份品牌清單），不必每個品牌各掃一次目錄。其他站沒實作時，`index.ts` 會自動
> 退回「逐品牌」方式，介面一致。

### 5. 啟動前端

```bash
cd ../frontend
cp .env.example .env       # 與 backend 指向同一個 DB
npm install
npm run dev                # http://localhost:3000
```

前端功能：
- **品牌搜尋**：輸入品牌（附既有品牌建議清單），依選品店分組顯示商品。
- **跨店比較**：同一品牌（如 AURALEE）一次看 diverse + LOFTMAN 的商品與價格。
- **庫存篩選 (D)**：勾選「只顯示有庫存」即時過濾（實測 AURALEE 493 → 44 件）。
- 售完商品顯示 `SOLD OUT` 標記，點擊商品開新分頁前往原始商品頁。

執行後可用 Prisma Studio 檢視寫入的資料：

```bash
npm run prisma:studio
```

## ARKnets 爬蟲實測筆記 (2026-07 驗證)

- **AWS WAF JS Challenge**：ARKnets 位於 AWS WAF 的 JavaScript 挑戰後方
  （深層頁面回 `HTTP 202` + `x-amzn-waf-action: challenge`）。靜態 curl / Cheerio
  拿不到內容，**必須用 Playwright 這類真實瀏覽器**執行挑戰 JS；爬蟲已用輪詢方式
  等待挑戰通過。
- **品牌頁網址**：`https://www.arknets.co.jp/brand/{BRAND_CODE}/`
  （已驗證代碼：COMOLI=B1023、MARKAWARE=B0441、GRAPHPAPER=B1126、A.P.C.=B0515、ACRONYM=B1160）。
- **AURALEE 未販售**：實測 ARKnets 479 個品牌清單中**不含 AURALEE**，故範例改用
  COMOLI；之後接其他選品店（1LDK / LOFTMAN）時再補 AURALEE。
- **商品卡片選擇器**已對照真實 DOM 填入（`src/scrapers/arknets.ts` 的 `SELECTORS`），
  圖片為 lazy-load，爬蟲會自動捲動觸發載入。
- 爬蟲已內建 user-agent 偽裝與隨機延遲，請遵守目標網站的 robots.txt 與服務條款，
  控制抓取頻率。

### 實測結果

```
=== 開始爬取 ARKnets / COMOLI ===
[ARKnets] 共抓取 90 筆商品
[ARKnets] COMOLI 寫入完成 → 新增 90 筆、更新 0 筆   # 首次
[ARKnets] COMOLI 寫入完成 → 新增 0 筆、更新 90 筆   # 再跑一次：upsert 生效，不重複
```

## diverse 爬蟲實測筆記 (2026-07 驗證)

- **平台是 Shopify** → 直接打公開 JSON API `/products.json?limit=250&page=N`，
  取回結構化資料（title / vendor / variants[].price / variants[].available / images），
  **完全不需要瀏覽器**，比 DOM 解析穩定。這也呼應 prompt 的「依目標網站決定工具」。
- **有販售 AURALEE**（與 ARKnets 相反）→ diverse 正是 AURALEE 的貨源，範例即以 AURALEE。
- **無 per-vendor collection**：`/collections/{brand}/products.json` 回空，故改為分頁掃全目錄
  後以 `vendor` 欄位過濾。實測目錄約 80~120 頁（≈2.5 萬件，含大量已售完的歷史商品）。
- **限流**：高頻請求時 Shopify 會回 `HTTP 429` + HTML 過場頁；`fetchJson` 已用
  指數退避重試，並在每頁之間加隨機延遲。
- 掃描以「空白頁」為自然終點；若達 `SHOPIFY_MAX_PAGES` 防呆上限仍未結束，會印出
  **警告**提醒資料可能不完整（不會靜默截斷）。
- 價格單位為日圓整數字串（`"10500"` = ¥10,500）；以商品最低 variant 價為代表價、
  任一 variant 有貨即視為有庫存。

## LOFTMAN 爬蟲實測筆記 (2026-07 驗證)

- **ASP.NET EC，品牌頁伺服器端渲染、無 WAF** → 用 `fetch` 取 HTML + **Cheerio** 解析即可，
  不需瀏覽器（與 ARKnets 同一套主題 `block-thumbnail-t--goods`，但 ARKnets 有 WAF 才需 Playwright）。
- **有販售 AURALEE**：品牌分類頁 `/shop/c/cauralee/`，約 41 件。
- **分頁**：第 2 頁起為 `/shop/c/c{brand}_p{N}/`；末頁之後會重複回傳最後一頁，
  爬蟲以「本頁無新增（不重複）商品」為終止條件。
- **售罄判斷**：卡片含 `.block-icon--auto-out-of-stock`（SOLD OUT）即標記無庫存
  （實測 AURALEE 41 件中 15 件售完、26 件有貨）。
- 價格取現售價 `.js-enhanced-ecommerce-goods-price`（"PRICE : ￥32,340"）；
  圖片為 lazy-load，網址在 `img[data-src]`。

## 前端實測結果

```
搜尋 AURALEE（全部）      → 493 件，來自 2 家選品店（diverse 452 + LOFTMAN 41）
搜尋 AURALEE（只顯示有庫存）→  44 件（diverse 18 + LOFTMAN 26）   ← 庫存篩選 (D) 生效
搜尋 COMOLI               →  90 件，來自 1 家選品店（ARKnets）
```
