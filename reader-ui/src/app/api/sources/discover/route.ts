import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resolveYouTubeFeed } from "@/lib/youtube";
import {
  discoverWebsiteWithMethods,
  type WebsiteDiscoverOptions,
  type WebsiteMethod,
} from "@/lib/web-discovery";

const VALID_METHODS = new Set<WebsiteMethod>([
  "auto",
  "rss",
  "sitemap",
  "scrape",
  "google_news",
  "rsshub",
]);

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      kind?: string;
      input?: string;
      noShorts?: boolean;
      method?: string;
      options?: WebsiteDiscoverOptions;
    };
    const kind = (body.kind || "website").toLowerCase();
    const input = (body.input || "").trim();

    if (!input) {
      return NextResponse.json({ error: "Vui lòng nhập đường dẫn hoặc từ khoá." }, { status: 400 });
    }

    if (kind === "youtube") {
      const resolved = await resolveYouTubeFeed(input, Boolean(body.noShorts));
      return NextResponse.json({
        feeds: [{ title: resolved.title, url: resolved.url, type: "youtube" }],
      });
    }

    const methodRaw = (body.method || "auto").toLowerCase() as WebsiteMethod;
    const method: WebsiteMethod = VALID_METHODS.has(methodRaw) ? methodRaw : "auto";
    const result = await discoverWebsiteWithMethods(input, method, body.options || {});
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tìm thấy RSS feed từ địa chỉ này." },
      { status: 400 }
    );
  }
}
