import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch, type MinifluxCategory } from "@/lib/miniflux";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }
  try {
    const categories = await minifluxFetch<MinifluxCategory[]>("/v1/categories?counts=true");
    return NextResponse.json(categories);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không lấy được danh sách thư mục." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { title?: string };
    const title = (body.title || "").trim();
    if (!title) {
      return NextResponse.json({ error: "Tên thư mục không được trống." }, { status: 400 });
    }
    const created = await minifluxFetch<MinifluxCategory>("/v1/categories", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    return NextResponse.json(created);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tạo được thư mục." },
      { status: 400 }
    );
  }
}
