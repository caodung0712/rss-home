import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxCountersResponse,
  type MinifluxEntriesResponse,
  type MinifluxFeed,
} from "@/lib/miniflux";

function detectFeedType(feedUrl: string): string {
  const u = feedUrl.toLowerCase();
  if (u.includes("apify-bridge")) return "facebook";
  if (u.includes("/twitter/") || u.includes("fxtwitter.com")) return "x";
  if (u.includes("youtube.com")) return "youtube";
  if (u.includes("news.google.com") || u.includes("google.com/alerts")) return "google";
  if (u.includes("rsshub:")) return "rsshub";
  return "rss";
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const [categories, feeds, counters, recentEntries] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories?counts=true"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
      minifluxFetch<MinifluxCountersResponse>("/v1/feeds/counters"),
      minifluxFetch<MinifluxEntriesResponse>(
        "/v1/entries?order=published_at&direction=desc&limit=500"
      ).catch(() => ({ total: 0, entries: [] })),
    ]);

    const lastPostMap = new Map<number, string>();
    for (const e of recentEntries.entries || []) {
      if (!lastPostMap.has(e.feed_id) && e.published_at) {
        lastPostMap.set(e.feed_id, e.published_at);
      }
    }

    const enrichedFeeds = feeds.map((f) => {
      const reads = counters.reads?.[String(f.id)] || 0;
      const unreads = counters.unreads?.[String(f.id)] || 0;
      const total = reads + unreads;
      const engagement = total > 0 ? Math.round((reads / total) * 100) : 0;
      return {
        ...f,
        feed_type: detectFeedType(f.feed_url),
        read_count: reads,
        unread_count: unreads,
        engagement_pct: engagement,
        last_post_at: lastPostMap.get(f.id) || null,
        is_filtered: Boolean(
          (f.blocklist_rules || "").trim() || (f.keeplist_rules || "").trim()
        ),
      };
    });

    return NextResponse.json({
      categories,
      feeds: enrichedFeeds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tải danh sách nội dung." },
      { status: 500 }
    );
  }
}
