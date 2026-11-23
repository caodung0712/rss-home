import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  extractImageUrls,
  extractPlainText,
  htmlToMarkdown,
  sanitizeArticleHtml,
} from "@/lib/html-utils";
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
    const images = extractImageUrls(entry.content || "", entry.enclosures);
    const sanitizedHtml = sanitizeArticleHtml(entry.content || "", true);
    const plainText = extractPlainText(entry.content || "");
    const markdown = htmlToMarkdown(entry.content || "");

    return NextResponse.json({
      ...entry,
      sanitized_html: sanitizedHtml,
      plain_text: plainText,
      markdown,
      images,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tải được bài viết." },
      { status: 500 }
    );
  }
}
