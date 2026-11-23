import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

function getMinifluxBaseUrl(): string {
  return (
    process.env.MINIFLUX_INTERNAL_URL ||
    process.env.MINIFLUX_BASE_URL ||
    "http://miniflux:8080"
  ).replace(/\/+$/, "");
}

function getAuthHeaders(): Record<string, string> {
  const apiKey = (process.env.MINIFLUX_API_KEY || "").trim();
  if (apiKey) return { "X-Auth-Token": apiKey };
  const user = (process.env.MINIFLUX_ADMIN_USERNAME || "admin").trim();
  const pass = (process.env.MINIFLUX_ADMIN_PASSWORD || "").trim();
  const encoded = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file OPML." }, { status: 400 });
    }

    const opmlText = await file.text();
    if (!opmlText.includes("<opml") && !opmlText.includes("<outline")) {
      return NextResponse.json(
        { error: "File không đúng định dạng OPML." },
        { status: 400 }
      );
    }

    const res = await fetch(`${getMinifluxBaseUrl()}/v1/import`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/xml",
      },
      body: opmlText,
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Miniflux từ chối file OPML (${res.status}): ${msg}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, message: "Đã import OPML vào Miniflux thành công!" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi khi import OPML." },
      { status: 500 }
    );
  }
}
