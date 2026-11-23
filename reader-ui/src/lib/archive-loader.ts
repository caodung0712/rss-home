import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { getDbPool } from "./db";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function parseRelativeTimeText(text: string, fallbackMs: number): Date {
  const lower = (text || "").toLowerCase();
  const m = lower.match(
    /(\d+)\s+(second|minute|hour|day|week|month|year|giây|phút|giờ|ngày|tuần|tháng|năm)s?\s*(?:ago|trước)?/
  );
  if (!m) {
    return new Date(fallbackMs);
  }
  const num = Number(m[1]);
  const unit = m[2];
  let ms = 0;
  if (unit === "second" || unit === "giây") ms = num * 1000;
  else if (unit === "minute" || unit === "phút") ms = num * 60_000;
  else if (unit === "hour" || unit === "giờ") ms = num * 3_600_000;
  else if (unit === "day" || unit === "ngày") ms = num * 86_400_000;
  else if (unit === "week" || unit === "tuần") ms = num * 7 * 86_400_000;
  else if (unit === "month" || unit === "tháng") ms = num * 30 * 86_400_000;
  else if (unit === "year" || unit === "năm") ms = num * 365 * 86_400_000;
  return new Date(Date.now() - ms);
}

interface ParsedYouTubeVideo {
  videoId: string;
  title: string;
  duration: string;
  publishedText: string;
  thumbnail: string;
}

function extractYouTubeItemsFromGrid(
  gridItems: unknown[]
): { videos: ParsedYouTubeVideo[]; continuationToken: string | null } {
  const videos: ParsedYouTubeVideo[] = [];
  let continuationToken: string | null = null;

  for (const rawItem of gridItems) {
    const item = rawItem as Record<string, unknown>;
    if (item?.continuationItemRenderer) {
      const cont = item.continuationItemRenderer as {
        continuationEndpoint?: {
          continuationCommand?: { token?: string };
        };
      };
      const tok = cont?.continuationEndpoint?.continuationCommand?.token;
      if (tok) continuationToken = tok;
      continue;
    }

    const richContent = (
      item?.richItemRenderer as { content?: Record<string, unknown> } | undefined
    )?.content;
    if (!richContent) continue;

    // Mẫu mới của YouTube: lockupViewModel
    if (richContent.lockupViewModel) {
      const lvm = richContent.lockupViewModel as {
        contentId?: string;
        metadata?: {
          lockupMetadataViewModel?: {
            title?: { content?: string };
            metadata?: {
              contentMetadataViewModel?: {
                metadataRows?: Array<{
                  metadataParts?: Array<{ text?: { content?: string } }>;
                }>;
              };
            };
          };
        };
        contentImage?: {
          thumbnailViewModel?: {
            image?: { sources?: Array<{ url?: string }> };
            overlays?: Array<{
              thumbnailBottomOverlayViewModel?: {
                badges?: Array<{
                  thumbnailBadgeViewModel?: { text?: string };
                }>;
              };
            }>;
          };
        };
      };
      const videoId = lvm.contentId || "";
      const title = lvm.metadata?.lockupMetadataViewModel?.title?.content || "";
      const rows =
        lvm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
          ?.metadataRows || [];
      const partsText = rows
        .flatMap((r) => r.metadataParts || [])
        .map((p) => p.text?.content || "")
        .filter(Boolean);
      const publishedText =
        partsText.find((t) => /ago|trước/i.test(t)) || partsText.join(" · ");
      const duration =
        lvm.contentImage?.thumbnailViewModel?.overlays?.[0]
          ?.thumbnailBottomOverlayViewModel?.badges?.[0]
          ?.thumbnailBadgeViewModel?.text || "";
      const sources = lvm.contentImage?.thumbnailViewModel?.image?.sources || [];
      const thumbnail =
        sources[sources.length - 1]?.url ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");

      if (videoId && title) {
        videos.push({ videoId, title, duration, publishedText, thumbnail });
      }
      continue;
    }

    // Mẫu cũ của YouTube: videoRenderer
    if (richContent.videoRenderer) {
      const vr = richContent.videoRenderer as {
        videoId?: string;
        title?: { runs?: Array<{ text?: string }> };
        publishedTimeText?: { simpleText?: string };
        lengthText?: { simpleText?: string };
        thumbnail?: { thumbnails?: Array<{ url?: string }> };
      };
      const videoId = vr.videoId || "";
      const title = vr.title?.runs?.[0]?.text || "";
      const publishedText = vr.publishedTimeText?.simpleText || "";
      const duration = vr.lengthText?.simpleText || "";
      const thumbs = vr.thumbnail?.thumbnails || [];
      const thumbnail =
        thumbs[thumbs.length - 1]?.url ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
      if (videoId && title) {
        videos.push({ videoId, title, duration, publishedText, thumbnail });
      }
    }
  }

  return { videos, continuationToken };
}

function extractYouTubeChannelIdFromFeedUrl(feedUrl: string): string | null {
  try {
    const u = new URL(feedUrl);
    if (!u.hostname.includes("youtube.com")) return null;
    const cid = u.searchParams.get("channel_id");
    if (cid && cid.startsWith("UC")) return cid;
    const pid = u.searchParams.get("playlist_id");
    if (pid && pid.startsWith("UULF")) return `UC${pid.slice(4)}`;
  } catch {
    return null;
  }
  return null;
}

function extractTelegramChannelFromFeedUrl(feedUrl: string): string | null {
  const m = feedUrl.match(/\/telegram\/channel\/([^/?#]+)/i);
  return m ? m[1] : null;
}

export function isArchivePaginationSupported(feedUrl: string): boolean {
  return Boolean(
    extractYouTubeChannelIdFromFeedUrl(feedUrl) ||
      extractTelegramChannelFromFeedUrl(feedUrl)
  );
}

export async function loadOlderArchiveEntries(
  feedId: number,
  batchSize = 20
): Promise<{
  supported: boolean;
  added: number;
  hasMore: boolean;
  message?: string;
}> {
  const p = getDbPool();
  if (!p) {
    return { supported: false, added: 0, hasMore: false, message: "Thiếu DATABASE_URL" };
  }

  const feedRes = await p.query<{
    id: number;
    user_id: number;
    title: string;
    feed_url: string;
  }>("SELECT id, user_id, title, feed_url FROM feeds WHERE id = $1", [feedId]);

  const feed = feedRes.rows[0];
  if (!feed) {
    return { supported: false, added: 0, hasMore: false, message: "Không tìm thấy feed." };
  }

  const existingRes = await p.query<{ url: string; hash: string; published_at: Date }>(
    "SELECT url, hash, published_at FROM entries WHERE feed_id = $1 ORDER BY published_at ASC",
    [feedId]
  );
  const existingUrls = new Set(existingRes.rows.map((r) => r.url));
  const existingHashes = new Set(existingRes.rows.map((r) => r.hash));
  const oldestExistingMs =
    existingRes.rows[0]?.published_at?.getTime() || Date.now();

  const tombRes = await p.query<{ hash: string }>(
    "SELECT hash FROM entry_tombstones WHERE feed_id = $1",
    [feedId]
  );
  for (const t of tombRes.rows) existingHashes.add(t.hash);

  // 1. Kênh YouTube
  const channelId = extractYouTubeChannelIdFromFeedUrl(feed.feed_url);
  if (channelId) {
    const html = await (
      await fetch(`https://www.youtube.com/channel/${channelId}/videos`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      })
    ).text();

    const dataMatch = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!dataMatch) {
      return {
        supported: true,
        added: 0,
        hasMore: false,
        message: "Không đọc được danh sách video từ YouTube.",
      };
    }

    const data = JSON.parse(dataMatch[1]) as {
      contents?: {
        twoColumnBrowseResultsRenderer?: {
          tabs?: Array<{
            tabRenderer?: {
              title?: string;
              content?: { richGridRenderer?: { contents?: unknown[] } };
            };
          }>;
        };
      };
    };
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || "";
    const clientVersion =
      html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ||
      "2.20250101.00.00";

    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const videosTab =
      tabs.find((t) => t.tabRenderer?.title === "Videos") || tabs[1];
    let gridItems =
      videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

    const collected: ParsedYouTubeVideo[] = [];
    let continuationToken: string | null = null;

    // Duyệt tối đa 8 trang YouTube (tối đa ~240 video) để gom đủ ~20 video chưa có trong DB
    for (let page = 0; page < 8; page++) {
      const parsed = extractYouTubeItemsFromGrid(gridItems);
      continuationToken = parsed.continuationToken;

      for (const v of parsed.videos) {
        const watchUrl = `https://www.youtube.com/watch?v=${v.videoId}`;
        const minHash = sha256Hex(watchUrl);
        if (existingUrls.has(watchUrl) || existingHashes.has(minHash)) {
          continue;
        }
        existingUrls.add(watchUrl);
        collected.push(v);
        if (collected.length >= batchSize) break;
      }

      if (collected.length >= batchSize || !continuationToken || !apiKey) {
        break;
      }

      const nextRes = await fetch(
        `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          body: JSON.stringify({
            context: {
              client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" },
            },
            continuation: continuationToken,
          }),
          cache: "no-store",
        }
      );
      if (!nextRes.ok) {
        continuationToken = null;
        break;
      }
      const nextJson = (await nextRes.json()) as {
        onResponseReceivedActions?: Array<{
          appendContinuationItemsAction?: { continuationItems?: unknown[] };
        }>;
      };
      gridItems =
        nextJson?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction
          ?.continuationItems || [];
      if (gridItems.length === 0) {
        continuationToken = null;
        break;
      }
    }

    let added = 0;
    let cursorMs = oldestExistingMs - 60_000;

    for (const v of collected) {
      const watchUrl = `https://www.youtube.com/watch?v=${v.videoId}`;
      const hash = sha256Hex(watchUrl);
      const parsedDate = parseRelativeTimeText(v.publishedText, cursorMs);
      // Đảm bảo thứ tự giảm dần nối tiếp phía sau bài cũ nhất đang có
      const pubMs = Math.min(parsedDate.getTime(), cursorMs);
      cursorMs = pubMs - 1000;
      const pubDate = new Date(pubMs);

      const safeImg = v.thumbnail.replace(/"/g, "&quot;");
      const metaLine = [v.duration ? `Thời lượng: ${v.duration}` : "", v.publishedText]
        .filter(Boolean)
        .join(" · ");
      const content = `<p><a href="${watchUrl}" target="_blank" rel="noopener noreferrer"><img src="${safeImg}" alt="${v.title.replace(/"/g, "&quot;")}" /></a></p>${
        metaLine ? `<p>${metaLine}</p>` : ""
      }`;

      const ins = await p.query(
        `INSERT INTO entries (
          user_id, feed_id, hash, published_at, title, url, author, content, status, starred, reading_time, changed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', false, 1, NOW())
        ON CONFLICT (feed_id, hash) DO NOTHING`,
        [feed.user_id, feed.id, hash, pubDate, v.title, watchUrl, feed.title, content]
      );
      added += ins.rowCount || 0;
    }

    return {
      supported: true,
      added,
      hasMore: Boolean(continuationToken) || added >= batchSize,
    };
  }

  // 2. Kênh Telegram công khai
  const tgChannel = extractTelegramChannelFromFeedUrl(feed.feed_url);
  if (tgChannel) {
    let minMsgId = Infinity;
    for (const u of existingUrls) {
      const m = u.match(/t\.me\/[^/]+\/(\d+)/i);
      if (m) {
        const idNum = Number(m[1]);
        if (Number.isFinite(idNum) && idNum < minMsgId) minMsgId = idNum;
      }
    }
    const targetUrl = Number.isFinite(minMsgId)
      ? `https://t.me/s/${tgChannel}?before=${minMsgId}`
      : `https://t.me/s/${tgChannel}`;

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        supported: true,
        added: 0,
        hasMore: false,
        message: "Không kết nối được Telegram web.",
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const msgBlocks = $(".tgme_widget_message").toArray().reverse();

    let added = 0;
    let hasMore = false;
    for (const el of msgBlocks) {
      const postAttr = $(el).attr("data-post") || "";
      const postUrl = `https://t.me/${postAttr}`;
      const hash = sha256Hex(postUrl);
      if (!postAttr || existingUrls.has(postUrl) || existingHashes.has(hash)) {
        continue;
      }
      if (added >= batchSize) {
        hasMore = true;
        break;
      }
      const textHtml = $(el).find(".tgme_widget_message_text").html() || "";
      const plain = $(el).find(".tgme_widget_message_text").text().trim();
      const title = plain ? plain.slice(0, 90) : `${tgChannel} #${postAttr.split("/")[1]}`;
      const dateStr = $(el).find("time").attr("datetime") || "";
      const pubDate = dateStr ? new Date(dateStr) : new Date(oldestExistingMs - (added + 1) * 60_000);

      const imgs: string[] = [];
      $(el)
        .find(".tgme_widget_message_photo_wrap")
        .each((_, imgEl) => {
          const style = $(imgEl).attr("style") || "";
          const bg = style.match(/url\(['"]?([^'")]+)['"]?\)/i);
          if (bg?.[1]) imgs.push(bg[1]);
        });
      const imgHtml = imgs
        .map((src) => `<p><img src="${src}" alt="Telegram photo" /></p>`)
        .join("\n");
      const content = `${textHtml ? `<p>${textHtml}</p>` : ""}${imgHtml}<p><a href="${postUrl}">Xem trên Telegram</a></p>`;

      const ins = await p.query(
        `INSERT INTO entries (
          user_id, feed_id, hash, published_at, title, url, author, content, status, starred, reading_time, changed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', false, 1, NOW())
        ON CONFLICT (feed_id, hash) DO NOTHING`,
        [feed.user_id, feed.id, hash, pubDate, title, postUrl, feed.title, content]
      );
      added += ins.rowCount || 0;
    }

    return { supported: true, added, hasMore: hasMore || added > 0 };
  }

  return { supported: false, added: 0, hasMore: false };
}
