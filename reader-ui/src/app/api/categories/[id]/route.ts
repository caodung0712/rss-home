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
    const body = (await req.json()) as { title?: string };
    const title = (body.title || "").trim();
    if (!title) {
      return NextResponse.json({ error: "Tên thư mục không được trống." }, { status: 400 });
    }
    const updated = await minifluxFetch(`/v1/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không đổi tên được thư mục." },
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
    await minifluxFetch(`/v1/categories/${id}`, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Không xoá được thư mục (có thể thư mục vẫn còn feed bên trong).",
      },
      { status: 400 }
    );
  }
}
