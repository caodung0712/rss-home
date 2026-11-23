import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RSS Home — Trình đọc tin tự host",
  description: "Trình đọc RSS tự host giao diện kiểu Inoreader kết nối Miniflux",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
