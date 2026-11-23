import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxFeed,
} from "@/lib/miniflux";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const [categories, feeds] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
    ]);

    return NextResponse.json({
      categories,
      feeds,
      readiness: {
        twitter_token_set: Boolean((process.env.TWITTER_AUTH_TOKEN || "").trim()),
        apify_token_set: Boolean((process.env.APIFY_TOKEN || "").trim()),
        apify_task_set: Boolean((process.env.APIFY_FB_TASK_ID || "").trim()),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tải cấu hình nguồn." },
      { status: 500 }
    );
  }
}
