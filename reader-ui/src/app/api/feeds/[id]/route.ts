import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const body = (await req.json()) as {
      title?: string;
      category_id?: number;
      crawler?: boolean;
    };
    const updated = await minifluxFetch(`/v1/feeds/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không cập nhật được feed." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    await minifluxFetch(`/v1/feeds/${id}`, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không xoá được feed." },
      { status: 400 }
    );
  }
}
