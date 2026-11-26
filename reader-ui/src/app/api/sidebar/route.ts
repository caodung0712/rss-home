import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxCountersResponse,
  type MinifluxEntriesResponse,
  type MinifluxFeed,
} from "@/lib/miniflux";
import { getSidebarOrder } from "@/lib/sidebar-order";
import { listTagsSummary } from "@/lib/tags";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const [categories, feeds, counters, starred, tags, order] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories?counts=true"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
      minifluxFetch<MinifluxCountersResponse>("/v1/feeds/counters"),
      minifluxFetch<MinifluxEntriesResponse>("/v1/entries?starred=true&limit=1"),
      listTagsSummary().catch(() => []),
      getSidebarOrder().catch(() => ({
        categoryOrder: new Map<number, number>(),
        feedOrder: new Map<number, number>(),
      })),
    ]);

    const sortedCategories = [...categories].sort((a, b) => {
      const pa = order.categoryOrder.get(a.id);
      const pb = order.categoryOrder.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.title.localeCompare(b.title);
    });

    const sortedFeeds = [...feeds].sort((a, b) => {
      const pa = order.feedOrder.get(a.id);
      const pb = order.feedOrder.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.title.localeCompare(b.title);
    });

    const totalUnread = Object.values(counters.unreads || {}).reduce((acc, v) => acc + v, 0);

    return NextResponse.json({
      categories: sortedCategories,
      feeds: sortedFeeds.map((f) => ({
        ...f,
        unread_count: counters.unreads?.[String(f.id)] || 0,
        read_count: counters.reads?.[String(f.id)] || 0,
      })),
      total_unread: totalUnread,
      starred_total: starred.total || 0,
      tags,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi lấy danh sách feeds." },
      { status: 500 }
    );
  }
}
