const YT_CANONICAL_RE = /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})"/i;
const YT_OG_URL_RE = /<meta\s+property="og:url"\s+content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})"/i;
const YT_RSS_URL_RE = /"rssUrl"\s*:\s*"https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]{20,})"/;
const YT_ITEMPROP_RE = /itemprop="(?:channelId|identifier)"\s+content="(UC[a-zA-Z0-9_-]{20,})"/i;
const YT_METADATA_EXT_ID_RE = /"channelMetadataRenderer"\s*:\s*\{[^}]*"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/;
const YT_EXTERNAL_ID_RE = /"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/;
const YT_TITLE_RE = /<meta\s+property="og:title"\s+content="([^"]+)"/i;

function extractChannelIdFromHtml(html: string): string | null {
  const patterns = [
    YT_CANONICAL_RE,
    YT_OG_URL_RE,
    YT_RSS_URL_RE,
    YT_ITEMPROP_RE,
    YT_METADATA_EXT_ID_RE,
    YT_EXTERNAL_ID_RE,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function resolveYouTubeFeed(
  rawInput: string,
  noShorts = false
): Promise<{ title: string; url: string }> {
  const raw = rawInput.trim();
  if (raw.includes("feeds/videos.xml")) {
    if (noShorts && raw.includes("channel_id=UC")) {
      const cid = raw.split("channel_id=")[1]?.split("&")[0] || "";
      if (cid.startsWith("UC")) {
        return {
          title: "YouTube Channel",
          url: `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${cid.slice(2)}`,
        };
      }
    }
    return { title: "YouTube Channel", url: raw };
  }

  let channelId: string | null = null;
  let title = raw;
  const direct = raw.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
  if (direct) {
    channelId = direct[1];
  } else {
    let targetUrl = raw;
    if (!/^https?:\/\//i.test(targetUrl)) {
      const handle = targetUrl.replace(/^@/, "");
      targetUrl = `https://www.youtube.com/@${handle}`;
    }
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      throw new Error(`Không truy cập được kênh YouTube (HTTP ${res.status}).`);
    }
    const html = await res.text();
    channelId = extractChannelIdFromHtml(html);
    if (!channelId) {
      throw new Error("Không tìm thấy channel_id từ đường dẫn YouTube này.");
    }
    const titleMatch = html.match(YT_TITLE_RE);
    if (titleMatch?.[1]) {
      title = titleMatch[1];
    }
  }

  const url =
    noShorts && channelId.startsWith("UC")
      ? `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`
      : `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  return { title, url };
}
