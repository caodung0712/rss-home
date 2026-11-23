import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  deleteTagEverywhere,
  listTagsSummary,
  renameTagEverywhere,
  upsertTagDefinition,
} from "@/lib/tags";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const tags = await listTagsSummary();
    return NextResponse.json({ tags });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tải danh sách tags." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      action?: string;
      name?: string;
      color?: string;
      oldName?: string;
      newName?: string;
    };

    if (body.action === "rename") {
      const result = await renameTagEverywhere(
        body.oldName || "",
        body.newName || ""
      );
      return NextResponse.json({ ok: true, ...result });
    }

    const saved = await upsertTagDefinition(body.name || "", body.color);
    return NextResponse.json({ ok: true, tag: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể lưu tag." },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    let name = req.nextUrl.searchParams.get("name") || "";
    if (!name) {
      const body = (await req.json().catch(() => ({}))) as { name?: string };
      name = body.name || "";
    }
    if (!name.trim()) {
      return NextResponse.json({ error: "Thiếu tên tag." }, { status: 400 });
    }
    await deleteTagEverywhere(name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể xoá tag." },
      { status: 500 }
    );
  }
}
