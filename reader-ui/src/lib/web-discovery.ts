import * as cheerio from "cheerio";
import { minifluxFetch } from "@/lib/miniflux";

export type WebsiteMethod =
  | "auto"
  | "rss"
  | "sitemap"
  | "scrape"
  | "google_news"
  | "rsshub";

export type ConcreteWebsiteMethod = Exclude<WebsiteMethod, "auto">;

export interface DiscoverCandidate {
  title: string;
  url: string;
  type: string;
  note?: string;
  docs?: string;
}

export interface PreviewItem {
  title: string;
  url: string;
  published_at?: string;
  image?: string;
  summary?: string;
}

export interface WebsiteDiscoverOptions {
  sitemapUrl?: string;
  match?: string;
  limit?: number;
  scrapeMode?: "auto" | "html" | "json";
  selector?: string;
  jsonPath?: string;
  lang?: "vi" | "en";
  customRoute?: string;
}

export interface MethodProbeResult {
  method: ConcreteWebsiteMethod;
  ok: boolean;
  label: string;
  summary: string;
  feedUrl?: string;
  feedTitle?: string;
  feeds?: DiscoverCandidate[];
  previewItems?: PreviewItem[];
  sitemaps?: Array<{ loc: string; lastmod?: string }>;
  chosenSitemap?: string;
  scrapeModeUsed?: "html" | "json";
  score: number;
  error?: string;
}

export interface WebsiteDiscoveryResponse {
  feeds: DiscoverCandidate[];
  normalizedUrl: string;
  domain: string;
  requestedMethod: WebsiteMethod;
  recommendedMethod: ConcreteWebsiteMethod | null;
  activeResult: MethodProbeResult | null;
  methods: Partial<Record<ConcreteWebsiteMethod, MethodProbeResult>>;
}

function getApifyBridgeBaseUrl(): string {
  return (process.env.APIFY_BRIDGE_URL || "http://apify-bridge:8000").replace(/\/+$/, "");
}

function getRsshubBaseUrl(): string {
  return (process.env.RSSHUB_INTERNAL_URL || "http://rsshub:1200").replace(/\/+$/, "");
}

export function normalizeWebsiteUrl(raw: string): URL {
  let val = raw.trim();
  if (!/^https?:\/\//i.test(val)) {
    val = `https://${val}`;
  }
  return new URL(val);
}

function parseXmlPreview(xmlText: string, limit = 8): { title: string; items: PreviewItem[] } {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const items: PreviewItem[] = [];

  const channelTitle = $("channel > title").first().text().trim() || $("feed > title").first().text().trim();

  $("channel > item").each((_, el) => {
    if (items.length >= limit) return;
    const node = $(el);
    const title = node.children("title").text().trim();
    const link = node.children("link").text().trim();
    const pubDate = node.children("pubDate").text().trim();
    const desc = node
      .children("description")
      .text()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (title || link) {
      items.push({ title: title || link, url: link, published_at: pubDate, summary: desc });
    }
  });

  if (items.length === 0) {
    $("feed > entry").each((_, el) => {
      if (items.length >= limit) return;
      const node = $(el);
      const title = node.children("title").text().trim();
      const link =
        node.children("link[href]").first().attr("href")?.trim() ||
        node.children("link").text().trim();
      const published =
        node.children("published").text().trim() || node.children("updated").text().trim();
      if (title || link) {
        items.push({ title: title || link, url: link, published_at: published });
      }
    });
  }

  return { title: channelTitle, items };
}

// ---------------------------------------------------------------------------
// 0. RSS mặc định (Miniflux /v1/discover)
// ---------------------------------------------------------------------------

export async function probeNativeRss(parsedUrl: URL): Promise<MethodProbeResult> {
  const normalizedUrl = parsedUrl.toString();
  try {
    let found: DiscoverCandidate[] = [];
    try {
      const discovered = await minifluxFetch<DiscoverCandidate[]>("/v1/discover", {
        method: "POST",
        body: JSON.stringify({ url: normalizedUrl }),
      });
      if (Array.isArray(discovered) && discovered.length > 0) {
        found = discovered;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("404")) {
        throw err;
      }
    }

    if (found.length === 0 && (parsedUrl.pathname === "/" || parsedUrl.pathname === "")) {
      const candidates = ["/rss", "/feed", "/rss.xml", "/feed.xml", "/atom.xml"].map(
        (suffix) => `${parsedUrl.origin}${suffix}`
      );
      const settled = await Promise.all(
        candidates.map((u) =>
          minifluxFetch<DiscoverCandidate[]>("/v1/discover", {
            method: "POST",
            body: JSON.stringify({ url: u }),
          }).catch(() => [])
        )
      );
      const merged = settled.flat().filter((f) => Boolean(f?.url));
      found = Array.from(new Map(merged.map((f) => [f.url, f])).values());
    }

    if (found.length > 0) {
      return {
        method: "rss",
        ok: true,
        label: "RSS / Atom mặc định",
        summary: `Tìm thấy ${found.length} nguồn RSS/Atom chính chủ.`,
        feedUrl: found[0].url,
        feedTitle: found[0].title || parsedUrl.hostname,
        feeds: found,
        score: 120,
      };
    }

    return {
      method: "rss",
      ok: false,
      label: "RSS / Atom mặc định",
      summary: "Trang web không cung cấp RSS/Atom mặc định.",
      score: 0,
    };
  } catch (err) {
    return {
      method: "rss",
      ok: false,
      label: "RSS / Atom mặc định",
      summary: "Không dò được RSS mặc định.",
      error: err instanceof Error ? err.message : "Lỗi kết nối Miniflux.",
      score: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 1. Sitemap.xml (apify-bridge /web/sitemap/inspect -> /web/sitemap.xml)
// ---------------------------------------------------------------------------

export async function probeSitemapMethod(
  parsedUrl: URL,
  options: WebsiteDiscoverOptions = {}
): Promise<MethodProbeResult> {
  const targetUrl = parsedUrl.toString();
  const limit = Math.max(5, Math.min(50, Number(options.limit) || 20));
  const previewLimit = Math.min(10, limit);
  const bridge = getApifyBridgeBaseUrl();

  const inspectParams = new URLSearchParams({
    url: targetUrl,
    limit: String(previewLimit),
    enrich: "true",
  });
  if (options.match?.trim()) inspectParams.set("match", options.match.trim());
  if (options.sitemapUrl?.trim()) inspectParams.set("sitemap", options.sitemapUrl.trim());

  const feedParams = new URLSearchParams({
    url: targetUrl,
    limit: String(limit),
  });
  if (options.match?.trim()) feedParams.set("match", options.match.trim());
  if (options.sitemapUrl?.trim()) feedParams.set("sitemap", options.sitemapUrl.trim());

  const feedUrl = `${bridge}/web/sitemap.xml?${feedParams.toString()}`;

  try {
    const res = await fetch(`${bridge}/web/sitemap/inspect?${inspectParams.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(16000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      feed_title?: string;
      sitemap_url?: string;
      sitemaps?: Array<{ loc: string; lastmod?: string }>;
      items?: PreviewItem[];
      detail?: string;
    };

    if (!res.ok || !data.items || data.items.length === 0) {
      return {
        method: "sitemap",
        ok: false,
        label: "1. Sitemap.xml",
        summary: data.detail || "Không tìm thấy sitemap.xml phù hợp.",
        error: data.detail,
        sitemaps: data.sitemaps || [],
        score: 0,
      };
    }

    const hasDates = data.items.some((i) => Boolean(i.published_at));
    const title = data.feed_title || `${parsedUrl.hostname} (Sitemap)`;

    return {
      method: "sitemap",
      ok: true,
      label: "1. Sitemap.xml",
      summary: `Đọc được ${data.items.length} URL mới từ ${data.sitemap_url || "sitemap.xml"}${
        data.sitemaps?.length ? ` (${data.sitemaps.length} sitemap con)` : ""
      }.`,
      feedUrl,
      feedTitle: title,
      feeds: [{ title, url: feedUrl, type: "sitemap" }],
      previewItems: data.items,
      sitemaps: data.sitemaps || [],
      chosenSitemap: data.sitemap_url,
      score: 75 + (hasDates ? 10 : 0),
    };
  } catch (err) {
    return {
      method: "sitemap",
      ok: false,
      label: "1. Sitemap.xml",
      summary: "Không kiểm tra được sitemap.xml.",
      error: err instanceof Error ? err.message : "Timeout hoặc lỗi kết nối apify-bridge.",
      score: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Scraper tổng quát miễn phí (apify-bridge /web/scrape/preview -> /web/scrape.xml)
// ---------------------------------------------------------------------------

export async function probeScrapeMethod(
  parsedUrl: URL,
  options: WebsiteDiscoverOptions = {}
): Promise<MethodProbeResult> {
  const targetUrl = parsedUrl.toString();
  const limit = Math.max(5, Math.min(50, Number(options.limit) || 20));
  const mode = options.scrapeMode || "auto";
  const bridge = getApifyBridgeBaseUrl();

  const previewParams = new URLSearchParams({
    url: targetUrl,
    mode,
    limit: String(Math.min(12, limit)),
  });
  if (options.selector?.trim()) previewParams.set("selector", options.selector.trim());
  if (options.jsonPath?.trim()) previewParams.set("json_path", options.jsonPath.trim());

  const feedParams = new URLSearchParams({
    url: targetUrl,
    mode,
    limit: String(limit),
  });
  if (options.selector?.trim()) feedParams.set("selector", options.selector.trim());
  if (options.jsonPath?.trim()) feedParams.set("json_path", options.jsonPath.trim());

  const feedUrl = `${bridge}/web/scrape.xml?${feedParams.toString()}`;

  try {
    const res = await fetch(`${bridge}/web/scrape/preview?${previewParams.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(18000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      feed_title?: string;
      mode_used?: "html" | "json";
      items?: PreviewItem[];
      detail?: string;
    };

    if (!res.ok || !data.items || data.items.length === 0) {
      return {
        method: "scrape",
        ok: false,
        label: "2. Scraper miễn phí (HTML / JSON)",
        summary: data.detail || "Không trích xuất được danh sách bài viết.",
        error: data.detail,
        score: 0,
      };
    }

    const richness = data.items.some((i) => Boolean(i.image || i.summary || i.published_at)) ? 10 : 0;
    const countScore = data.items.length >= 3 ? 80 : 45;
    const title = data.feed_title || `${parsedUrl.hostname} (Web)`;

    return {
      method: "scrape",
      ok: true,
      label: "2. Scraper miễn phí (HTML / JSON)",
      summary: `Trích xuất được ${data.items.length} bài viết (${(data.mode_used || mode).toUpperCase()}, $0).`,
      feedUrl,
      feedTitle: title,
      feeds: [{ title, url: feedUrl, type: `scrape-${data.mode_used || "html"}` }],
      previewItems: data.items,
      scrapeModeUsed: data.mode_used,
      score: countScore + richness,
    };
  } catch (err) {
    return {
      method: "scrape",
      ok: false,
      label: "2. Scraper miễn phí (HTML / JSON)",
      summary: "Không cào được trang web.",
      error: err instanceof Error ? err.message : "Timeout hoặc lỗi kết nối apify-bridge.",
      score: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. Google News RSS (site:domain)
// ---------------------------------------------------------------------------

export async function probeGoogleNewsMethod(
  parsedUrl: URL,
  options: WebsiteDiscoverOptions = {}
): Promise<MethodProbeResult> {
  const host = parsedUrl.hostname.replace(/^www\./i, "");
  const lang: "vi" | "en" =
    options.lang || (host.endsWith(".vn") ? "vi" : "vi");
  const localeParams =
    lang === "en"
      ? "hl=en-US&gl=US&ceid=US:en"
      : "hl=vi&gl=VN&ceid=VN:vi";
  const q = encodeURIComponent(`site:${host}`);
  const feedUrl = `https://news.google.com/rss/search?q=${q}&${localeParams}`;
  const title = `${host} (Google News)`;

  try {
    const res = await fetch(feedUrl, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xmlText = await res.text();
    const parsed = parseXmlPreview(xmlText, 8);
    if (parsed.items.length === 0) {
      return {
        method: "google_news",
        ok: false,
        label: "3. Google News RSS",
        summary: `Google News chưa index bài nào cho ${host} (${lang.toUpperCase()}).`,
        feedUrl,
        feedTitle: title,
        feeds: [{ title, url: feedUrl, type: "google_news" }],
        score: 0,
      };
    }

    return {
      method: "google_news",
      ok: true,
      label: "3. Google News RSS",
      summary: `Tìm thấy ${parsed.items.length}+ bài viết từ Google News cho site:${host}.`,
      feedUrl,
      feedTitle: title,
      feeds: [{ title, url: feedUrl, type: "google_news" }],
      previewItems: parsed.items,
      score: 55,
    };
  } catch (err) {
    return {
      method: "google_news",
      ok: false,
      label: "3. Google News RSS",
      summary: "Không truy vấn được Google News RSS.",
      feedUrl,
      feedTitle: title,
      feeds: [{ title, url: feedUrl, type: "google_news" }],
      error: err instanceof Error ? err.message : "Lỗi kết nối Google News.",
      score: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. RSSHub Route Check (/api/radar/rules + /api/namespace)
// ---------------------------------------------------------------------------

interface RadarRule {
  title?: string;
  docs?: string;
  source?: string[];
  target?: string;
}

interface NamespaceRoute {
  name?: string;
  path?: string;
  example?: string;
  url?: string;
  description?: string;
}

interface RsshubCatalogCache {
  expiresAt: number;
  radar: Record<string, Record<string, unknown>>;
  namespaces: Record<string, { name?: string; url?: string; routes?: Record<string, NamespaceRoute> }>;
}

let rsshubCache: RsshubCatalogCache | null = null;

async function getRsshubCatalog(): Promise<RsshubCatalogCache> {
  if (rsshubCache && Date.now() < rsshubCache.expiresAt) {
    return rsshubCache;
  }
  const base = getRsshubBaseUrl();
  const [radarRes, nsRes] = await Promise.all([
    fetch(`${base}/api/radar/rules`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
    fetch(`${base}/api/namespace`, { cache: "no-store", signal: AbortSignal.timeout(10000) }),
  ]);

  const radar = radarRes.ok
    ? ((await radarRes.json().catch(() => ({}))) as RsshubCatalogCache["radar"])
    : {};
  const namespaces = nsRes.ok
    ? ((await nsRes.json().catch(() => ({}))) as RsshubCatalogCache["namespaces"])
    : {};

  rsshubCache = {
    expiresAt: Date.now() + 60 * 60 * 1000,
    radar,
    namespaces,
  };
  return rsshubCache;
}

function matchRadarPattern(sourcePattern: string, pathname: string): Record<string, string> | null {
  const cleanPattern = sourcePattern.split("?")[0];
  const regexStr = cleanPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*([a-zA-Z0-9_]+)/g, "(?<$1>.+)")
    .replace(/:([a-zA-Z0-9_]+)\?/g, "(?:(?<$1>[^/]+))?")
    .replace(/:([a-zA-Z0-9_]+)/g, "(?<$1>[^/]+)");
  try {
    const re = new RegExp(`^${regexStr}/?$`, "i");
    const m = re.exec(pathname || "/");
    if (!m) return null;
    return (m.groups || {}) as Record<string, string>;
  } catch {
    return null;
  }
}

function fillTargetRoute(target: string, params: Record<string, string>): { route: string; resolved: boolean } {
  let out = target;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`:${k}\\??`, "g"), v || "");
  }
  // Xoá tham số tuỳ chọn chưa điền ở cuối như /:category?
  out = out.replace(/\/:[a-zA-Z0-9_]+\?/g, "");
  out = out.replace(/\/{2,}/g, "/");
  const hasUnresolved = /:[a-zA-Z0-9_]+/.test(out);
  return { route: out.startsWith("/") ? out : `/${out}`, resolved: !hasUnresolved };
}

function getDomainCandidates(hostname: string): string[] {
  const clean = hostname.toLowerCase().replace(/^www\./, "");
  const parts = clean.split(".");
  const out = [clean];
  if (parts.length > 2) {
    out.push(parts.slice(-2).join("."));
  }
  if (parts.length > 3) {
    out.push(parts.slice(-3).join("."));
  }
  return Array.from(new Set(out));
}

export async function probeRsshubMethod(
  parsedUrl: URL,
  options: WebsiteDiscoverOptions = {}
): Promise<MethodProbeResult> {
  const rsshubBase = getRsshubBaseUrl();
  const host = parsedUrl.hostname.toLowerCase();
  const domainKeys = getDomainCandidates(host);

  try {
    // Nếu người dùng nhập/sửa sẵn route RSSHub cụ thể để thử
    if (options.customRoute?.trim()) {
      const raw = options.customRoute.trim();
      const routeUrl = raw.startsWith("http")
        ? raw
        : `${rsshubBase}/${raw.replace(/^\/+/, "")}`;
      const res = await fetch(routeUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return {
          method: "rsshub",
          ok: false,
          label: "4. RSSHub Route",
          summary: `Route RSSHub trả về HTTP ${res.status}.`,
          feedUrl: routeUrl,
          error: `HTTP ${res.status}`,
          score: 0,
        };
      }
      const xmlText = await res.text();
      const parsed = parseXmlPreview(xmlText, 8);
      return {
        method: "rsshub",
        ok: parsed.items.length > 0,
        label: "4. RSSHub Route",
        summary:
          parsed.items.length > 0
            ? `Route RSSHub hoạt động (${parsed.items.length}+ bài).`
            : "Route RSSHub chạy nhưng chưa có bài viết.",
        feedUrl: routeUrl,
        feedTitle: parsed.title || `${host} (RSSHub)`,
        feeds: [{ title: parsed.title || `${host} (RSSHub)`, url: routeUrl, type: "rsshub" }],
        previewItems: parsed.items,
        score: parsed.items.length > 0 ? 100 : 20,
      };
    }

    const catalog = await getRsshubCatalog();
    const matchedCandidates: DiscoverCandidate[] = [];
    const seenUrls = new Set<string>();

    // 1. Tra cứu trong radar rules theo domain
    for (const dKey of domainKeys) {
      const domainEntry = catalog.radar[dKey];
      if (!domainEntry || typeof domainEntry !== "object") continue;

      for (const [subKey, rulesVal] of Object.entries(domainEntry)) {
        if (subKey.startsWith("_") || !Array.isArray(rulesVal)) continue;
        for (const rule of rulesVal as RadarRule[]) {
          if (!rule.target || typeof rule.target !== "string") continue;
          const sources = Array.isArray(rule.source) ? rule.source : ["/"];
          let resolvedRoute = "";
          let isExact = false;

          for (const src of sources) {
            const matched = matchRadarPattern(src, parsedUrl.pathname);
            if (matched) {
              const filled = fillTargetRoute(rule.target, matched);
              resolvedRoute = filled.route;
              isExact = filled.resolved;
              if (isExact) break;
            }
          }

          if (!resolvedRoute) {
            const filled = fillTargetRoute(rule.target, {});
            resolvedRoute = filled.route;
            isExact = filled.resolved;
          }

          const fullUrl = `${rsshubBase}${resolvedRoute}`;
          if (!seenUrls.has(fullUrl)) {
            seenUrls.add(fullUrl);
            matchedCandidates.push({
              title: `${rule.title || rule.target} (${dKey})`,
              url: fullUrl,
              type: isExact ? "rsshub" : "rsshub-template",
              note: isExact
                ? `Route khớp tự động: ${resolvedRoute}`
                : `Cần điền tham số trong route: ${resolvedRoute}`,
              docs: rule.docs,
            });
          }
        }
      }
    }

    // 2. Tra cứu thêm trong namespace routes nếu radar chưa có hoặc bổ sung ví dụ
    for (const [nsKey, nsVal] of Object.entries(catalog.namespaces)) {
      const routes = nsVal?.routes || {};
      for (const routeObj of Object.values(routes)) {
        const routeUrlHost = (routeObj.url || "").toLowerCase();
        if (!routeUrlHost) continue;
        if (!domainKeys.some((d) => routeUrlHost === d || routeUrlHost.endsWith(`.${d}`))) {
          continue;
        }
        const candidatePath = routeObj.example || `/${nsKey}${routeObj.path || ""}`;
        const normalizedPath = candidatePath.startsWith("/") ? candidatePath : `/${candidatePath}`;
        const fullUrl = `${rsshubBase}${normalizedPath}`;
        if (!seenUrls.has(fullUrl)) {
          seenUrls.add(fullUrl);
          matchedCandidates.push({
            title: `${routeObj.name || nsVal.name || nsKey} (RSSHub)`,
            url: fullUrl,
            type: routeObj.example ? "rsshub" : "rsshub-template",
            note: routeObj.example
              ? `Ví dụ từ RSSHub: ${normalizedPath}`
              : `Mẫu route: ${normalizedPath}`,
          });
        }
      }
    }

    if (matchedCandidates.length === 0) {
      return {
        method: "rsshub",
        ok: false,
        label: "4. RSSHub Route",
        summary: `Không có route sẵn cho ${host} trong RSSHub.`,
        feeds: [],
        score: 0,
      };
    }

    // Thử probe tối đa 1 route khớp chính xác đầu tiên
    const exactCandidate = matchedCandidates.find((c) => c.type === "rsshub");
    let previewItems: PreviewItem[] = [];
    let verifiedWorking = false;

    if (exactCandidate) {
      try {
        const testRes = await fetch(exactCandidate.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        });
        if (testRes.ok) {
          const xmlText = await testRes.text();
          const parsed = parseXmlPreview(xmlText, 8);
          if (parsed.items.length > 0) {
            previewItems = parsed.items;
            verifiedWorking = true;
          }
        }
      } catch {
        // Vẫn trả danh sách candidate để người dùng tự kiểm tra/chỉnh tham số
      }
    }

    const primary = exactCandidate || matchedCandidates[0];
    return {
      method: "rsshub",
      ok: true,
      label: "4. RSSHub Route",
      summary: verifiedWorking
        ? `Tìm thấy ${matchedCandidates.length} route RSSHub cho ${host} (đã xác minh chạy tốt).`
        : `Tìm thấy ${matchedCandidates.length} route RSSHub cho ${host}.`,
      feedUrl: primary.url,
      feedTitle: primary.title,
      feeds: matchedCandidates.slice(0, 12),
      previewItems,
      score: verifiedWorking ? 100 : exactCandidate ? 65 : 40,
    };
  } catch (err) {
    return {
      method: "rsshub",
      ok: false,
      label: "4. RSSHub Route",
      summary: "Không kết nối được RSSHub nội bộ.",
      error: err instanceof Error ? err.message : "Lỗi kết nối rsshub:1200.",
      score: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: Tự động chọn phương thức tốt nhất hoặc chạy phương thức chỉ định
// ---------------------------------------------------------------------------

export async function discoverWebsiteWithMethods(
  input: string,
  method: WebsiteMethod = "auto",
  options: WebsiteDiscoverOptions = {}
): Promise<WebsiteDiscoveryResponse> {
  const parsedUrl = normalizeWebsiteUrl(input);
  const normalizedUrl = parsedUrl.toString();
  const domain = parsedUrl.hostname;

  if (method !== "auto") {
    let singleResult: MethodProbeResult;
    if (method === "rss") {
      singleResult = await probeNativeRss(parsedUrl);
    } else if (method === "sitemap") {
      singleResult = await probeSitemapMethod(parsedUrl, options);
    } else if (method === "scrape") {
      singleResult = await probeScrapeMethod(parsedUrl, options);
    } else if (method === "google_news") {
      singleResult = await probeGoogleNewsMethod(parsedUrl, options);
    } else {
      singleResult = await probeRsshubMethod(parsedUrl, options);
    }

    return {
      feeds: singleResult.feeds || [],
      normalizedUrl,
      domain,
      requestedMethod: method,
      recommendedMethod: singleResult.ok ? method : null,
      activeResult: singleResult,
      methods: { [method]: singleResult },
    };
  }

  // Chế độ Tự động: ưu tiên RSS mặc định trước
  const rssResult = await probeNativeRss(parsedUrl);
  if (rssResult.ok && rssResult.feeds && rssResult.feeds.length > 0) {
    return {
      feeds: rssResult.feeds,
      normalizedUrl,
      domain,
      requestedMethod: "auto",
      recommendedMethod: "rss",
      activeResult: rssResult,
      methods: { rss: rssResult },
    };
  }

  // Không có RSS mặc định -> dò song song cả 4 phương thức dự phòng miễn phí
  const [rsshubRes, sitemapRes, scrapeRes, googleNewsRes] = await Promise.all([
    probeRsshubMethod(parsedUrl, options),
    probeSitemapMethod(parsedUrl, options),
    probeScrapeMethod(parsedUrl, options),
    probeGoogleNewsMethod(parsedUrl, options),
  ]);

  const methods: Partial<Record<ConcreteWebsiteMethod, MethodProbeResult>> = {
    rss: rssResult,
    sitemap: sitemapRes,
    scrape: scrapeRes,
    google_news: googleNewsRes,
    rsshub: rsshubRes,
  };

  const working = [rsshubRes, scrapeRes, sitemapRes, googleNewsRes].filter((r) => r.ok);
  working.sort((a, b) => b.score - a.score);
  const best = working[0] || null;

  return {
    feeds: best?.feeds || [],
    normalizedUrl,
    domain,
    requestedMethod: "auto",
    recommendedMethod: best ? best.method : null,
    activeResult: best,
    methods,
  };
}
