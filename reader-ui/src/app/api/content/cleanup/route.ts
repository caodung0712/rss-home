import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";
import { cleanupOldEntries, clearAllCaches } from "@/lib/storage";

interface CleanupBody {
  action: "clear_cache" | "flush_read_history" | "clear_old_entries";
  feedIds?: number[];
  olderThanDays?: number;
  includeUnread?: boolean;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as CleanupBody;

    if (body.action === "clear_cache") {
      const result = await clearAllCaches();
      return NextResponse.json({
        ok: true,
        ...result,
        message: "Đã xoá cache RSSHub (Redis) và cache Apify bridge.",
      });
    }

    if (body.action === "flush_read_history") {
      await minifluxFetch("/v1/flush-history", { method: "DELETE" });
      return NextResponse.json({
        ok: true,
        message: "Đã dọn toàn bộ bài đã đọc (giữ nguyên bài đã lưu).",
      });
    }

    if (body.action === "clear_old_entries") {
      const days = Number(body.olderThanDays ?? 180);
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json({ error: "Số ngày không hợp lệ." }, { status: 400 });
      }
      const res = await cleanupOldEntries({
        feedIds: Array.isArray(body.feedIds) ? body.feedIds : undefined,
        olderThanDays: days,
        includeUnread: Boolean(body.includeUnread),
      });
      return NextResponse.json({
        ok: true,
        cleared: res.cleared,
        message: `Đã dọn ${res.cleared} bài cũ (luôn giữ lại bài đã lưu).`,
      });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi khi dọn dẹp dữ liệu." },
      { status: 500 }
    );
  }
}
