import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { htmlToMarkdown } from "@/lib/html-utils";
import { minifluxFetch, type MinifluxEntry } from "@/lib/miniflux";

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { entryIds?: number[] };
    const ids = (body.entryIds || []).slice(0, 200);
    if (ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn bài viết nào." }, { status: 400 });
    }

    const entries: MinifluxEntry[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const fetched = await Promise.all(
        chunk.map((id) =>
          minifluxFetch<MinifluxEntry>(`/v1/entries/${id}`).catch(() => null)
        )
      );
      for (const e of fetched) {
        if (e) entries.push(e);
      }
    }

    const blocks = entries.map((e, index) => {
      const md = htmlToMarkdown(e.content || "");
      const tagsLine =
        Array.isArray(e.tags) && e.tags.length > 0
          ? `- **Tags:** ${e.tags.join(", ")}`
          : null;
      return [
        `## ${index + 1}. ${e.title}`,
        `- **Nguồn:** ${e.feed?.title || ""}`,
        `- **Ngày:** ${e.published_at}`,
        `- **Liên kết:** ${e.url}`,
        ...(tagsLine ? [tagsLine] : []),
        "",
        md,
      ].join("\n");
    });

    return NextResponse.json({
      count: entries.length,
      markdown: blocks.join("\n\n---\n\n"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tạo Markdown." },
      { status: 500 }
    );
  }
}
