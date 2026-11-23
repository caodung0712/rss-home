import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { extractExcerpt, extractThumbnail } from "@/lib/html-utils";
import { minifluxFetch, type MinifluxEntriesResponse } from "@/lib/miniflux";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const params = new URLSearchParams();

  const status = sp.get("status");
  if (status === "unread" || status === "read") {
    params.set("status", status);
  }
  const categoryId = sp.get("category_id");
  if (categoryId) params.set("category_id", categoryId);

  const feedId = sp.get("feed_id");
  if (feedId) params.set("feed_id", feedId);

  const starred = sp.get("starred");
  if (starred === "true") params.set("starred", "true");

  const search = sp.get("search");
  if (search) params.set("search", search);

  const after = sp.get("after");
  if (after) params.set("published_after", after);

  const before = sp.get("before");
  if (before) params.set("published_before", before);

  params.set("order", "published_at");
  params.set("direction", "desc");
  params.set("limit", sp.get("limit") || "40");
  params.set("offset", sp.get("offset") || "0");

  try {
    const data = await minifluxFetch<MinifluxEntriesResponse>(
      `/v1/entries?${params.toString()}`
    );

    const items = (data.entries || []).map((entry) => {
      const thumb = extractThumbnail(entry);
      return {
        id: entry.id,
        feed_id: entry.feed_id,
        status: entry.status,
        title: entry.title,
        url: entry.url,
        published_at: entry.published_at,
        author: entry.author,
        starred: entry.starred,
        reading_time: entry.reading_time,
        feed: {
          id: entry.feed?.id || entry.feed_id,
          title: entry.feed?.title || "",
          site_url: entry.feed?.site_url || "",
          category: entry.feed?.category || null,
        },
        thumbnail: thumb ? `/api/image-proxy?url=${encodeURIComponent(thumb)}` : null,
        excerpt: extractExcerpt(entry.content || "", 200),
      };
    });

    return NextResponse.json({
      total: data.total || 0,
      entries: items,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tải danh sách bài viết." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      entry_ids?: number[];
      status?: "read" | "unread";
    };
    const entryIds = Array.isArray(body.entry_ids) ? body.entry_ids : [];
    const status = body.status === "unread" ? "unread" : "read";
    if (entryIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    await minifluxFetch("/v1/entries", {
      method: "PUT",
      body: JSON.stringify({ entry_ids: entryIds, status }),
    });
    return NextResponse.json({ ok: true, updated: entryIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi cập nhật trạng thái bài." },
      { status: 500 }
    );
  }
}
