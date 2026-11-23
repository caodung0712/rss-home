import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { mutateSingleEntryTags } from "@/lib/tags";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return NextResponse.json({ error: "ID bài viết không hợp lệ." }, { status: 400 });
  }

  try {
    const body = (await req.json()) as {
      tags?: string[];
      add?: string;
      remove?: string;
    };
    const tags = await mutateSingleEntryTags(entryId, body);
    return NextResponse.json({ ok: true, tags });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không cập nhật được tag." },
      { status: 400 }
    );
  }
}
