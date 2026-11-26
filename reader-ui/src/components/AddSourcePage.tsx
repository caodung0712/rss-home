"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Bookmark,
  Briefcase,
  Check,
  CheckCircle2,
  Cpu,
  Download,
  Facebook,
  FileJson,
  FileSpreadsheet,
  FolderPlus,
  Globe,
  Home,
  ListChecks,
  Loader2,
  Moon,
  Newspaper,
  Plus,
  Rss,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Twitter,
  Upload,
  Video,
  Youtube,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface CategoryItem {
  id: number;
  title: string;
}

interface FeedItem {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  crawler: boolean;
  parsing_error_count: number;
  parsing_error_message: string;
  category: { id: number; title: string };
}

interface Readiness {
  twitter_token_set: boolean;
  apify_token_set: boolean;
  apify_task_set: boolean;
}

interface DiscoveredFeed {
  title: string;
  url: string;
  type: string;
  note?: string;
  docs?: string;
}

type WebsiteMethod = "auto" | "rss" | "sitemap" | "scrape" | "google_news" | "rsshub";
type ConcreteWebsiteMethod = Exclude<WebsiteMethod, "auto">;

interface WebsitePreviewItem {
  title: string;
  url: string;
  published_at?: string;
  image?: string;
  summary?: string;
}

interface MethodProbeResult {
  method: ConcreteWebsiteMethod;
  ok: boolean;
  label: string;
  summary: string;
  feedUrl?: string;
  feedTitle?: string;
  feeds?: DiscoveredFeed[];
  previewItems?: WebsitePreviewItem[];
  sitemaps?: Array<{ loc: string; lastmod?: string }>;
  chosenSitemap?: string;
  scrapeModeUsed?: "html" | "json";
  score: number;
  error?: string;
}

interface WebsiteDiscoverResponse {
  feeds?: DiscoveredFeed[];
  normalizedUrl?: string;
  domain?: string;
  requestedMethod?: WebsiteMethod;
  recommendedMethod?: ConcreteWebsiteMethod | null;
  activeResult?: MethodProbeResult | null;
  methods?: Partial<Record<ConcreteWebsiteMethod, MethodProbeResult>>;
  error?: string;
}

type SourceSection =
  | "website"
  | "youtube"
  | "tiktok"
  | "linkedin"
  | "x"
  | "facebook"
  | "google_news"
  | "social_other"
  | "import"
  | "manage";

interface TopicPreset {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  folder: string;
  feeds: Array<{ title: string; url: string }>;
}

const TOPIC_PRESETS: TopicPreset[] = [
  {
    id: "tech",
    title: "Công nghệ & AI",
    subtitle: "Tinhte, Hacker News, OpenAI...",
    gradient: "from-sky-600 to-indigo-700",
    folder: "Tech",
    feeds: [
      { title: "Tinh tế", url: "https://tinhte.vn/rss" },
      { title: "Hacker News (Best)", url: "https://hnrss.org/best" },
      { title: "OpenAI News", url: "https://openai.com/news/rss.xml" },
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
    ],
  },
  {
    id: "news",
    title: "Tin tức Việt Nam",
    subtitle: "VnExpress, Tuổi Trẻ, Thanh Niên",
    gradient: "from-emerald-600 to-teal-700",
    folder: "News",
    feeds: [
      { title: "VnExpress - Tin mới nhất", url: "https://vnexpress.net/rss/tin-moi-nhat.rss" },
      { title: "Tuổi Trẻ - Trang chủ", url: "https://tuoitre.vn/rss/tin-moi-nhat.rss" },
      { title: "Thanh Niên - Tin mới", url: "https://thanhnien.vn/rss/home.rss" },
    ],
  },
  {
    id: "finance",
    title: "Tài chính & Kinh doanh",
    subtitle: "CafeF, VnEconomy, Vietstock",
    gradient: "from-amber-600 to-orange-700",
    folder: "Finance",
    feeds: [
      { title: "CafeF - Trang chủ", url: "https://cafef.vn/trang-chu.rss" },
      { title: "VnExpress Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
      { title: "Vietstock", url: "https://vietstock.vn/761/rss/chung-khoan.rss" },
    ],
  },
  {
    id: "crypto",
    title: "Crypto & Web3",
    subtitle: "CoinDesk, Cointelegraph, Decrypt",
    gradient: "from-violet-600 to-purple-800",
    folder: "Crypto",
    feeds: [
      { title: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { title: "Cointelegraph", url: "https://cointelegraph.com/rss" },
      { title: "Decrypt", url: "https://decrypt.co/feed" },
    ],
  },
  {
    id: "marketing",
    title: "Marketing & Growth",
    subtitle: "Brands Vietnam, Search Engine Journal",
    gradient: "from-rose-600 to-pink-700",
    folder: "Marketing",
    feeds: [
      { title: "Brands Vietnam", url: "https://www.brandsvietnam.com/rss" },
      { title: "Search Engine Land", url: "https://searchengineland.com/feed" },
      { title: "HubSpot Marketing", url: "https://blog.hubspot.com/marketing/rss.xml" },
    ],
  },
];

export default function AddSourcePage() {
  const { locale, t } = useI18n();
  const L = (vi: string, en: string) => (locale === "en" ? en : vi);
  const [darkMode, setDarkMode] = useState(false);
  const [section, setSection] = useState<SourceSection>("website");

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [feeds, setFeeds] = useState<FeedItem[]>([]);
  const [readiness, setReadiness] = useState<Readiness>({
    twitter_token_set: false,
    apify_token_set: false,
    apify_task_set: false,
  });

  // Chọn thư mục đích chung
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("new");
  const [newFolderName, setNewFolderName] = useState("");

  // Website / RSS discover
  const [websiteInput, setWebsiteInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredFeed[]>([]);
  const [websiteCrawler, setWebsiteCrawler] = useState(false);
  const [websiteMethod, setWebsiteMethod] = useState<WebsiteMethod>("auto");
  const [activeMethodTab, setActiveMethodTab] = useState<ConcreteWebsiteMethod | null>(null);
  const [websiteProbeMap, setWebsiteProbeMap] = useState<
    Partial<Record<ConcreteWebsiteMethod, MethodProbeResult>>
  >({});
  const [recommendedMethod, setRecommendedMethod] = useState<ConcreteWebsiteMethod | null>(null);
  const [websiteCustomTitle, setWebsiteCustomTitle] = useState("");
  // Tuỳ chọn từng phương thức Website
  const [sitemapUrlOpt, setSitemapUrlOpt] = useState("");
  const [sitemapMatchOpt, setSitemapMatchOpt] = useState("");
  const [sitemapLimitOpt, setSitemapLimitOpt] = useState(20);
  const [scrapeModeOpt, setScrapeModeOpt] = useState<"auto" | "html" | "json">("auto");
  const [scrapeSelectorOpt, setScrapeSelectorOpt] = useState("");
  const [scrapeJsonPathOpt, setScrapeJsonPathOpt] = useState("");
  const [scrapeLimitOpt, setScrapeLimitOpt] = useState(20);
  const [gnSiteLangOpt, setGnSiteLangOpt] = useState<"vi" | "en">("vi");
  const [rsshubRouteOpt, setRsshubRouteOpt] = useState("");
  const [activeTopic, setActiveTopic] = useState<TopicPreset | null>(TOPIC_PRESETS[0]);

  // YouTube
  const [ytInput, setYtInput] = useState("");
  const [ytNoShorts, setYtNoShorts] = useState(true);
  const [ytPreview, setYtPreview] = useState<DiscoveredFeed | null>(null);

  // X (Twitter)
  const [xHandle, setXHandle] = useState("");
  const [xTitle, setXTitle] = useState("");
  const [xUseFx, setXUseFx] = useState(false);

  // TikTok
  const [ttHandle, setTtHandle] = useState("");
  const [ttTitle, setTtTitle] = useState("");

  // LinkedIn
  const [liMode, setLiMode] = useState<"profile" | "jobs" | "google">("profile");
  const [liInput, setLiInput] = useState("");
  const [liTitle, setLiTitle] = useState("");

  // Facebook
  const [fbMode, setFbMode] = useState<"free" | "apify">("free");
  const [fbKind, setFbKind] = useState<"page" | "reels">("page");
  const [fbUrl, setFbUrl] = useState("");
  const [fbName, setFbName] = useState("");
  const [fbApifyLimit, setFbApifyLimit] = useState(15);

  // Google News / Alerts
  const [gnMode, setGnMode] = useState<"keyword" | "alerts">("keyword");
  const [gnQuery, setGnQuery] = useState("");
  const [gnLang, setGnLang] = useState<"vi" | "en">("vi");
  const [alertsUrl, setAlertsUrl] = useState("");
  const [alertsTitle, setAlertsTitle] = useState("");

  // Telegram / Bluesky / RSSHub
  const [otherKind, setOtherKind] = useState<"telegram" | "bluesky" | "rsshub">("telegram");
  const [otherInput, setOtherInput] = useState("");
  const [otherTitle, setOtherTitle] = useState("");

  // Import / Export kênh
  const [channelsUploading, setChannelsUploading] = useState(false);
  const [overwriteExistingChannels, setOverwriteExistingChannels] = useState(false);
  const [channelsSummary, setChannelsSummary] = useState<{
    total: number;
    added: number;
    updated: number;
    exists: number;
    error: number;
  } | null>(null);
  const [channelsResults, setChannelsResults] = useState<
    Array<{
      index: number;
      title: string;
      feed_url: string;
      category: string;
      status: "added" | "updated" | "exists" | "error";
      message: string;
    }>
  >([]);
  const [opmlUploading, setOpmlUploading] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvNoShorts, setCsvNoShorts] = useState(true);
  const [csvResults, setCsvResults] = useState<
    Array<{
      row: number;
      platform: string;
      name: string;
      status: string;
      message: string;
    }>
  >([]);

  // Quản lý nguồn
  const [manageQuery, setManageQuery] = useState("");

  // Thông báo trạng thái
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  useEffect(() => {
    const saved = localStorage.getItem("rss-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved ? saved === "dark" : prefersDark;
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);

    const qs = new URLSearchParams(window.location.search);
    const sec = qs.get("section") as SourceSection | null;
    if (sec && ["website", "youtube", "tiktok", "linkedin", "x", "facebook", "google_news", "social_other", "import", "manage"].includes(sec)) {
      setSection(sec);
    }
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("rss-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/sources/config", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        categories: CategoryItem[];
        feeds: FeedItem[];
        readiness: Readiness;
      };
      setCategories(data.categories || []);
      setFeeds(data.feeds || []);
      setReadiness(data.readiness);
      if (data.categories?.length && selectedCategoryId === "new" && !newFolderName) {
        setSelectedCategoryId(String(data.categories[0].id));
      }
    } catch {
      // ignore
    }
  }, [selectedCategoryId, newFolderName]);

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingFeedUrls = useMemo(
    () => new Set(feeds.map((f) => f.feed_url)),
    [feeds]
  );

  const getFolderPayload = (fallbackFolder?: string) => {
    if (selectedCategoryId === "new") {
      return { newCategoryTitle: newFolderName.trim() || fallbackFolder || "Chung" };
    }
    const cid = Number(selectedCategoryId);
    if (Number.isFinite(cid) && cid > 0) {
      return { categoryId: cid };
    }
    return { newCategoryTitle: fallbackFolder || "Chung" };
  };

  const subscribe = async (payload: Record<string, unknown>, successMsg?: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sources/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        feed_url?: string;
      };
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Không thể thêm nguồn." });
        return false;
      }
      setFeedback({
        type: "ok",
        text: successMsg || `✓ Đã thêm nguồn thành công (${data.feed_url || ""}).`,
      });
      await loadConfig();
      return true;
    } catch {
      setFeedback({ type: "err", text: "Lỗi kết nối máy chủ." });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const runWebsiteDiscover = async (
    targetMethod: WebsiteMethod = websiteMethod,
    mergeIntoExisting = false
  ) => {
    if (!websiteInput.trim()) return;
    setDiscovering(true);
    setFeedback(null);
    if (!mergeIntoExisting) {
      setDiscovered([]);
      setWebsiteProbeMap({});
      setRecommendedMethod(null);
      setActiveMethodTab(null);
      setWebsiteCustomTitle("");
    }
    try {
      const res = await fetch("/api/sources/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "website",
          input: websiteInput,
          method: targetMethod,
          options: {
            sitemapUrl: sitemapUrlOpt.trim() || undefined,
            match: sitemapMatchOpt.trim() || undefined,
            limit: targetMethod === "sitemap" ? sitemapLimitOpt : scrapeLimitOpt,
            scrapeMode: scrapeModeOpt,
            selector: scrapeSelectorOpt.trim() || undefined,
            jsonPath: scrapeJsonPathOpt.trim() || undefined,
            lang: gnSiteLangOpt,
            customRoute: rsshubRouteOpt.trim() || undefined,
          },
        }),
      });
      const data = (await res.json()) as WebsiteDiscoverResponse;
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Không tìm thấy nguồn phù hợp." });
        return;
      }

      const incomingMethods = data.methods || {};
      setWebsiteProbeMap((prev) =>
        mergeIntoExisting ? { ...prev, ...incomingMethods } : incomingMethods
      );

      if (targetMethod === "auto") {
        setRecommendedMethod(data.recommendedMethod || null);
        const firstTab =
          data.recommendedMethod ||
          (incomingMethods.rss?.ok
            ? "rss"
            : incomingMethods.scrape
              ? "scrape"
              : "sitemap");
        setActiveMethodTab(firstTab);
        const active = incomingMethods[firstTab] || data.activeResult;
        setDiscovered(active?.feeds || data.feeds || []);
        if (active?.feedTitle) setWebsiteCustomTitle(active.feedTitle);
        if (!data.recommendedMethod) {
          setFeedback({
            type: "err",
            text: L(
              "Không tự động dò được nguồn khả dụng. Bạn hãy chọn từng phương thức bên dưới để tinh chỉnh (nhập CSS selector, chọn sitemap con, hoặc điền route RSSHub).",
              "Could not auto-detect a working feed. Choose any method below to customize options (CSS selector, child sitemap, or RSSHub route)."
            ),
          });
        }
      } else {
        setActiveMethodTab(targetMethod);
        const resForMethod = incomingMethods[targetMethod] || data.activeResult || null;
        setDiscovered(resForMethod?.feeds || data.feeds || []);
        if (resForMethod?.feedTitle) setWebsiteCustomTitle(resForMethod.feedTitle);
        if (resForMethod && !resForMethod.ok) {
          setFeedback({
            type: "err",
            text: resForMethod.error || resForMethod.summary,
          });
        }
      }
    } catch {
      setFeedback({ type: "err", text: "Không dò được RSS từ trang web." });
    } finally {
      setDiscovering(false);
    }
  };

  const handleDiscoverWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    await runWebsiteDiscover(websiteMethod, false);
  };

  const handleSelectMethodTab = (method: ConcreteWebsiteMethod) => {
    setActiveMethodTab(method);
    setFeedback(null);
    const cached = websiteProbeMap[method];
    if (cached) {
      setDiscovered(cached.feeds || []);
      if (cached.feedTitle) setWebsiteCustomTitle(cached.feedTitle);
    } else if (websiteInput.trim()) {
      void runWebsiteDiscover(method, true);
    }
  };

  const handleDiscoverYouTube = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytInput.trim()) return;
    setDiscovering(true);
    setFeedback(null);
    setYtPreview(null);
    try {
      const res = await fetch("/api/sources/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "youtube",
          input: ytInput,
          noShorts: ytNoShorts,
        }),
      });
      const data = (await res.json()) as {
        feeds?: DiscoveredFeed[];
        error?: string;
      };
      if (!res.ok || !data.feeds?.length) {
        setFeedback({
          type: "err",
          text: data.error || "Không tìm thấy kênh YouTube.",
        });
      } else {
        setYtPreview(data.feeds[0]);
      }
    } catch {
      setFeedback({ type: "err", text: "Không kết nối được YouTube." });
    } finally {
      setDiscovering(false);
    }
  };

  const handleUploadOpml = async (file: File) => {
    setOpmlUploading(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sources/import-opml", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Import OPML thất bại." });
      } else {
        setFeedback({ type: "ok", text: data.message || "Đã import OPML thành công!" });
        await loadConfig();
      }
    } catch {
      setFeedback({ type: "err", text: "Lỗi khi tải file OPML." });
    } finally {
      setOpmlUploading(false);
    }
  };

  const handleUploadCsv = async (file: File) => {
    setCsvUploading(true);
    setFeedback(null);
    setCsvResults([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("noShorts", csvNoShorts ? "true" : "false");
      const res = await fetch("/api/sources/import-csv", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        results?: typeof csvResults;
        error?: string;
      };
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Import CSV thất bại." });
      } else {
        setCsvResults(data.results || []);
        setFeedback({ type: "ok", text: "Đã xử lý xong file social.csv!" });
        await loadConfig();
      }
    } catch {
      setFeedback({ type: "err", text: "Lỗi khi tải file CSV." });
    } finally {
      setCsvUploading(false);
    }
  };

  const handleUploadChannelsJson = async (file: File) => {
    setChannelsUploading(true);
    setFeedback(null);
    setChannelsSummary(null);
    setChannelsResults([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("overwriteExisting", overwriteExistingChannels ? "true" : "false");
      const res = await fetch("/api/sources/import-channels", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        summary?: typeof channelsSummary;
        results?: typeof channelsResults;
        error?: string;
      };
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Import file kênh JSON thất bại." });
      } else {
        setChannelsSummary(data.summary || null);
        setChannelsResults(data.results || []);
        const s = data.summary;
        setFeedback({
          type: "ok",
          text: s
            ? `Đã xử lý ${s.total} kênh: thêm mới ${s.added}, cập nhật ${s.updated}, đã có ${s.exists}, lỗi ${s.error}.`
            : "Đã import danh sách kênh thành công!",
        });
        await loadConfig();
      }
    } catch {
      setFeedback({ type: "err", text: "Lỗi khi tải file JSON danh sách kênh." });
    } finally {
      setChannelsUploading(false);
    }
  };

  const handleToggleCrawler = async (feed: FeedItem) => {
    const nextCrawler = !feed.crawler;
    setFeeds((prev) =>
      prev.map((f) => (f.id === feed.id ? { ...f, crawler: nextCrawler } : f))
    );
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crawler: nextCrawler }),
    });
  };

  const handleDeleteFeed = async (feed: FeedItem) => {
    const res = await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (res.ok) {
      setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
      setFeedback({ type: "ok", text: `Đã huỷ theo dõi "${feed.title}".` });
    }
  };

  const navItems: Array<{
    id: SourceSection;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: "website", label: "Website / RSS", icon: <Globe className="w-4 h-4" /> },
    { id: "youtube", label: L("Kênh YouTube", "YouTube Channels"), icon: <Youtube className="w-4 h-4 text-red-500" /> },
    { id: "tiktok", label: L("Kênh TikTok", "TikTok Channels"), icon: <Video className="w-4 h-4 text-pink-600" /> },
    { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-4 h-4 text-blue-700" /> },
    { id: "x", label: L("Tài khoản X", "X Accounts"), icon: <Twitter className="w-4 h-4 text-sky-500" /> },
    { id: "facebook", label: L("Trang Facebook", "Facebook Pages"), icon: <Facebook className="w-4 h-4 text-blue-600" /> },
    { id: "google_news", label: "Google News / Alerts", icon: <Search className="w-4 h-4 text-emerald-600" /> },
    { id: "social_other", label: "Telegram / RSSHub", icon: <Send className="w-4 h-4 text-indigo-500" /> },
    { id: "import", label: L("Import / Export kênh", "Import / Export"), icon: <Upload className="w-4 h-4 text-amber-600" /> },
    { id: "manage", label: L(`Đang theo dõi (${feeds.length})`, `Following (${feeds.length})`), icon: <ListChecks className="w-4 h-4 text-slate-500" /> },
  ];

  const folderPicker = (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <FolderPlus className="w-4 h-4 text-green-600" />
        {L("Lưu vào thư mục:", "Save to folder:")}
      </span>
      <select
        value={selectedCategoryId}
        onChange={(e) => setSelectedCategoryId(e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      >
        {categories.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.title}
          </option>
        ))}
        <option value="new">{L("+ Tạo thư mục mới...", "+ Create new folder...")}</option>
      </select>
      {selectedCategoryId === "new" && (
        <input
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder={L("Tên thư mục mới (vd: Finance, Crypto)", "New folder name (e.g. Finance, Crypto)")}
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      )}
    </div>
  );

  const filteredManageFeeds = useMemo(() => {
    const q = manageQuery.trim().toLowerCase();
    if (!q) return feeds;
    return feeds.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.feed_url.toLowerCase().includes(q) ||
        (f.category?.title || "").toLowerCase().includes(q)
    );
  }, [feeds, manageQuery]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Thanh icon ngoài cùng bên trái (giống Inoreader) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-12 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 py-2">
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/"
            title={t("newsfeed")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Home className="w-4 h-4" />
          </Link>
          <Link
            href="/"
            title={t("saved")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Bookmark className="w-4 h-4" />
          </Link>
          <Link
            href="/add"
            title={t("addSource")}
            className="p-2 rounded-lg bg-green-600 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Link
            href="/manage"
            title={t("manageContent")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <Link
            href="/status"
            title={t("systemStatus")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Activity className="w-4 h-4" />
          </Link>
          <button
            onClick={toggleTheme}
            title={t("darkMode")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Cột danh mục Thêm mới */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="h-12 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <span className="font-bold text-sm">{L("Thêm mới", "Add new")}</span>
          <Link
            href="/"
            className="text-xs text-green-600 hover:underline font-medium"
          >
            {t("backToReader")}
          </Link>
        </div>

        <nav className="p-2 space-y-1 flex-1 overflow-y-auto text-sm">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id);
                setFeedback(null);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                section === item.id
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold"
                  : "hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Nội dung chính bên phải */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Mobile header + tabs */}
        <div className="md:hidden border-b border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-base">{t("addSource")}</h1>
            <Link
              href="/"
              className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium"
            >
              {t("backToReader")}
            </Link>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setSection(item.id);
                  setFeedback(null);
                }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${
                  section === item.id
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-4xl w-full mx-auto px-4 md:px-10 py-8 space-y-6">
          {/* Thông báo kết quả */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-sm flex items-start gap-2.5 ${
                feedback.type === "ok"
                  ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200"
                  : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200"
              }`}
            >
              {feedback.type === "ok" ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Bộ chọn thư mục dùng chung (trừ mục import & quản lý) */}
          {section !== "import" && section !== "manage" && folderPicker}

          {/* 1. WEBSITE / RSS */}
          {section === "website" && (
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-bold">{L("Theo dõi Website hoặc RSS", "Follow Website or RSS")}</h2>
                <form onSubmit={handleDiscoverWebsite} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      placeholder={L("Nhập địa chỉ trang web (vd: vnexpress.net, bbw.vn) hoặc dán URL RSS...", "Enter website URL (e.g. techcrunch.com) or paste RSS URL...")}
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={discovering}
                    className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 shrink-0"
                  >
                    {discovering && <Loader2 className="w-4 h-4 animate-spin" />}
                    {L("Tìm feed", "Find feed")}
                  </button>
                </form>

                {/* Chọn phương thức dò / vượt trang không có RSS */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {L(
                      "Phương thức lấy tin (Tự động chọn cách phù hợp nhất trước, hoặc bấm chọn cách bạn muốn thử):",
                      "Discovery method (Auto picks the best match first, or pick any method manually):"
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "auto", label: L("✨ Tự động (Khuyên dùng)", "✨ Auto (Recommended)") },
                        { id: "rss", label: L("RSS mặc định", "Native RSS") },
                        { id: "sitemap", label: "1. Sitemap.xml" },
                        { id: "scrape", label: L("2. Scraper miễn phí ($0)", "2. Free Scraper ($0)") },
                        { id: "google_news", label: "3. Google News RSS" },
                        { id: "rsshub", label: "4. RSSHub Route" },
                      ] as Array<{ id: WebsiteMethod; label: string }>
                    ).map((m) => {
                      const isSelected =
                        websiteMethod === m.id ||
                        (websiteMethod === "auto" && activeMethodTab === m.id);
                      const probe = m.id !== "auto" ? websiteProbeMap[m.id] : undefined;
                      const isRec = m.id !== "auto" && recommendedMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={discovering}
                          onClick={() => {
                            setWebsiteMethod(m.id);
                            if (m.id === "auto") {
                              if (websiteInput.trim() && Object.keys(websiteProbeMap).length > 0) {
                                void runWebsiteDiscover("auto", false);
                              }
                            } else {
                              handleSelectMethodTab(m.id);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs border inline-flex items-center gap-1.5 transition-colors ${
                            isSelected
                              ? "border-blue-600 bg-blue-600 text-white font-semibold"
                              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          <span>{m.label}</span>
                          {probe && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                isSelected
                                  ? "bg-white/20 text-white"
                                  : probe.ok
                                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                    : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                              }`}
                            >
                              {probe.ok ? "✓" : "—"}
                            </span>
                          )}
                          {isRec && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                isSelected
                                  ? "bg-amber-300 text-slate-900"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              }`}
                            >
                              {L("Đề xuất", "Best")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tuỳ chọn nâng cao theo phương thức đang chọn */}
                {(() => {
                  const shownMethod: ConcreteWebsiteMethod | null =
                    websiteMethod !== "auto" ? websiteMethod : activeMethodTab;
                  const activeProbe = shownMethod ? websiteProbeMap[shownMethod] : undefined;
                  if (!shownMethod || shownMethod === "rss") {
                    return null;
                  }

                  return (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {shownMethod === "sitemap" && L("Tuỳ chỉnh 1. Sitemap.xml", "Options: 1. Sitemap.xml")}
                          {shownMethod === "scrape" && L("Tuỳ chỉnh 2. Scraper miễn phí (HTML / JSON API)", "Options: 2. Free Scraper (HTML / JSON API)")}
                          {shownMethod === "google_news" && L("Tuỳ chỉnh 3. Google News RSS", "Options: 3. Google News RSS")}
                          {shownMethod === "rsshub" && L("Tuỳ chỉnh 4. RSSHub Route", "Options: 4. RSSHub Route")}
                        </div>
                        {websiteInput.trim() && (
                          <button
                            type="button"
                            disabled={discovering}
                            onClick={() => void runWebsiteDiscover(shownMethod, true)}
                            className="px-3 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                          >
                            {discovering && <Loader2 className="w-3 h-3 animate-spin" />}
                            {L("Thử phương thức này", "Test this method")}
                          </button>
                        )}
                      </div>

                      {shownMethod === "sitemap" && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                          {activeProbe?.sitemaps && activeProbe.sitemaps.length > 0 && (
                            <select
                              value={sitemapUrlOpt}
                              onChange={(e) => setSitemapUrlOpt(e.target.value)}
                              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                            >
                              <option value="">{L("Tự chọn sitemap con phù hợp nhất", "Auto-pick best child sitemap")}</option>
                              {activeProbe.sitemaps.map((sm) => (
                                <option key={sm.loc} value={sm.loc}>
                                  {sm.loc.replace(/^https?:\/\/[^/]+/, "")}
                                </option>
                              ))}
                            </select>
                          )}
                          <input
                            type="text"
                            value={sitemapMatchOpt}
                            onChange={(e) => setSitemapMatchOpt(e.target.value)}
                            placeholder={L("Lọc URL chứa chuỗi (vd: /tin-tuc/, /blog/)", "Filter URL path (e.g. /blog/, /news/)")}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <select
                            value={sitemapLimitOpt}
                            onChange={(e) => setSitemapLimitOpt(Number(e.target.value))}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          >
                            <option value={10}>10 {L("bài mới nhất", "latest items")}</option>
                            <option value={20}>20 {L("bài mới nhất", "latest items")}</option>
                            <option value={30}>30 {L("bài mới nhất", "latest items")}</option>
                            <option value={50}>50 {L("bài mới nhất", "latest items")}</option>
                          </select>
                        </div>
                      )}

                      {shownMethod === "scrape" && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
                          <select
                            value={scrapeModeOpt}
                            onChange={(e) => setScrapeModeOpt(e.target.value as "auto" | "html" | "json")}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          >
                            <option value="auto">{L("Tự nhận diện HTML / JSON", "Auto-detect HTML / JSON")}</option>
                            <option value="html">HTML Page</option>
                            <option value="json">JSON API</option>
                          </select>
                          <input
                            type="text"
                            value={scrapeSelectorOpt}
                            onChange={(e) => setScrapeSelectorOpt(e.target.value)}
                            placeholder={L("CSS selector tuỳ chọn (vd: article, .post-card)", "Optional CSS selector (e.g. article, .post)")}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <input
                            type="text"
                            value={scrapeJsonPathOpt}
                            onChange={(e) => setScrapeJsonPathOpt(e.target.value)}
                            placeholder={L("JSON path nếu là API (vd: data.items)", "JSON path if API (e.g. data.items)")}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <select
                            value={scrapeLimitOpt}
                            onChange={(e) => setScrapeLimitOpt(Number(e.target.value))}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          >
                            <option value={10}>10 {L("bài", "items")}</option>
                            <option value={20}>20 {L("bài", "items")}</option>
                            <option value={30}>30 {L("bài", "items")}</option>
                            <option value={50}>50 {L("bài", "items")}</option>
                          </select>
                        </div>
                      )}

                      {shownMethod === "google_news" && (
                        <div className="flex flex-wrap items-center gap-2.5 text-xs">
                          <span className="text-slate-500">{L("Ngôn ngữ tìm kiếm:", "Search edition:")}</span>
                          <select
                            value={gnSiteLangOpt}
                            onChange={(e) => setGnSiteLangOpt(e.target.value as "vi" | "en")}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          >
                            <option value="vi">Tiếng Việt (VN)</option>
                            <option value="en">English (US)</option>
                          </select>
                        </div>
                      )}

                      {shownMethod === "rsshub" && (
                        <div className="space-y-2 text-xs">
                          <input
                            type="text"
                            value={rsshubRouteOpt}
                            onChange={(e) => setRsshubRouteOpt(e.target.value)}
                            placeholder={L("Route RSSHub tuỳ chọn để thử (vd: /vnexpress/tin-tuc hoặc để trống để tự tìm)", "Optional RSSHub route to test (e.g. /vnexpress/tin-tuc)")}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>
                      )}

                      {activeProbe && (
                        <div
                          className={`text-xs ${
                            activeProbe.ok
                              ? "text-green-700 dark:text-green-300"
                              : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {activeProbe.summary}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={websiteCrawler}
                    onChange={(e) => setWebsiteCrawler(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  {L("Tự lấy toàn văn bài viết (bật cho blog chỉ đăng đoạn tóm tắt trong RSS)", "Auto-fetch full article text (for summary-only RSS feeds)")}
                </label>

                {/* Kết quả dò RSS / Feed đề xuất */}
                {discovered.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {L(`Tìm thấy ${discovered.length} nguồn phù hợp`, `Found ${discovered.length} feed(s)`)}
                      </div>
                      <input
                        type="text"
                        value={websiteCustomTitle}
                        onChange={(e) => setWebsiteCustomTitle(e.target.value)}
                        placeholder={L("Tên hiển thị tuỳ chọn (nếu muốn đổi)", "Optional custom feed title")}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs min-w-[220px]"
                      />
                    </div>
                    {discovered.map((feed) => {
                      const already = existingFeedUrls.has(feed.url);
                      return (
                        <div
                          key={feed.url}
                          className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm truncate">
                                {feed.title || feed.url}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-500 uppercase shrink-0">
                                {feed.type}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {feed.url}
                            </div>
                            {feed.note && (
                              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                {feed.note}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {feed.type === "rsshub-template" && (
                              <button
                                type="button"
                                onClick={() => {
                                  const pathOnly = feed.url.replace(/^http:\/\/rsshub:1200/i, "");
                                  setRsshubRouteOpt(pathOnly);
                                  setWebsiteMethod("rsshub");
                                  setActiveMethodTab("rsshub");
                                }}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {L("Sửa route", "Edit route")}
                              </button>
                            )}
                            {already ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 shrink-0">
                                <Check className="w-3.5 h-3.5 text-green-600" />
                                {L("Đã theo dõi", "Following")}
                              </span>
                            ) : (
                              <button
                                disabled={submitting}
                                onClick={() =>
                                  void subscribe({
                                    platform: "rss",
                                    feedUrl: feed.url,
                                    title: websiteCustomTitle.trim() || feed.title,
                                    crawler: websiteCrawler,
                                    ...getFolderPayload(),
                                  })
                                }
                                className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shrink-0"
                              >
                                {L("+ Theo dõi", "+ Follow")}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Xem trước các bài viết lấy được từ phương thức đang chọn */}
                    {activeMethodTab &&
                      websiteProbeMap[activeMethodTab]?.previewItems &&
                      websiteProbeMap[activeMethodTab]!.previewItems!.length > 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2">
                          <div className="text-xs font-semibold text-slate-500">
                            {L(
                              `Xem trước ${websiteProbeMap[activeMethodTab]!.previewItems!.length} bài lấy thử:`,
                              `Preview of ${websiteProbeMap[activeMethodTab]!.previewItems!.length} extracted item(s):`
                            )}
                          </div>
                          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {websiteProbeMap[activeMethodTab]!.previewItems!.slice(0, 6).map((item) => (
                              <li key={item.url} className="py-1.5 flex items-baseline justify-between gap-3">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium line-clamp-1"
                                >
                                  {item.title}
                                </a>
                                {item.published_at && (
                                  <span className="text-[11px] text-slate-400 shrink-0">
                                    {item.published_at.slice(0, 10)}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
              </div>

              {/* Khám phá theo chủ đề (giống Explore topics của Inoreader) */}
              <div className="space-y-4">
                <h3 className="text-base font-bold">{L("Khám phá nhanh theo chủ đề", "Quick Explore by Topic")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {TOPIC_PRESETS.map((topic) => {
                    const selected = activeTopic?.id === topic.id;
                    return (
                      <button
                        key={topic.id}
                        onClick={() => setActiveTopic(topic)}
                        className={`relative h-28 rounded-xl p-3 text-left text-white bg-gradient-to-br ${topic.gradient} flex flex-col justify-between transition-transform hover:scale-[1.02] ${
                          selected ? "ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-slate-950" : ""
                        }`}
                      >
                        <div className="opacity-80">
                          {topic.id === "tech" && <Cpu className="w-5 h-5" />}
                          {topic.id === "news" && <Newspaper className="w-5 h-5" />}
                          {topic.id === "finance" && <TrendingUp className="w-5 h-5" />}
                          {topic.id === "crypto" && <Sparkles className="w-5 h-5" />}
                          {topic.id === "marketing" && <Rss className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="font-bold text-sm leading-tight">
                            {topic.title}
                          </div>
                          <div className="text-[11px] opacity-85 line-clamp-1 mt-0.5">
                            {topic.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeTopic && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 divide-y divide-slate-200 dark:divide-slate-800">
                    {activeTopic.feeds.map((preset) => {
                      const already = existingFeedUrls.has(preset.url);
                      return (
                        <div
                          key={preset.url}
                          className="p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{preset.title}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {preset.url}
                            </div>
                          </div>
                          {already ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-xs text-slate-500 shrink-0">
                              <Check className="w-3.5 h-3.5 text-green-600" />
                              {L("Đã theo dõi", "Following")}
                            </span>
                          ) : (
                            <button
                              disabled={submitting}
                              onClick={() =>
                                void subscribe({
                                  platform: "rss",
                                  feedUrl: preset.url,
                                  title: preset.title,
                                  ...getFolderPayload(activeTopic.folder),
                                })
                              }
                              className="px-3.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shrink-0"
                            >
                              {L("+ Theo dõi", "+ Follow")}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. YOUTUBE */}
          {section === "youtube" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{L("Theo dõi kênh YouTube", "Follow YouTube Channel")}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {L(
                    "Dán link kênh (`https://www.youtube.com/@...`) hoặc chỉ gõ `@handle`, hệ thống tự lấy RSS chính chủ (miễn phí, không cần API key).",
                    "Paste a channel link (`https://www.youtube.com/@...`) or enter `@handle` to resolve its native RSS feed (free, no API key required)."
                  )}
                </p>
              </div>

              <form onSubmit={handleDiscoverYouTube} className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ytInput}
                    onChange={(e) => setYtInput(e.target.value)}
                    placeholder={L("Ví dụ: https://www.youtube.com/@mkbhd hoặc @Tinhte", "e.g. https://www.youtube.com/@mkbhd or @veritasium")}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    type="submit"
                    disabled={discovering}
                    className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    {discovering && <Loader2 className="w-4 h-4 animate-spin" />}
                    {L("Tìm kênh", "Find channel")}
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ytNoShorts}
                    onChange={(e) => setYtNoShorts(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  {L("Bỏ video Shorts (chỉ lấy video dài qua playlist UULF)", "Exclude Shorts (long-form videos only via UULF playlist)")}
                </label>
              </form>

              {ytPreview && (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{ytPreview.title}</div>
                    <div className="text-xs text-slate-500 truncate">{ytPreview.url}</div>
                  </div>
                  <button
                    disabled={submitting}
                    onClick={() =>
                      void subscribe({
                        platform: "youtube",
                        feedUrl: ytPreview.url,
                        title: ytPreview.title,
                        ...getFolderPayload("YouTube"),
                      })
                    }
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shrink-0"
                  >
                    {L("+ Theo dõi kênh", "+ Follow channel")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. TIKTOK (MIỄN PHÍ QUA RSSHUB) */}
          {section === "tiktok" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{L("Theo dõi kênh TikTok (Miễn phí $0)", "Follow TikTok Channel (Free $0)")}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {L(
                    "Chạy hoàn toàn qua RSSHub nội bộ, không dùng Apify và không cần cookie. Lấy được video, ảnh bìa và caption.",
                    "Runs completely through self-hosted RSSHub without Apify or cookies. Fetches videos, thumbnails, and captions."
                  )}
                </p>
              </div>

              <div className="p-3 rounded-xl border bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {L(
                  "Sẵn sàng dùng ngay qua RSSHub nội bộ (`http://rsshub:1200/tiktok/user/@handle`).",
                  "Ready to use via local RSSHub (`http://rsshub:1200/tiktok/user/@handle`)."
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void subscribe({
                    platform: "tiktok",
                    feedUrl: ttHandle,
                    title: ttTitle || undefined,
                    ...getFolderPayload("TikTok"),
                  });
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={ttHandle}
                  onChange={(e) => setTtHandle(e.target.value)}
                  placeholder={L("Nhập @handle hoặc link TikTok (vd: @tiktok hoặc https://www.tiktok.com/@tenkenh)", "Enter @handle or TikTok URL (e.g. @tiktok)")}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
                <input
                  type="text"
                  value={ttTitle}
                  onChange={(e) => setTtTitle(e.target.value)}
                  placeholder={L("Tên hiển thị tuỳ chọn (để trống sẽ tự lấy @handle)", "Optional display name (defaults to @handle)")}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold"
                >
                  {L("+ Theo dõi kênh TikTok", "+ Follow TikTok")}
                </button>
              </form>
            </div>
          )}

          {/* 4. LINKEDIN (MIỄN PHÍ TỰ HOST, KHÔNG CẦN APIFY) */}
          {section === "linkedin" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{L("Theo dõi LinkedIn (Miễn phí $0)", "Follow LinkedIn (Free $0)")}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {L(
                    "Đọc trực tiếp bài đăng công khai trên trang cá nhân (`/in/...`) hoặc trang công ty (`/company/...`) hoàn toàn miễn phí — không dùng Apify, không cần đăng nhập cookie.",
                    "Fetch public posts from profiles (`/in/...`) or company pages (`/company/...`) for free — no Apify, no cookies required."
                  )}
                </p>
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setLiMode("profile")}
                  className={`px-3 py-1.5 rounded-lg ${
                    liMode === "profile"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  {L("Trang cá nhân / Công ty", "Profile / Company")}
                </button>
                <button
                  type="button"
                  onClick={() => setLiMode("jobs")}
                  className={`px-3 py-1.5 rounded-lg ${
                    liMode === "jobs"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  {L("Tìm việc (LinkedIn Jobs)", "Jobs (LinkedIn Jobs)")}
                </button>
                <button
                  type="button"
                  onClick={() => setLiMode("google")}
                  className={`px-3 py-1.5 rounded-lg ${
                    liMode === "google"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  {L("Theo dõi qua Google News", "Via Google News")}
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (liMode === "profile") {
                    void subscribe({
                      platform: "linkedin",
                      feedUrl: liInput,
                      title: liTitle || undefined,
                      ...getFolderPayload("LinkedIn"),
                    });
                  } else if (liMode === "jobs") {
                    void subscribe({
                      platform: "linkedin_jobs",
                      feedUrl: liInput,
                      title: liTitle || undefined,
                      ...getFolderPayload("LinkedIn"),
                    });
                  } else {
                    const q = encodeURIComponent(`site:linkedin.com/posts ${liInput.trim()}`);
                    void subscribe({
                      platform: "google_news",
                      feedUrl: `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
                      title: liTitle || `LinkedIn: ${liInput.trim()}`,
                      ...getFolderPayload("LinkedIn"),
                    });
                  }
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={liInput}
                  onChange={(e) => setLiInput(e.target.value)}
                  placeholder={
                    liMode === "profile"
                      ? "Dán URL LinkedIn (vd: https://www.linkedin.com/in/justinwelsh hoặc /company/openai)"
                      : liMode === "jobs"
                        ? "Nhập từ khoá việc làm (vd: AI Engineer, Product Manager)"
                        : 'Nhập tên tác giả hoặc từ khoá (vd: "Justin Welsh")'
                  }
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <input
                  type="text"
                  value={liTitle}
                  onChange={(e) => setLiTitle(e.target.value)}
                  placeholder="Tên hiển thị tuỳ chọn"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <p className="text-xs text-slate-500">
                  Mẹo: Nếu tài khoản LinkedIn nào bật ẩn bài với khách (không xem được khi chưa đăng nhập), bạn chuyển sang tab &ldquo;Theo dõi qua Google News&rdquo; ở trên để lấy bài vẫn miễn phí $0.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  {L("+ Theo dõi LinkedIn", "+ Follow LinkedIn")}
                </button>
              </form>
            </div>
          )}

          {/* 5. X (TWITTER) */}
          {section === "x" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">Theo dõi tài khoản X (Twitter)</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Đọc bài đăng từ X qua RSSHub nội bộ (dùng `TWITTER_AUTH_TOKEN` trong `.env`) hoặc dịch vụ dự phòng `fxtwitter.com`.
                </p>
              </div>

              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  readiness.twitter_token_set
                    ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200"
                    : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200"
                }`}
              >
                {readiness.twitter_token_set ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Đã phát hiện `TWITTER_AUTH_TOKEN` trong `.env`.
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Chưa có `TWITTER_AUTH_TOKEN` trong `.env`. Bạn vẫn có thể chọn nguồn dự phòng `fxtwitter.com` bên dưới.
                  </>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void subscribe({
                    platform: "x",
                    feedUrl: xHandle,
                    title: xTitle || undefined,
                    useFxTwitter: xUseFx,
                    ...getFolderPayload("X"),
                  });
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value)}
                  placeholder="Nhập @handle hoặc link x.com/... (vd: elonmusk)"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <input
                  type="text"
                  value={xTitle}
                  onChange={(e) => setXTitle(e.target.value)}
                  placeholder="Tên hiển thị tuỳ chọn (để trống sẽ dùng @handle)"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={xUseFx}
                    onChange={(e) => setXUseFx(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Dùng `fxtwitter.com` thay vì RSSHub nội bộ
                </label>
                <div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold"
                  >
                    + Theo dõi tài khoản X
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 4. FACEBOOK PAGE */}
          {section === "facebook" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">
                  {L("Theo dõi Trang Facebook (Miễn phí $0)", "Follow Facebook Page (Free $0)")}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {L(
                    "Mặc định lấy trực tiếp bài viết công khai qua RSSHub nội bộ (không cần Apify, có ảnh/video đầy đủ) và tự động dự phòng qua Google News nếu Page bị khoá khách.",
                    "Fetches public posts directly via self-hosted RSSHub (no Apify needed, includes full images/videos) with automatic Google News fallback for login-gated pages."
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setFbMode("free");
                      setFbKind("page");
                    }}
                    className={`px-3 py-1.5 rounded-lg ${
                      fbMode === "free" && fbKind === "page"
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                        : ""
                    }`}
                  >
                    {L("Bài viết Page (Free $0)", "Page Posts (Free $0)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFbMode("free");
                      setFbKind("reels");
                    }}
                    className={`px-3 py-1.5 rounded-lg ${
                      fbMode === "free" && fbKind === "reels"
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                        : ""
                    }`}
                  >
                    {L("Reels (Free $0)", "Reels (Free $0)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFbMode("apify")}
                    className={`px-3 py-1.5 rounded-lg ${
                      fbMode === "apify"
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                        : ""
                    }`}
                  >
                    {L("Apify (Dán link trực tiếp)", "Apify (Direct URL)")}
                  </button>
                </div>
              </div>

              {fbMode === "free" ? (
                <>
                  <div className="p-3 rounded-xl border bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {L(
                      "Sẵn sàng dùng miễn phí $0 qua RSSHub (/facebook/page) + Google News fallback — không cần APIFY_TOKEN.",
                      "Ready to use free ($0) via RSSHub (/facebook/page) + Google News fallback — no APIFY_TOKEN needed."
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void subscribe({
                        platform: "facebook",
                        fbMode: "free",
                        fbKind,
                        pageUrl: fbUrl,
                        pageName: fbName || undefined,
                        title: fbName || undefined,
                        ...getFolderPayload("Facebook"),
                      });
                    }}
                    className="space-y-3"
                  >
                    <input
                      type="text"
                      value={fbUrl}
                      onChange={(e) => setFbUrl(e.target.value)}
                      placeholder={L(
                        "Dán link Page Facebook hoặc username (vd: https://www.facebook.com/openai hoặc tintucvtv24)",
                        "Paste Facebook Page URL or username (e.g. https://www.facebook.com/openai)"
                      )}
                      required
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={fbName}
                      onChange={(e) => setFbName(e.target.value)}
                      placeholder={L("Tên hiển thị tuỳ chọn (vd: VTV24, OpenAI)", "Optional display name (e.g. OpenAI)")}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                    <p className="text-xs text-slate-500">
                      {L(
                        "Mẹo: Các Page công khai lấy trực tiếp bài mới nhất không cần cookie. Nếu Page nào bị Facebook yêu cầu đăng nhập mới xem được, bạn có thể thêm tuỳ chọn `FACEBOOK_COOKIE` (`c_user=...; xs=...`) vào `.env` (vẫn miễn phí $0).",
                        "Tip: Public pages work with zero cookies. For login-walled pages, you can optionally add `FACEBOOK_COOKIE` (`c_user=...; xs=...`) to `.env` ($0 free)."
                      )}
                    </p>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                    >
                      {L("+ Theo dõi Facebook Page (Miễn phí)", "+ Follow Facebook Page (Free)")}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      readiness.apify_token_set
                        ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200"
                        : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {readiness.apify_token_set ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {L(
                          "Đã có `APIFY_TOKEN` — chỉ cần dán link trang Facebook bên dưới, KHÔNG cần tạo Task ID hay nhập URL trên web Apify nữa.",
                          "`APIFY_TOKEN` is set — just paste any Facebook Page URL below; no Task ID or Apify dashboard edits needed."
                        )}
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {L(
                          "Chỉ cần điền duy nhất `APIFY_TOKEN` vào file `.env` (không cần `APIFY_FB_TASK_ID`), hoặc dùng tab Bài viết Page (Free $0) ở trên.",
                          "Only `APIFY_TOKEN` is needed in `.env` (no `APIFY_FB_TASK_ID` required), or use Page Posts (Free $0) above."
                        )}
                      </>
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void subscribe({
                        platform: "facebook",
                        fbMode: "apify",
                        pageUrl: fbUrl,
                        pageName: fbName || undefined,
                        title: fbName || undefined,
                        apifyLimit: fbApifyLimit,
                        apifyDays: 14,
                        ...getFolderPayload("Facebook"),
                      });
                    }}
                    className="space-y-3"
                  >
                    <input
                      type="text"
                      value={fbUrl}
                      onChange={(e) => setFbUrl(e.target.value)}
                      placeholder={L(
                        "Dán link trang Facebook cần Apify cào (vd: https://www.facebook.com/nguyenhuutri)",
                        "Paste Facebook Page URL for Apify (e.g. https://www.facebook.com/openai)"
                      )}
                      required
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={fbName}
                        onChange={(e) => setFbName(e.target.value)}
                        placeholder={L("Tên hiển thị tuỳ chọn (vd: Nguyễn Hữu Trí)", "Optional display name")}
                        className="flex-1 min-w-[200px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                      <select
                        value={fbApifyLimit}
                        onChange={(e) => setFbApifyLimit(Number(e.target.value))}
                        className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      >
                        <option value={10}>{L("Cào 10 bài/lần", "10 posts/run")}</option>
                        <option value={15}>{L("Cào 15 bài/lần (khuyên dùng)", "15 posts/run (recommended)")}</option>
                        <option value={25}>{L("Cào 25 bài/lần", "25 posts/run")}</option>
                        <option value={30}>{L("Cào 30 bài/lần", "30 posts/run")}</option>
                      </select>
                    </div>
                    <p className="text-xs text-slate-500">
                      {L(
                        "Hệ thống tự gọi Apify cho đúng link bạn dán (mặc định dùng `alfalfa/facebook-posts-scraper`, cache 3 giờ để tiết kiệm $5 miễn phí/tháng).",
                        "Automatically runs Apify for the pasted URL (`alfalfa/facebook-posts-scraper`, cached 3 hours to protect your $5/mo free credits)."
                      )}
                    </p>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                    >
                      {L("+ Theo dõi bằng Apify (Tự động)", "+ Follow with Apify (Auto)")}
                    </button>
                  </form>
                </>
              )}
            </div>
          )}

          {/* 5. GOOGLE NEWS / ALERTS */}
          {section === "google_news" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">Google News & Google Alerts</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Tạo luồng tin tự động theo từ khoá từ Google News hoặc dán link RSS từ Google Alerts.
                </p>
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 text-xs">
                <button
                  onClick={() => setGnMode("keyword")}
                  className={`px-3 py-1.5 rounded-lg ${
                    gnMode === "keyword"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  Theo từ khoá Google News
                </button>
                <button
                  onClick={() => setGnMode("alerts")}
                  className={`px-3 py-1.5 rounded-lg ${
                    gnMode === "alerts"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  Dán RSS Google Alerts
                </button>
              </div>

              {gnMode === "keyword" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = encodeURIComponent(gnQuery.trim());
                    const feedUrl =
                      gnLang === "vi"
                        ? `https://news.google.com/rss/search?q=${q}&hl=vi&gl=VN&ceid=VN:vi`
                        : `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
                    void subscribe({
                      platform: "google_news",
                      feedUrl,
                      title: `Google News: ${gnQuery.trim()}`,
                      ...getFolderPayload("Alerts"),
                    });
                  }}
                  className="space-y-3"
                >
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={gnQuery}
                      onChange={(e) => setGnQuery(e.target.value)}
                      placeholder='Nhập từ khoá (vd: "AI Agent", Bitcoin ETF, Chứng khoán)'
                      required
                      className="flex-1 min-w-[220px] px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                    <select
                      value={gnLang}
                      onChange={(e) => setGnLang(e.target.value as "vi" | "en")}
                      className="px-3 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="vi">Tiếng Việt (VN)</option>
                      <option value="en">English (US)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    + Tạo feed từ khoá này
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void subscribe({
                      platform: "google_news",
                      feedUrl: alertsUrl,
                      title: alertsTitle || undefined,
                      ...getFolderPayload("Alerts"),
                    });
                  }}
                  className="space-y-3"
                >
                  <input
                    type="url"
                    value={alertsUrl}
                    onChange={(e) => setAlertsUrl(e.target.value)}
                    placeholder="Dán URL RSS lấy từ google.com/alerts"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                  <input
                    type="text"
                    value={alertsTitle}
                    onChange={(e) => setAlertsTitle(e.target.value)}
                    placeholder="Tên hiển thị (tuỳ chọn)"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    + Theo dõi Google Alerts
                  </button>
                </form>
              )}
            </div>
          )}

          {/* 6. TELEGRAM / BLUESKY / RSSHUB */}
          {section === "social_other" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">Telegram, Bluesky & Route RSSHub</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Theo dõi kênh Telegram công khai, tài khoản Bluesky hoặc bất kỳ route nào do RSSHub nội bộ hỗ trợ.
                </p>
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 text-xs">
                <button
                  onClick={() => setOtherKind("telegram")}
                  className={`px-3 py-1.5 rounded-lg ${
                    otherKind === "telegram"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  Telegram Channel
                </button>
                <button
                  onClick={() => setOtherKind("bluesky")}
                  className={`px-3 py-1.5 rounded-lg ${
                    otherKind === "bluesky"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  Bluesky
                </button>
                <button
                  onClick={() => setOtherKind("rsshub")}
                  className={`px-3 py-1.5 rounded-lg ${
                    otherKind === "rsshub"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                      : ""
                  }`}
                >
                  Route RSSHub tuỳ chỉnh
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void subscribe({
                    platform: otherKind,
                    feedUrl: otherInput,
                    title: otherTitle || undefined,
                    ...getFolderPayload("Social"),
                  });
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={otherInput}
                  onChange={(e) => setOtherInput(e.target.value)}
                  placeholder={
                    otherKind === "telegram"
                      ? "Tên kênh hoặc link t.me/... (vd: durov)"
                      : otherKind === "bluesky"
                        ? "Handle Bluesky (vd: bsky.app)"
                        : "Route RSSHub (vd: /github/trending/daily/typescript)"
                  }
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <input
                  type="text"
                  value={otherTitle}
                  onChange={(e) => setOtherTitle(e.target.value)}
                  placeholder="Tên hiển thị (tuỳ chọn)"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
                >
                  + Thêm nguồn
                </button>
              </form>
            </div>
          )}

          {/* 7. IMPORT / EXPORT KÊNH ĐÃ FOLLOW */}
          {section === "import" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">
                  {L("Export & Import danh sách kênh", "Export & Import Followed Channels")}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {L(
                    "Xuất toàn bộ các kênh đang theo dõi (kèm thư mục, tên hiển thị, chế độ toàn văn, bộ lọc) ra file để chuyển sang máy khác nhanh chóng.",
                    "Export all followed channels (folders, custom titles, crawler, filter rules) to move to another machine effortlessly."
                  )}
                </p>
              </div>

              {/* Khối Export & Import JSON chuyển máy */}
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <FileJson className="w-4 h-4 text-blue-600" />
                      {L("Sao lưu & Chuyển máy (JSON / OPML)", "Backup & Migrate (JSON / OPML)")}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {L(
                        `Hiện tài khoản đang theo dõi ${feeds.length} kênh trong ${categories.length} thư mục. File export không chứa mật khẩu hay API token.`,
                        `Currently following ${feeds.length} channels across ${categories.length} folders. Exported files contain no passwords or API tokens.`
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href="/api/sources/export?format=json"
                      download
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {L("Export JSON (Đầy đủ)", "Export JSON (Full)")}
                    </a>
                    <a
                      href="/api/sources/export?format=opml"
                      download
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export OPML
                    </a>
                  </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                  <label className="rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-900/70 hover:border-blue-500 p-5 flex flex-col items-center justify-center text-center gap-2 cursor-pointer bg-blue-50/40 dark:bg-blue-950/20 transition-colors">
                    <Upload className="w-7 h-7 text-blue-600" />
                    <div className="font-semibold text-sm">
                      {channelsUploading
                        ? L("Đang import danh sách kênh...", "Importing channels...")
                        : L("Chọn file JSON đã export (.json) để Import vào máy này", "Choose exported JSON file (.json) to Import")}
                    </div>
                    <p className="text-xs text-slate-500">
                      {L(
                        "Tự động tạo thư mục còn thiếu, giữ nguyên tên nguồn, toàn văn & bộ lọc",
                        "Auto-creates missing folders, restores titles, crawler & filter rules"
                      )}
                    </p>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      disabled={channelsUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadChannelsJson(f);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overwriteExistingChannels}
                      onChange={(e) => setOverwriteExistingChannels(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    {L(
                      "Nếu kênh đã tồn tại trên máy mới, cập nhật lại thư mục / tên / cài đặt theo file import",
                      "If a channel already exists, overwrite its folder / title / settings from the import file"
                    )}
                  </label>
                </div>

                {channelsSummary && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/70 text-xs font-semibold flex flex-wrap gap-3">
                      <span>Tổng: {channelsSummary.total}</span>
                      <span className="text-green-700 dark:text-green-400">
                        Thêm mới: {channelsSummary.added}
                      </span>
                      {channelsSummary.updated > 0 && (
                        <span className="text-blue-700 dark:text-blue-400">
                          Cập nhật: {channelsSummary.updated}
                        </span>
                      )}
                      <span className="text-slate-500">Đã có: {channelsSummary.exists}</span>
                      {channelsSummary.error > 0 && (
                        <span className="text-red-600">Lỗi: {channelsSummary.error}</span>
                      )}
                    </div>
                    {channelsResults.length > 0 && (
                      <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
                        {channelsResults.map((r) => (
                          <div
                            key={`${r.index}-${r.feed_url}`}
                            className="px-4 py-2 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                [{r.category}] {r.title}
                              </div>
                              <div className="text-slate-500 truncate">
                                {r.status === "error" ? r.message : r.feed_url}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded font-medium shrink-0 ${
                                r.status === "added"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                  : r.status === "updated"
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                    : r.status === "exists"
                                      ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              }`}
                            >
                              {r.status === "added"
                                ? "Đã thêm"
                                : r.status === "updated"
                                  ? "Đã cập nhật"
                                  : r.status === "exists"
                                    ? "Đã có"
                                    : "Lỗi"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-base font-bold">Import từ Inoreader (OPML) & CSV</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tải trực tiếp file `inoreader.opml` hoặc `social.csv` lên từ máy tính.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* OPML Box */}
                <label className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-green-500 p-6 flex flex-col items-center justify-center text-center gap-2.5 cursor-pointer bg-slate-50/60 dark:bg-slate-900/50 transition-colors">
                  <Upload className="w-8 h-8 text-green-600" />
                  <div className="font-semibold text-sm">
                    {opmlUploading ? "Đang import OPML..." : "Chọn file OPML (Inoreader)"}
                  </div>
                  <p className="text-xs text-slate-500">
                    Giữ nguyên toàn bộ cấu trúc thư mục từ Inoreader (.opml / .xml)
                  </p>
                  <input
                    type="file"
                    accept=".opml,.xml"
                    className="hidden"
                    disabled={opmlUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadOpml(f);
                      e.target.value = "";
                    }}
                  />
                </label>

                {/* CSV Box */}
                <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-6 flex flex-col items-center justify-center text-center gap-2.5 bg-slate-50/60 dark:bg-slate-900/50">
                  <FileSpreadsheet className="w-8 h-8 text-amber-600" />
                  <label className="cursor-pointer space-y-1">
                    <div className="font-semibold text-sm hover:underline">
                      {csvUploading ? "Đang xử lý CSV..." : "Chọn file social.csv"}
                    </div>
                    <p className="text-xs text-slate-500">
                      Cột: platform, url_or_handle, folder, name, priority
                    </p>
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      disabled={csvUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadCsv(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 pt-1">
                    <input
                      type="checkbox"
                      checked={csvNoShorts}
                      onChange={(e) => setCsvNoShorts(e.target.checked)}
                    />
                    YouTube: bỏ video Shorts
                  </label>
                </div>
              </div>

              {csvResults.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-900 text-xs font-semibold">
                    Kết quả import CSV ({csvResults.length} dòng)
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-72 overflow-y-auto text-xs">
                    {csvResults.map((r) => (
                      <div
                        key={`${r.row}-${r.name}`}
                        className="px-4 py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">
                            Dòng {r.row} [{r.platform}] {r.name}
                          </span>
                          <div className="text-slate-500 truncate">{r.message}</div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded font-medium shrink-0 ${
                            r.status === "added"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : r.status === "exists"
                                ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          }`}
                        >
                          {r.status === "added"
                            ? "Đã thêm"
                            : r.status === "exists"
                              ? "Đã có"
                              : r.status === "skipped"
                                ? "Bỏ qua"
                                : "Lỗi"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 8. QUẢN LÝ NGUỒN ĐANG THEO DÕI */}
          {section === "manage" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">
                  {L(`Nguồn đang theo dõi (${feeds.length})`, `Following (${feeds.length})`)}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="/api/sources/export?format=json"
                    download
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export JSON
                  </a>
                  <a
                    href="/api/sources/export?format=opml"
                    download
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export OPML
                  </a>
                  <input
                    type="text"
                    value={manageQuery}
                    onChange={(e) => setManageQuery(e.target.value)}
                    placeholder={L("Lọc theo tên, URL hoặc thư mục...", "Filter by name, URL or folder...")}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm w-64"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {filteredManageFeeds.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Chưa có nguồn nào khớp bộ lọc.
                  </div>
                ) : (
                  filteredManageFeeds.map((f) => (
                    <div
                      key={f.id}
                      className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{f.title}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-500">
                            {f.category?.title}
                          </span>
                          {f.parsing_error_count > 0 && (
                            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[11px]">
                              {f.parsing_error_count} lỗi
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {f.feed_url}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void handleToggleCrawler(f)}
                          title="Bật/tắt tự lấy toàn văn bài viết"
                          className={`px-2.5 py-1 rounded-lg border text-xs ${
                            f.crawler
                              ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-medium"
                              : "border-slate-200 dark:border-slate-700 text-slate-500"
                          }`}
                        >
                          {f.crawler ? "Toàn văn: BẬT" : "Toàn văn: TẮT"}
                        </button>
                        <button
                          onClick={() => void handleDeleteFeed(f)}
                          title="Huỷ theo dõi nguồn này"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
