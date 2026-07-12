import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日本選品店情報聚合",
  description: "搜尋品牌，一次瀏覽各日本選品店的商品",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
