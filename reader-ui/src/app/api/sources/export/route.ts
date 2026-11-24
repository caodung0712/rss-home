import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxFeed,
} from "@/lib/miniflux";

function escapeXmlAttr(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const [categories, feeds] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
    ]);

    if (format === "opml") {
      const byCategory = new Map<string, MinifluxFeed[]>();
      for (const f of feeds) {
        const catName = f.category?.title || "Chung";
        const list = byCategory.get(catName) || [];
        list.push(f);
        byCategory.set(catName, list);
      }

      const folderXml: string[] = [];
      for (const [catName, list] of byCategory.entries()) {
        const safeCat = escapeXmlAttr(catName);
        const outlines = list
          .map((f) => {
            const title = escapeXmlAttr(f.title || f.feed_url);
            const xmlUrl = escapeXmlAttr(f.feed_url);
            const htmlUrl = escapeXmlAttr(f.site_url || f.feed_url);
            return `      <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}" />`;
          })
          .join("\n");
        folderXml.push(`    <outline text="${safeCat}" title="${safeCat}">\n${outlines}\n    </outline>`);
      }

      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader Channels Export (${stamp})</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${folderXml.join("\n")}
  </body>
</opml>\n`;

      return new NextResponse(opml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="rss-channels-${stamp}.opml"`,
        },
      });
    }

    const payload = {
      version: 1,
      app: "rss-home",
      exported_at: new Date().toISOString(),
      categories: categories.map((c) => ({ title: c.title })),
      feeds: feeds.map((f) => ({
        title: f.title,
        feed_url: f.feed_url,
        site_url: f.site_url || "",
        category: f.category?.title || "Chung",
        crawler: Boolean(f.crawler),
        disabled: Boolean(f.disabled),
        blocklist_rules: f.blocklist_rules || "",
        keeplist_rules: f.keeplist_rules || "",
        rewrite_rules: f.rewrite_rules || "",
        scraper_rules: f.scraper_rules || "",
        user_agent: f.user_agent || "",
      })),
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="rss-channels-${stamp}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không export được danh sách kênh." },
      { status: 500 }
    );
  }
}
