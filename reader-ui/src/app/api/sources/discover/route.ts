import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";
import { resolveYouTubeFeed } from "@/lib/youtube";

interface DiscoverCandidate {
  title: string;
  url: string;
  type: string;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      kind?: string;
      input?: string;
      noShorts?: boolean;
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

    let normalizedUrl = input;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const discovered = await minifluxFetch<DiscoverCandidate[]>("/v1/discover", {
        method: "POST",
        body: JSON.stringify({ url: normalizedUrl }),
      });
      if (Array.isArray(discovered) && discovered.length > 0) {
        return NextResponse.json({ feeds: discovered });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("404")) {
        throw err;
      }
    }

    // Thử dò thêm các đường dẫn RSS phổ biến nếu trang chủ không khai báo thẻ <link rel="alternate">
    const parsed = new URL(normalizedUrl);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      const candidates = ["/rss", "/feed", "/rss.xml", "/feed.xml", "/atom.xml"].map(
        (suffix) => `${parsed.origin}${suffix}`
      );
      const settled = await Promise.all(
        candidates.map((u) =>
          minifluxFetch<DiscoverCandidate[]>("/v1/discover", {
            method: "POST",
            body: JSON.stringify({ url: u }),
          }).catch(() => [])
        )
      );
      const merged = settled.flat().filter((f) => Boolean(f?.url));
      const unique = Array.from(new Map(merged.map((f) => [f.url, f])).values());
      return NextResponse.json({ feeds: unique });
    }

    return NextResponse.json({ feeds: [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tìm thấy RSS feed từ địa chỉ này." },
      { status: 400 }
    );
  }
}
