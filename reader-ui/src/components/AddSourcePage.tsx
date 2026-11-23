"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Bookmark,
  Check,
  CheckCircle2,
  Cpu,
  Facebook,
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
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Twitter,
  Upload,
  Youtube,
} from "lucide-react";

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
}

type SourceSection =
  | "website"
  | "youtube"
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
  const [activeTopic, setActiveTopic] = useState<TopicPreset | null>(TOPIC_PRESETS[0]);

  // YouTube
  const [ytInput, setYtInput] = useState("");
  const [ytNoShorts, setYtNoShorts] = useState(true);
  const [ytPreview, setYtPreview] = useState<DiscoveredFeed | null>(null);

  // X (Twitter)
  const [xHandle, setXHandle] = useState("");
  const [xTitle, setXTitle] = useState("");
  const [xUseFx, setXUseFx] = useState(false);

  // Facebook
  const [fbUrl, setFbUrl] = useState("");
  const [fbName, setFbName] = useState("");

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

  // Import OPML / CSV
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

  const handleDiscoverWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteInput.trim()) return;
    setDiscovering(true);
    setFeedback(null);
    setDiscovered([]);
    try {
      const res = await fetch("/api/sources/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "website", input: websiteInput }),
      });
      const data = (await res.json()) as {
        feeds?: DiscoveredFeed[];
        error?: string;
      };
      if (!res.ok) {
        setFeedback({ type: "err", text: data.error || "Không tìm thấy RSS." });
      } else if (!data.feeds || data.feeds.length === 0) {
        setFeedback({
          type: "err",
          text: "Trang này không công khai RSS mặc định. Bạn thử tìm route trên RSSHub ở mục Telegram / RSSHub.",
        });
      } else {
        setDiscovered(data.feeds);
      }
    } catch {
      setFeedback({ type: "err", text: "Không dò được RSS từ trang web." });
    } finally {
      setDiscovering(false);
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
    { id: "youtube", label: "Kênh YouTube", icon: <Youtube className="w-4 h-4 text-red-500" /> },
    { id: "x", label: "Tài khoản X", icon: <Twitter className="w-4 h-4 text-sky-500" /> },
    { id: "facebook", label: "Trang Facebook", icon: <Facebook className="w-4 h-4 text-blue-600" /> },
    { id: "google_news", label: "Google News / Alerts", icon: <Search className="w-4 h-4 text-emerald-600" /> },
    { id: "social_other", label: "Telegram / RSSHub", icon: <Send className="w-4 h-4 text-indigo-500" /> },
    { id: "import", label: "Import OPML / CSV", icon: <Upload className="w-4 h-4 text-amber-600" /> },
    { id: "manage", label: `Đang theo dõi (${feeds.length})`, icon: <ListChecks className="w-4 h-4 text-slate-500" /> },
  ];

  const folderPicker = (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <FolderPlus className="w-4 h-4 text-green-600" />
        Lưu vào thư mục:
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
        <option value="new">+ Tạo thư mục mới...</option>
      </select>
      {selectedCategoryId === "new" && (
        <input
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder="Tên thư mục mới (vd: Finance, Crypto)"
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
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Thanh icon ngoài cùng bên trái (giống Inoreader) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-12 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 py-2">
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/"
            title="Newsfeed"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Home className="w-4 h-4" />
          </Link>
          <Link
            href="/"
            title="Đã lưu"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Bookmark className="w-4 h-4" />
          </Link>
          <Link
            href="/add"
            title="Thêm nguồn mới"
            className="p-2 rounded-lg bg-green-600 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Link
            href="/status"
            title="Trạng thái hệ thống"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Activity className="w-4 h-4" />
          </Link>
          <button
            onClick={toggleTheme}
            title="Chế độ sáng / tối"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Cột danh mục Thêm mới (giống cột "Add new" của Inoreader) */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="h-12 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <span className="font-bold text-sm">Thêm mới</span>
          <Link
            href="/"
            className="text-xs text-green-600 hover:underline font-medium"
          >
            Về đọc tin
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
            <h1 className="font-bold text-base">Thêm nguồn mới</h1>
            <Link
              href="/"
              className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium"
            >
              Về đọc tin
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
                <h2 className="text-xl font-bold">Theo dõi Website hoặc RSS</h2>
                <form onSubmit={handleDiscoverWebsite} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      placeholder="Nhập địa chỉ trang web (vd: vnexpress.net, tinhte.vn) hoặc dán URL RSS..."
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={discovering}
                    className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 shrink-0"
                  >
                    {discovering && <Loader2 className="w-4 h-4 animate-spin" />}
                    Tìm feed
                  </button>
                </form>

                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={websiteCrawler}
                    onChange={(e) => setWebsiteCrawler(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Tự lấy toàn văn bài viết (bật cho blog chỉ đăng đoạn tóm tắt trong RSS)
                </label>

                {/* Kết quả dò RSS */}
                {discovered.length > 0 && (
                  <div className="space-y-2.5 pt-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Tìm thấy {discovered.length} nguồn RSS
                    </div>
                    {discovered.map((feed) => {
                      const already = existingFeedUrls.has(feed.url);
                      return (
                        <div
                          key={feed.url}
                          className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              {feed.title || feed.url}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {feed.url}
                            </div>
                          </div>
                          {already ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 shrink-0">
                              <Check className="w-3.5 h-3.5 text-green-600" />
                              Đã theo dõi
                            </span>
                          ) : (
                            <button
                              disabled={submitting}
                              onClick={() =>
                                void subscribe({
                                  platform: "rss",
                                  feedUrl: feed.url,
                                  title: feed.title,
                                  crawler: websiteCrawler,
                                  ...getFolderPayload(),
                                })
                              }
                              className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shrink-0"
                            >
                              + Theo dõi
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Khám phá theo chủ đề (giống Explore topics của Inoreader) */}
              <div className="space-y-4">
                <h3 className="text-base font-bold">Khám phá nhanh theo chủ đề</h3>
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
                              Đã theo dõi
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
                              + Theo dõi
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
                <h2 className="text-xl font-bold">Theo dõi kênh YouTube</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Dán link kênh (`https://www.youtube.com/@...`) hoặc chỉ gõ `@handle`, hệ thống tự lấy RSS chính chủ (miễn phí, không cần API key).
                </p>
              </div>

              <form onSubmit={handleDiscoverYouTube} className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ytInput}
                    onChange={(e) => setYtInput(e.target.value)}
                    placeholder="Ví dụ: https://www.youtube.com/@mkbhd hoặc @Tinhte"
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    type="submit"
                    disabled={discovering}
                    className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    {discovering && <Loader2 className="w-4 h-4 animate-spin" />}
                    Tìm kênh
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ytNoShorts}
                    onChange={(e) => setYtNoShorts(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Bỏ video Shorts (chỉ lấy video dài qua playlist UULF)
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
                    + Theo dõi kênh
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. X (TWITTER) */}
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
                <h2 className="text-xl font-bold">Theo dõi Trang Facebook</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Kết nối qua `apify-bridge` nội bộ: chỉ dùng 1 Task Apify chung và tách feed riêng cho từng Page bằng bộ lọc tên Page.
                </p>
              </div>

              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  readiness.apify_token_set && readiness.apify_task_set
                    ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200"
                    : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200"
                }`}
              >
                {readiness.apify_token_set && readiness.apify_task_set ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Đã cấu hình đủ `APIFY_TOKEN` và `APIFY_FB_TASK_ID` trong `.env`.
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Chưa điền đủ `APIFY_TOKEN` và `APIFY_FB_TASK_ID` trong `.env`. Hãy tạo Task trên Apify cho `alfalfa/facebook-posts-scraper` rồi điền vào `.env`.
                  </>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void subscribe({
                    platform: "facebook",
                    pageName: fbName,
                    pageUrl: fbUrl,
                    title: fbName || undefined,
                    ...getFolderPayload("Facebook"),
                  });
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={fbName}
                  onChange={(e) => setFbName(e.target.value)}
                  placeholder="Tên Page chính xác (vd: Nguyễn Hữu Trí, 5 Phút Crypto)"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={fbUrl}
                  onChange={(e) => setFbUrl(e.target.value)}
                  placeholder="URL Page Facebook (vd: https://www.facebook.com/nguyenhuutri)"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <p className="text-xs text-slate-500">
                  Lưu ý: Nhớ thêm URL Page này vào mục `startUrls` trong Task trên Apify để scraper thu thập bài viết về cho bridge.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                >
                  + Theo dõi Facebook Page
                </button>
              </form>
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

          {/* 7. IMPORT HÀNG LOẠT (OPML / CSV) */}
          {section === "import" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Import hàng loạt từ Inoreader & CSV</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Tải trực tiếp file `inoreader.opml` hoặc `social.csv` lên từ máy tính, không cần chạy lệnh thủ công.
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
                  Nguồn đang theo dõi ({feeds.length})
                </h2>
                <input
                  type="text"
                  value={manageQuery}
                  onChange={(e) => setManageQuery(e.target.value)}
                  placeholder="Lọc theo tên, URL hoặc thư mục..."
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm w-64"
                />
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
