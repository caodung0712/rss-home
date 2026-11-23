import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxCountersResponse,
  type MinifluxEntriesResponse,
  type MinifluxFeed,
} from "@/lib/miniflux";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const [categories, feeds, counters, starred] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories?counts=true"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
      minifluxFetch<MinifluxCountersResponse>("/v1/feeds/counters"),
      minifluxFetch<MinifluxEntriesResponse>("/v1/entries?starred=true&limit=1"),
    ]);

    const totalUnread = Object.values(counters.unreads || {}).reduce((acc, v) => acc + v, 0);

    return NextResponse.json({
      categories,
      feeds: feeds.map((f) => ({
        ...f,
        unread_count: counters.unreads?.[String(f.id)] || 0,
        read_count: counters.reads?.[String(f.id)] || 0,
      })),
      total_unread: totalUnread,
      starred_total: starred.total || 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi lấy danh sách feeds." },
      { status: 500 }
    );
  }
}
