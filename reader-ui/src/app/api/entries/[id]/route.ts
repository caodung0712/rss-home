import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  extractImageUrls,
  extractPlainText,
  extractTikTokEmbedId,
  extractVideoItems,
  extractYouTubeEmbedId,
  htmlToMarkdown,
  sanitizeArticleHtml,
  stripLeadingLinkedImage,
} from "@/lib/html-utils";
import { minifluxFetch, type MinifluxEntry } from "@/lib/miniflux";
import { getStoredSocialMetrics } from "@/lib/social-metrics";

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
    const videos = extractVideoItems(entry.content || "", entry.enclosures);
    const youtubeEmbedId = extractYouTubeEmbedId(entry.url || "");
    const tiktokEmbedId = extractTikTokEmbedId(entry.url || "");
    const hasInlineVideo = (entry.content || "").toLowerCase().includes("<video");
    let rawHtml = entry.content || "";

    if (tiktokEmbedId && videos.length === 0 && !hasInlineVideo) {
      const poster = images[0]
        ? `/api/image-proxy?url=${encodeURIComponent(images[0])}`
        : undefined;
      videos.push({
        url: `/api/tiktok-video?url=${encodeURIComponent(entry.url)}`,
        mime_type: "video/mp4",
        poster,
      });
      rawHtml = stripLeadingLinkedImage(rawHtml);
    }

    const sanitizedHtml = sanitizeArticleHtml(rawHtml, true);
    const plainText = extractPlainText(entry.content || "");
    const markdown = htmlToMarkdown(entry.content || "");
    const metricsMap = await getStoredSocialMetrics([entry.id]).catch(() => ({} as Record<number, never>));

    return NextResponse.json({
      ...entry,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      social_metrics: metricsMap[entry.id] || null,
      sanitized_html: sanitizedHtml,
      plain_text: plainText,
      markdown,
      images,
      videos,
      youtube_embed_id: youtubeEmbedId,
      tiktok_embed_id: tiktokEmbedId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tải được bài viết." },
      { status: 500 }
    );
  }
}
