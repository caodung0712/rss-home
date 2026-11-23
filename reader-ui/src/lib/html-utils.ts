import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import type { MinifluxEntry } from "./miniflux";

export function formatUnreadCount(count: number): string {
  if (count > 999) return "1000+";
  return String(Math.max(0, count));
}

export function formatRelativeTimeVi(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d`;
  return new Date(ts).toLocaleDateString("vi-VN");
}

export function extractImageUrls(
  html: string,
  enclosures?: MinifluxEntry["enclosures"]
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  if (html) {
    const $ = cheerio.load(html);
    $("img").each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).attr("data-src") ||
        $(el).attr("data-original") ||
        "";
      const clean = src.trim();
      if (clean && /^https?:\/\//i.test(clean) && !seen.has(clean)) {
        seen.add(clean);
        urls.push(clean);
      }
    });
  }

  if (Array.isArray(enclosures)) {
    for (const enc of enclosures) {
      if (
        enc.url &&
        /^https?:\/\//i.test(enc.url) &&
        (enc.mime_type?.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(enc.url))
      ) {
        if (!seen.has(enc.url)) {
          seen.add(enc.url);
          urls.push(enc.url);
        }
      }
    }
  }

  return urls;
}

export function extractThumbnail(entry: MinifluxEntry): string | null {
  const imgs = extractImageUrls(entry.content || "", entry.enclosures);
  return imgs.length > 0 ? imgs[0] : null;
}

export function extractExcerpt(html: string, maxLen = 220): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $.text().replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}…`;
}

export function extractPlainText(html: string): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, blockquote").each((_, el) => {
    $(el).append("\n");
  });
  return $.text()
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeArticleHtml(html: string, rewriteImagesToProxy = true): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "video",
      "source",
      "h1",
      "h2",
      "details",
      "summary",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "title", "width", "height", "loading"],
      a: ["href", "name", "target", "rel"],
      video: ["src", "controls", "poster", "width", "height"],
      source: ["src", "type"],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (tagName, attribs) => {
        const rawSrc = attribs.src || "";
        const proxiedSrc =
          rewriteImagesToProxy && /^https?:\/\//i.test(rawSrc)
            ? `/api/image-proxy?url=${encodeURIComponent(rawSrc)}`
            : rawSrc;
        return {
          tagName,
          attribs: {
            ...attribs,
            src: proxiedSrc,
            loading: "lazy",
            "data-original-src": rawSrc,
          },
        };
      },
    },
  });
}

export function htmlToMarkdown(
  html: string,
  imageRewriteMap?: Map<string, string>
): string {
  let processed = html || "";
  if (imageRewriteMap && imageRewriteMap.size > 0) {
    const $ = cheerio.load(processed);
    $("img").each((_, el) => {
      const src = ($(el).attr("src") || "").trim();
      const localPath = imageRewriteMap.get(src);
      if (localPath) {
        $(el).attr("src", localPath);
      }
    });
    processed = $.html();
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return turndown.turndown(processed).trim();
}

export function slugifyFilename(input: string, fallback = "bai-viet"): string {
  const normalized = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}
