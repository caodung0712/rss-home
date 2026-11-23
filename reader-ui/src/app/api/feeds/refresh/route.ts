import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      feedId?: number;
      categoryId?: number;
    };

    if (body.feedId) {
      await minifluxFetch(`/v1/feeds/${body.feedId}/refresh`, { method: "PUT" });
    } else if (body.categoryId) {
      await minifluxFetch(`/v1/categories/${body.categoryId}/refresh`, {
        method: "PUT",
      });
    } else {
      await minifluxFetch("/v1/feeds/refresh", { method: "PUT" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể làm mới feeds." },
      { status: 500 }
    );
  }
}
