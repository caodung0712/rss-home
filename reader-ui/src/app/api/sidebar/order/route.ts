import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";
import { saveCategoryOrder, saveFeedOrder } from "@/lib/sidebar-order";

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      categoryIds?: number[];
      feedIds?: number[];
      feedMove?: { feedId: number; targetCategoryId: number };
    };

    if (
      body.feedMove &&
      Number.isFinite(body.feedMove.feedId) &&
      body.feedMove.feedId > 0 &&
      Number.isFinite(body.feedMove.targetCategoryId) &&
      body.feedMove.targetCategoryId > 0
    ) {
      await minifluxFetch(`/v1/feeds/${body.feedMove.feedId}`, {
        method: "PUT",
        body: JSON.stringify({ category_id: body.feedMove.targetCategoryId }),
      });
    }

    if (Array.isArray(body.categoryIds) && body.categoryIds.length > 0) {
      await saveCategoryOrder(body.categoryIds.map(Number));
    }

    if (Array.isArray(body.feedIds) && body.feedIds.length > 0) {
      await saveFeedOrder(body.feedIds.map(Number));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không lưu được thứ tự." },
      { status: 500 }
    );
  }
}
