import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  extractImageUrls,
  extractPlainText,
  extractVideoItems,
  extractYouTubeEmbedId,
  htmlToMarkdown,
  sanitizeArticleHtml,
} from "@/lib/html-utils";
import { minifluxFetch, type MinifluxEntry } from "@/lib/miniflux";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const fetched = await minifluxFetch<{ content: string }>(
      `/v1/entries/${id}/fetch-content`
    );
    const entry = await minifluxFetch<MinifluxEntry>(`/v1/entries/${id}`);
    const content = fetched?.content || entry.content || "";
    const images = extractImageUrls(content, entry.enclosures);
    const videos = extractVideoItems(content, entry.enclosures);
    const youtubeEmbedId = extractYouTubeEmbedId(entry.url || "");

    return NextResponse.json({
      ...entry,
      content,
      sanitized_html: sanitizeArticleHtml(content, true),
      plain_text: extractPlainText(content),
      markdown: htmlToMarkdown(content),
      images,
      videos,
      youtube_embed_id: youtubeEmbedId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không lấy được toàn văn bài viết." },
      { status: 500 }
    );
  }
}
