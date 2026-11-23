import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { downloadImageBuffer } from "@/lib/export-helpers";
import { extractImageUrls, slugifyFilename } from "@/lib/html-utils";
import { minifluxFetch, type MinifluxEntry } from "@/lib/miniflux";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const entry = await minifluxFetch<MinifluxEntry>(`/v1/entries/${id}`);
    const urls = extractImageUrls(entry.content || "", entry.enclosures);
    if (urls.length === 0) {
      return NextResponse.json({ error: "Bài viết không có ảnh." }, { status: 404 });
    }

    const zip = new JSZip();
    const results = await Promise.all(
      urls.slice(0, 30).map(async (u, idx) => ({
        idx: idx + 1,
        dl: await downloadImageBuffer(u),
      }))
    );

    let saved = 0;
    for (const r of results) {
      if (!r.dl) continue;
      zip.file(`image_${r.idx}.${r.dl.ext}`, r.dl.data);
      saved += 1;
    }

    if (saved === 0) {
      return NextResponse.json({ error: "Không tải được ảnh nào." }, { status: 502 });
    }

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const filename = `${slugifyFilename(entry.title, "images")}-${entry.id}-images.zip`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tạo ZIP ảnh." },
      { status: 500 }
    );
  }
}
