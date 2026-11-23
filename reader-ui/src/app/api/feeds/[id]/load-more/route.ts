import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { loadOlderArchiveEntries } from "@/lib/archive-loader";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  const feedId = Number(id);
  if (!Number.isFinite(feedId) || feedId <= 0) {
    return NextResponse.json({ error: "Feed ID không hợp lệ." }, { status: 400 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { batchSize?: number };
    const batchSize = Math.min(50, Math.max(5, Number(body.batchSize || 20)));
    const result = await loadOlderArchiveEntries(feedId, batchSize);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tải thêm được bài cũ." },
      { status: 500 }
    );
  }
}
