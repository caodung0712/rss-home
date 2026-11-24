import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const videoUrl = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!/^https?:\/\/(www\.|m\.|vt\.)?tiktok\.com\//i.test(videoUrl)) {
    return NextResponse.json({ error: "URL TikTok không hợp lệ." }, { status: 400 });
  }

  const bridgeBase = (
    process.env.APIFY_BRIDGE_URL || "http://apify-bridge:8000"
  ).replace(/\/+$/, "");

  const headers: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  try {
    const upstream = await fetch(
      `${bridgeBase}/tiktok/video?url=${encodeURIComponent(videoUrl)}`,
      { headers, cache: "no-store" }
    );
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Không phát được video TikTok (${upstream.status}).` },
        { status: 502 }
      );
    }

    const outHeaders = new Headers();
    for (const h of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const val = upstream.headers.get(h);
      if (val) outHeaders.set(h, val);
    }
    if (!outHeaders.has("content-type")) {
      outHeaders.set("content-type", "video/mp4");
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi phát video TikTok." },
      { status: 502 }
    );
  }
}
