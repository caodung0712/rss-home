import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch, type MinifluxEntriesResponse } from "@/lib/miniflux";

interface MarkAllBody {
  scope: "all" | "category" | "feed" | "tag";
  id?: number;
  tag?: string;
  olderThanDays?: number;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as MarkAllBody;
    const { scope, id, tag, olderThanDays } = body;

    if ((olderThanDays && olderThanDays > 0) || (scope === "tag" && tag)) {
      const params = new URLSearchParams({
        status: "unread",
        limit: "500",
        offset: "0",
      });
      if (olderThanDays && olderThanDays > 0) {
        const beforeEpoch = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
        params.set("published_before", String(beforeEpoch));
      }
      if (scope === "category" && id) params.set("category_id", String(id));
      if (scope === "feed" && id) params.set("feed_id", String(id));
      if (scope === "tag" && tag) params.set("tags", tag);

      let totalMarked = 0;
      // Lặp theo lô 500 bài để đánh dấu hết bài cũ hơn N ngày
      for (let i = 0; i < 20; i++) {
        const res = await minifluxFetch<MinifluxEntriesResponse>(
          `/v1/entries?${params.toString()}`
        );
        const ids = (res.entries || []).map((e) => e.id);
        if (ids.length === 0) break;
        await minifluxFetch("/v1/entries", {
          method: "PUT",
          body: JSON.stringify({ entry_ids: ids, status: "read" }),
        });
        totalMarked += ids.length;
        if (ids.length < 500) break;
      }
      return NextResponse.json({ ok: true, marked: totalMarked });
    }

    if (scope === "category" && id) {
      await minifluxFetch(`/v1/categories/${id}/mark-all-as-read`, { method: "PUT" });
    } else if (scope === "feed" && id) {
      await minifluxFetch(`/v1/feeds/${id}/mark-all-as-read`, { method: "PUT" });
    } else {
      const me = await minifluxFetch<{ id: number }>("/v1/me");
      await minifluxFetch(`/v1/users/${me.id}/mark-all-as-read`, { method: "PUT" });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể đánh dấu đã đọc." },
      { status: 500 }
    );
  }
}
