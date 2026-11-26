import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { LanguageProvider, type Locale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "RSS Home — Trình đọc tin tự host",
  description: "Trình đọc RSS tự host giao diện kiểu Inoreader kết nối Miniflux",
  icons: {
    icon: "/favicon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RSS Home",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const rawLang = cookieStore.get("rss-lang")?.value;
  const initialLocale: Locale = rawLang === "en" ? "en" : "vi";

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased">
        <LanguageProvider initialLocale={initialLocale}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
