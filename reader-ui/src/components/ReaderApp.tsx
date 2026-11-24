"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  Activity,
  Bookmark,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileText,
  Filter,
  Folder,
  FolderPlus,
  Heart,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat2,
  Rss,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getTagStyle, type TagColorKey } from "@/lib/tag-colors";
import { FeedPropertiesModal, type EditableFeed } from "./FeedModals";

interface CategoryItem {
  id: number;
  title: string;
  feed_count?: number;
  total_unread?: number;
}

interface FeedItem {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  unread_count: number;
  category: { id: number; title: string };
}

interface TagSidebarItem {
  name: string;
  color: TagColorKey;
  total_count: number;
  unread_count: number;
}

interface SocialMetrics {
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  updated_at: string;
}

function formatCompactMetric(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return val.toLocaleString("en-US");
}

function isTrackableSocialEntryUrl(url: string): boolean {
  const u = (url || "").toLowerCase();
  if (!u || u.includes("facebook.com") || u.includes("fb.watch")) return false;
  if (u.includes("tiktok.com") || u.includes("youtube.com") || u.includes("youtu.be/")) {
    return true;
  }
  if (/https?:\/\/(www\.|mobile\.)?(x|twitter|fxtwitter)\.com\/[^/]+\/status\/\d+/i.test(u)) {
    return true;
  }
  if (
    u.includes("linkedin.com/") &&
    (u.includes("/posts/") || u.includes("/pulse/") || u.includes("/feed/update/"))
  ) {
    return true;
  }
  return false;
}

interface EntryListItem {
  id: number;
  feed_id: number;
  status: "unread" | "read" | "removed";
  title: string;
  url: string;
  published_at: string;
  author: string;
  starred: boolean;
  reading_time: number;
  tags?: string[];
  social_metrics?: SocialMetrics | null;
  feed: {
    id: number;
    title: string;
    site_url: string;
    category: { id: number; title: string } | null;
  };
  thumbnail: string | null;
  excerpt: string;
}

interface EntryDetail extends EntryListItem {
  content: string;
  sanitized_html: string;
  plain_text: string;
  markdown: string;
  images: string[];
  videos?: Array<{ url: string; mime_type: string; poster?: string }>;
  youtube_embed_id?: string | null;
  tiktok_embed_id?: string | null;
}

type ViewScope =
  | { type: "all" }
  | { type: "starred" }
  | { type: "category"; id: number; title: string; starredOnly?: boolean }
  | { type: "feed"; id: number; title: string; starredOnly?: boolean }
  | { type: "tag"; tag: string };

function formatBadge(n: number): string {
  if (n > 999) return "1000+";
  return String(Math.max(0, n));
}

function formatRelTime(iso: string, justNowLabel: string, dateLocale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return justNowLabel;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Date(ts).toLocaleDateString(dateLocale);
}

function FeedIcon({ feedId }: { feedId: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Rss className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  }
  return (
    <img
      src={`/api/feeds/${feedId}/icon`}
      alt=""
      className="w-4 h-4 rounded-sm object-contain shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export default function ReaderApp({
  passwordEnabled,
}: {
  passwordEnabled: boolean;
}) {
  const { locale, t } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "vi-VN";

  // Sidebar & theme
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Dữ liệu sidebar
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [feeds, setFeeds] = useState<FeedItem[]>([]);
  const [tagsList, setTagsList] = useState<TagSidebarItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [starredTotal, setStarredTotal] = useState(0);
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [tagsExpanded, setTagsExpanded] = useState(true);

  // Tagging UI state
  const [cardTagPopover, setCardTagPopover] = useState<{
    entryId: number;
    input: string;
  } | null>(null);
  const [detailTagInput, setDetailTagInput] = useState("");
  const [videoFallbackEmbed, setVideoFallbackEmbed] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const detailTagInputRef = useRef<HTMLInputElement | null>(null);

  // Bộ lọc danh sách bài
  const [scope, setScope] = useState<ViewScope>({ type: "all" });
  const [statusFilter, setStatusFilter] = useState<"unread" | "all">("unread");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [afterDate, setAfterDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [markOnScroll, setMarkOnScroll] = useState(false);

  // Danh sách bài viết
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [archiveExhausted, setArchiveExhausted] = useState(false);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [markMenuOpen, setMarkMenuOpen] = useState(false);

  // Bài đang chọn & màn hình đọc bài
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [activeEntry, setActiveEntry] = useState<EntryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [fetchingFull, setFetchingFull] = useState(false);
  const [refreshingMetrics, setRefreshingMetrics] = useState(false);

  // Chọn nhiều & xuất hàng loạt
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllByFilter, setSelectAllByFilter] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Toast thông báo
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Menu chuột phải feed & modal thuộc tính/lọc (Ảnh 1)
  const [feedMenu, setFeedMenu] = useState<{
    feed: FeedItem;
    x: number;
    y: number;
    showFolders?: boolean;
  } | null>(null);
  const [feedModal, setFeedModal] = useState<{
    feed: EditableFeed;
    tab: "properties" | "filter";
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const autoMarkedScrollRef = useRef<Set<number>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // Khởi tạo theme & trang mặc định (Set as start page)
  useEffect(() => {
    const saved = localStorage.getItem("rss-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved ? saved === "dark" : prefersDark;
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);

    try {
      const urlTag = new URLSearchParams(window.location.search).get("tag");
      if (urlTag && urlTag.trim()) {
        setScope({ type: "tag", tag: urlTag.trim() });
        return;
      }
      const startRaw = localStorage.getItem("rss-start-page");
      if (startRaw) {
        const parsed = JSON.parse(startRaw) as ViewScope;
        if (parsed && parsed.type) {
          setScope(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!feedMenu) return;
    const close = () => setFeedMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [feedMenu]);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("rss-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  // Tải sidebar
  const loadSidebar = useCallback(async () => {
    try {
      const res = await fetch("/api/sidebar", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        categories: CategoryItem[];
        feeds: FeedItem[];
        tags?: TagSidebarItem[];
        total_unread: number;
        starred_total: number;
      };
      setCategories(data.categories || []);
      setFeeds(data.feeds || []);
      setTagsList(data.tags || []);
      setTotalUnread(data.total_unread || 0);
      setStarredTotal(data.starred_total || 0);
      setExpandedFolders((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const init: Record<number, boolean> = {};
        for (const c of data.categories || []) init[c.id] = true;
        return init;
      });
    } catch {
      // bỏ qua lỗi tạm thời
    }
  }, []);

  const syncMetricsForIds = useCallback(async (entryIds: number[], force = false) => {
    const clean = Array.from(new Set(entryIds.filter((id) => id > 0))).slice(0, 40);
    if (clean.length === 0) return;
    if (force) setRefreshingMetrics(true);
    try {
      const res = await fetch("/api/entries/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_ids: clean, force }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        metrics?: Record<string, SocialMetrics>;
      };
      const map = data.metrics || {};
      if (Object.keys(map).length === 0) return;
      setEntries((prev) =>
        prev.map((e) => (map[String(e.id)] ? { ...e, social_metrics: map[String(e.id)] } : e))
      );
      setActiveEntry((prev) =>
        prev && map[String(prev.id)] ? { ...prev, social_metrics: map[String(prev.id)] } : prev
      );
    } catch {
      // ignore background metrics failure
    } finally {
      if (force) setRefreshingMetrics(false);
    }
  }, []);

  const buildFilterQuery = useCallback(
    (offset: number, limit = 20) => {
      const p = new URLSearchParams();
      const isStarredView =
        scope.type === "starred" ||
        ((scope.type === "feed" || scope.type === "category") && scope.starredOnly);
      if (!isStarredView && statusFilter === "unread") {
        p.set("status", "unread");
      }
      if (scope.type === "category") p.set("category_id", String(scope.id));
      if (scope.type === "feed") p.set("feed_id", String(scope.id));
      if (scope.type === "tag") p.set("tag", scope.tag);
      if (isStarredView) p.set("starred", "true");
      if (appliedSearch.trim()) p.set("search", appliedSearch.trim());
      if (afterDate) {
        const ts = Math.floor(new Date(`${afterDate}T00:00:00`).getTime() / 1000);
        if (Number.isFinite(ts)) p.set("after", String(ts));
      }
      if (beforeDate) {
        const ts = Math.floor(new Date(`${beforeDate}T23:59:59`).getTime() / 1000);
        if (Number.isFinite(ts)) p.set("before", String(ts));
      }
      p.set("limit", String(limit));
      p.set("offset", String(offset));
      return p;
    },
    [scope, statusFilter, appliedSearch, afterDate, beforeDate]
  );

  const loadEntries = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoadingList(true);
        autoMarkedScrollRef.current.clear();
      } else {
        setLoadingMore(true);
      }

      const offset = reset ? 0 : entries.length;
      try {
        const params = buildFilterQuery(offset, 20);
        const res = await fetch(`/api/entries?${params.toString()}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error("Lỗi tải bài");
        const data = (await res.json()) as {
          total: number;
          entries: EntryListItem[];
        };
        const loadedList = data.entries || [];
        setTotalEntries(data.total || 0);
        if (reset) {
          setEntries(loadedList);
          setFocusedIndex(loadedList.length ? 0 : -1);
        } else {
          setEntries((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const appended = loadedList.filter((x) => !seen.has(x.id));
            return [...prev, ...appended];
          });
        }
        const needSyncIds = loadedList
          .filter((x) => isTrackableSocialEntryUrl(x.url))
          .map((x) => x.id);
        if (needSyncIds.length > 0) {
          void syncMetricsForIds(needSyncIds, false);
        }
      } catch {
        showToast(t("toastLoadEntriesErr"));
      } finally {
        setLoadingList(false);
        setLoadingMore(false);
      }
    },
    [buildFilterQuery, entries.length, showToast, syncMetricsForIds, t]
  );

  useEffect(() => {
    void loadSidebar();
  }, [loadSidebar]);

  useEffect(() => {
    if (!cardTagPopover) return;
    const close = () => setCardTagPopover(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [cardTagPopover]);

  useEffect(() => {
    setArchiveExhausted(false);
    void loadEntries(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusFilter, appliedSearch, afterDate, beforeDate]);

  const activeFeedSupportsArchive = useMemo(() => {
    if (scope.type !== "feed") return false;
    const active = feeds.find((f) => f.id === scope.id);
    if (!active) return false;
    const u = (active.feed_url || "").toLowerCase();
    return (
      (u.includes("youtube.com") && u.includes("feeds/videos.xml")) ||
      u.includes("/telegram/channel/") ||
      u.includes("/tiktok/user/") ||
      u.includes("/facebook.xml") ||
      u.includes("/facebook/")
    );
  }, [scope, feeds]);

  const handleLoadMore = async () => {
    if (loadingMore || loadingList) return;
    if (entries.length < totalEntries) {
      await loadEntries(false);
      return;
    }
    if (scope.type === "feed" && activeFeedSupportsArchive && !archiveExhausted) {
      setLoadingMore(true);
      try {
        const res = await fetch(`/api/feeds/${scope.id}/load-more`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 20 }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          added?: number;
          hasMore?: boolean;
          error?: string;
        };
        if (!res.ok) {
          showToast(data.error || t("toastErrLoadMore"));
          return;
        }
        const added = data.added || 0;
        if (added > 0) {
          await Promise.all([loadEntries(false), loadSidebar()]);
          showToast(t("toastAddedOlder", { count: added }));
        } else {
          setArchiveExhausted(true);
          showToast(t("toastNoMoreOlder"));
        }
        if (data.hasMore === false) {
          setArchiveExhausted(true);
        }
      } catch {
        showToast(t("toastErrOlder"));
      } finally {
        setLoadingMore(false);
      }
    }
  };

  const mutateEntryTag = useCallback(
    async (entryId: number, action: { add?: string; remove?: string }) => {
      try {
        const res = await fetch(`/api/entries/${entryId}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        if (!res.ok) throw new Error("err");
        const data = (await res.json()) as { tags?: string[] };
        const nextTags = data.tags || [];
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, tags: nextTags } : e))
        );
        setActiveEntry((prev) =>
          prev && prev.id === entryId ? { ...prev, tags: nextTags } : prev
        );
        void loadSidebar();
      } catch {
        showToast(t("toastTagErr"));
      }
    },
    [loadSidebar, showToast, t]
  );

  const handleBulkAddTag = async (rawTag: string) => {
    const clean = rawTag.trim().replace(/^#+/, "");
    const ids = Array.from(selectedIds);
    if (!clean || ids.length === 0) return;
    try {
      const res = await fetch("/api/entries/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: ids, addTags: [clean] }),
      });
      if (!res.ok) throw new Error("err");
      setEntries((prev) =>
        prev.map((e) => {
          if (!selectedIds.has(e.id)) return e;
          const cur = e.tags || [];
          return cur.includes(clean) ? e : { ...e, tags: [...cur, clean] };
        })
      );
      setBulkTagInput("");
      setBulkTagOpen(false);
      showToast(t("toastBulkTagged", { tag: clean, count: ids.length }));
      void loadSidebar();
    } catch {
      showToast(t("toastTagErr"));
    }
  };

  const handleQuickCreateTag = async () => {
    const raw = prompt(t("createQuickTagPrompt"));
    const clean = (raw || "").trim().replace(/^#+/, "");
    if (!clean) return;
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean }),
      });
      if (!res.ok) throw new Error("err");
      await loadSidebar();
      showToast(t("toastTagUpdated"));
    } catch {
      showToast(t("toastTagErr"));
    }
  };

  const markEntriesStatus = useCallback(
    async (ids: number[], status: "read" | "unread") => {
      if (ids.length === 0) return;
      setEntries((prev) =>
        prev.map((e) => (ids.includes(e.id) ? { ...e, status } : e))
      );
      setActiveEntry((prev) =>
        prev && ids.includes(prev.id) ? { ...prev, status } : prev
      );
      try {
        await fetch("/api/entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_ids: ids, status }),
        });
        void loadSidebar();
      } catch {
        showToast(t("toastErrMarkStatus"));
      }
    },
    [loadSidebar, showToast, t]
  );

  // Đánh dấu đã đọc khi cuộn qua (tuỳ chọn U4)
  useEffect(() => {
    if (!markOnScroll || entries.length === 0) return;
    const obs = new IntersectionObserver(
      (observed) => {
        const toMark: number[] = [];
        for (const item of observed) {
          // Khi thẻ vừa trượt qua phía trên viewport
          if (!item.isIntersecting && item.boundingClientRect.top < 80) {
            const id = Number((item.target as HTMLElement).dataset.entryId);
            const found = entries.find((e) => e.id === id);
            if (
              found &&
              found.status === "unread" &&
              !autoMarkedScrollRef.current.has(id)
            ) {
              autoMarkedScrollRef.current.add(id);
              toMark.push(id);
            }
          }
        }
        if (toMark.length > 0) {
          void markEntriesStatus(toMark, "read");
        }
      },
      { threshold: 0 }
    );

    const nodes = document.querySelectorAll("[data-entry-id]");
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [markOnScroll, entries, markEntriesStatus]);

  const openEntry = useCallback(
    async (item: EntryListItem, index: number) => {
      setFocusedIndex(index);
      setVideoFallbackEmbed(false);
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/entries/${item.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("err");
        const detail = (await res.json()) as EntryDetail;
        setActiveEntry(detail);
        if (isTrackableSocialEntryUrl(detail.url) && !detail.social_metrics) {
          void syncMetricsForIds([detail.id], false);
        }
        if (item.status === "unread") {
          void markEntriesStatus([item.id], "read");
        }
      } catch {
        showToast(t("toastErrOpenArticle"));
      } finally {
        setLoadingDetail(false);
      }
    },
    [markEntriesStatus, showToast, syncMetricsForIds, t]
  );

  const toggleBookmark = useCallback(
    async (id: number) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e))
      );
      setActiveEntry((prev) =>
        prev && prev.id === id ? { ...prev, starred: !prev.starred } : prev
      );
      try {
        await fetch(`/api/entries/${id}/bookmark`, { method: "PUT" });
        void loadSidebar();
      } catch {
        showToast(t("toastErrBookmark"));
      }
    },
    [loadSidebar, showToast, t]
  );

  const handleFetchFullContent = async () => {
    if (!activeEntry || fetchingFull) return;
    setFetchingFull(true);
    try {
      const res = await fetch(`/api/entries/${activeEntry.id}/fetch-content`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("err");
      const updated = (await res.json()) as EntryDetail;
      setActiveEntry(updated);
      showToast(t("toastFetchedFull"));
    } catch {
      showToast(t("toastErrFetchedFull"));
    } finally {
      setFetchingFull(false);
    }
  };

  const handleMarkAllRead = useCallback(
    async (olderThanDays?: number) => {
      setMarkMenuOpen(false);
      const payload: {
        scope: "all" | "category" | "feed" | "tag";
        id?: number;
        tag?: string;
        olderThanDays?: number;
      } = {
        scope:
          scope.type === "category"
            ? "category"
            : scope.type === "feed"
              ? "feed"
              : scope.type === "tag"
                ? "tag"
                : "all",
        id:
          scope.type === "category" || scope.type === "feed"
            ? scope.id
            : undefined,
        tag: scope.type === "tag" ? scope.tag : undefined,
        olderThanDays,
      };
      try {
        const res = await fetch("/api/entries/mark-all-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("err");
        showToast(
          olderThanDays
            ? t("toastMarkedOlderDays", { days: olderThanDays })
            : t("toastMarkedAllRead")
        );
        await Promise.all([loadSidebar(), loadEntries(true)]);
      } catch {
        showToast(t("toastErrMarkAllRead"));
      }
    },
    [scope, loadSidebar, loadEntries, showToast, t]
  );

  const handleRefreshFeeds = async () => {
    setRefreshingFeeds(true);
    try {
      const payload =
        scope.type === "feed"
          ? { feedId: scope.id }
          : scope.type === "category"
            ? { categoryId: scope.id }
            : {};
      await fetch("/api/feeds/refresh", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (scope.type === "feed") {
        await Promise.all([loadSidebar(), loadEntries(true)]);
        showToast(t("toastRefreshedFeed", { title: scope.title }));
      } else {
        showToast(t("toastRefreshedAll"));
        setTimeout(() => {
          void loadSidebar();
          void loadEntries(true);
        }, 1500);
      }
    } catch {
      showToast(t("toastErrRefresh"));
    } finally {
      setRefreshingFeeds(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("toastCopied", { label }));
    } catch {
      showToast(t("toastErrCopy"));
    }
  };

  const copyImageFromSrc = async (src: string) => {
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const imgBitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = imgBitmap.width;
      canvas.height = imgBitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(imgBitmap, 0, 0);
      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!pngBlob) throw new Error("no png");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
      showToast(t("toastCopiedImg"));
    } catch {
      showToast(t("toastErrCopyImg"));
    }
  };

  const toggleSelectId = (id: number) => {
    setSelectAllByFilter(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectMode(true);
    setSelectAllByFilter(true);
    setSelectedIds(new Set(entries.map((e) => e.id)));
    showToast(
      totalEntries > entries.length
        ? t("toastSelectedAllMax")
        : t("toastSelectedAll", { count: entries.length })
    );
  };

  const handleExportZip = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const body = selectAllByFilter
        ? {
            filter: {
              status: scope.type !== "starred" && statusFilter === "unread" ? "unread" : undefined,
              categoryId: scope.type === "category" ? scope.id : undefined,
              feedId: scope.type === "feed" ? scope.id : undefined,
              tag: scope.type === "tag" ? scope.tag : undefined,
              starred: scope.type === "starred" ? true : undefined,
              search: appliedSearch.trim() || undefined,
              after: afterDate
                ? String(Math.floor(new Date(`${afterDate}T00:00:00`).getTime() / 1000))
                : undefined,
              before: beforeDate
                ? String(Math.floor(new Date(`${beforeDate}T23:59:59`).getTime() / 1000))
                : undefined,
            },
          }
        : { entryIds: Array.from(selectedIds) };

      const res = await fetch("/api/export-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("err");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rss-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(t("toastExportedZip"));
    } catch {
      showToast(t("toastErrZip"));
    } finally {
      setExporting(false);
    }
  };

  const handleCopyAllMarkdown = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export-markdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: ids }),
      });
      if (!res.ok) throw new Error("err");
      const data = (await res.json()) as { markdown: string; count: number };
      await navigator.clipboard.writeText(data.markdown);
      showToast(t("toastCopiedAllMd", { count: data.count }));
    } catch {
      showToast(t("toastErrCopyMd"));
    } finally {
      setExporting(false);
    }
  };

  // Phím tắt kiểu Inoreader (U10)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (activeEntry) setActiveEntry(null);
        else if (selectMode) {
          setSelectMode(false);
          setSelectedIds(new Set());
          setSelectAllByFilter(false);
        }
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        void handleMarkAllRead();
        return;
      }

      if (entries.length === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        const nextIdx = Math.min(entries.length - 1, Math.max(0, focusedIndex + 1));
        setFocusedIndex(nextIdx);
        if (activeEntry) void openEntry(entries[nextIdx], nextIdx);
      } else if (e.key === "k") {
        e.preventDefault();
        const prevIdx = Math.max(0, focusedIndex - 1);
        setFocusedIndex(prevIdx);
        if (activeEntry) void openEntry(entries[prevIdx], prevIdx);
      } else if ((e.key === "Enter" || e.key === "o") && focusedIndex >= 0) {
        e.preventDefault();
        const target = entries[focusedIndex];
        if (activeEntry?.id === target.id) setActiveEntry(null);
        else void openEntry(target, focusedIndex);
      } else if (e.key === "m" && focusedIndex >= 0) {
        e.preventDefault();
        const target = activeEntry || entries[focusedIndex];
        if (target) {
          void markEntriesStatus(
            [target.id],
            target.status === "unread" ? "read" : "unread"
          );
        }
      } else if (e.key === "s" && focusedIndex >= 0) {
        e.preventDefault();
        const target = activeEntry || entries[focusedIndex];
        if (target) void toggleBookmark(target.id);
      } else if (e.key === "v" && focusedIndex >= 0) {
        e.preventDefault();
        const target = activeEntry || entries[focusedIndex];
        if (target?.url) window.open(target.url, "_blank", "noopener,noreferrer");
      } else if (e.key === "t" && activeEntry) {
        e.preventDefault();
        detailTagInputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    entries,
    focusedIndex,
    activeEntry,
    selectMode,
    openEntry,
    markEntriesStatus,
    toggleBookmark,
    handleMarkAllRead,
  ]);

  const feedsByCategory = useMemo(() => {
    const map = new Map<number, FeedItem[]>();
    for (const f of feeds) {
      const cid = f.category?.id || 0;
      const arr = map.get(cid) || [];
      arr.push(f);
      map.set(cid, arr);
    }
    return map;
  }, [feeds]);

  const tagColorMap = useMemo(() => {
    const map = new Map<string, TagColorKey>();
    for (const tg of tagsList) {
      map.set(tg.name, tg.color);
    }
    return map;
  }, [tagsList]);

  const currentHeading = useMemo(() => {
    if (scope.type === "all") return t("newsfeed");
    if (scope.type === "starred") return t("saved");
    if (scope.type === "tag") return `# ${scope.tag}`;
    if ((scope.type === "feed" || scope.type === "category") && scope.starredOnly) {
      return `${t("saved")} · ${scope.title}`;
    }
    return scope.title;
  }, [scope, t]);

  const selectScope = (next: ViewScope) => {
    setScope(next);
    setActiveEntry(null);
    setSelectedIds(new Set());
    setSelectAllByFilter(false);
    setMobileMenuOpen(false);
    setFeedMenu(null);
    setCardTagPopover(null);
  };

  const handleCreateFolder = async () => {
    const title = prompt(t("createFolderPrompt"));
    if (!title || !title.trim()) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (res.ok) {
      showToast(t("toastCreatedFolder", { title: title.trim() }));
      await loadSidebar();
    } else {
      showToast(t("toastErrCreateFolder"));
    }
  };

  const handleToggleAllFolders = () => {
    const anyExpanded = categories.some((c) => expandedFolders[c.id] ?? true);
    const next: Record<number, boolean> = {};
    for (const c of categories) next[c.id] = !anyExpanded;
    setExpandedFolders(next);
  };

  const handleRenameFeed = async (feed: FeedItem) => {
    const next = prompt(`${t("renameFeed")}:`, feed.title);
    if (!next || next.trim() === feed.title) return;
    const res = await fetch(`/api/feeds/${feed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next.trim() }),
    });
    if (res.ok) {
      showToast(t("toastRenamedFeed", { title: next.trim() }));
      await loadSidebar();
    } else {
      showToast(t("toastErrRenameFeed"));
    }
  };

  const handleMoveFeedToFolder = async (feed: FeedItem, categoryId: number) => {
    const res = await fetch(`/api/feeds/${feed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId }),
    });
    if (res.ok) {
      showToast(t("toastMovedFeed", { title: feed.title }));
      await loadSidebar();
    } else {
      showToast(t("toastErrMoveFeed"));
    }
  };

  const handleUnfollowFeed = async (feed: FeedItem) => {
    if (!confirm(`${t("unfollow")} "${feed.title}"?`)) return;
    const res = await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (res.ok) {
      showToast(t("toastUnfollowed", { title: feed.title }));
      if (scope.type === "feed" && scope.id === feed.id) {
        selectScope({ type: "all" });
      }
      await Promise.all([loadSidebar(), loadEntries(true)]);
    } else {
      showToast(t("toastErrUnfollow"));
    }
  };

  const handleSetStartPage = (feed: FeedItem) => {
    const nextScope: ViewScope = { type: "feed", id: feed.id, title: feed.title };
    localStorage.setItem("rss-start-page", JSON.stringify(nextScope));
    showToast(t("toastSetStartPage", { title: feed.title }));
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const sidebarContent = (
    <div className="flex flex-col h-full select-none">
      <div className="h-12 px-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <span className="font-bold text-sm tracking-tight flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-green-600 text-white inline-flex items-center justify-center">
            <Rss className="w-3.5 h-3.5" />
          </span>
          Feeds
        </span>
        <div className="flex items-center gap-0.5">
          <Link
            href="/manage"
            title={t("manageContent")}
            className="p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>
          <button
            onClick={() => void handleCreateFolder()}
            title={t("createFolderTitle")}
            className="p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleToggleAllFolders}
            title={t("toggleAllFolders")}
            className="p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <Link
            href="/add"
            title={t("addSource")}
            className="p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-green-600"
          >
            <Plus className="w-4 h-4" />
          </Link>
          <button
            onClick={() => void handleRefreshFeeds()}
            title={t("refreshFeeds")}
            className="p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingFeeds ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-1.5 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 text-sm">
        <button
          onClick={() => selectScope({ type: "all" })}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors ${
            scope.type === "all"
              ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
              : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70"
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Home className="w-4 h-4 shrink-0" />
            {t("newsfeed")}
          </span>
          {totalUnread > 0 && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {formatBadge(totalUnread)}
            </span>
          )}
        </button>

        <button
          onClick={() => selectScope({ type: "starred" })}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors ${
            scope.type === "starred"
              ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
              : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70"
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Bookmark className="w-4 h-4 shrink-0" />
            {t("saved")}
          </span>
          {starredTotal > 0 && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {formatBadge(starredTotal)}
            </span>
          )}
        </button>

        <div className="pt-2 pb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {t("folders")}
        </div>

        {categories.map((cat) => {
          const catFeeds = feedsByCategory.get(cat.id) || [];
          const catUnread = catFeeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);
          const expanded = expandedFolders[cat.id] ?? true;

          return (
            <div key={cat.id} className="space-y-0.5">
              <div
                className={`flex items-center justify-between px-1.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  scope.type === "category" && scope.id === cat.id
                    ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
                    : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70"
                }`}
              >
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFolders((prev) => ({
                        ...prev,
                        [cat.id]: !expanded,
                      }));
                    }}
                    className="p-0.5 rounded hover:bg-slate-300/50 dark:hover:bg-slate-700"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      selectScope({ type: "category", id: cat.id, title: cat.title })
                    }
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                  >
                    <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{cat.title}</span>
                  </button>
                </div>
                {catUnread > 0 && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 pl-1">
                    {formatBadge(catUnread)}
                  </span>
                )}
              </div>

              {expanded && (
                <div className="pl-5 space-y-0.5">
                  {catFeeds.map((f) => (
                    <div
                      key={f.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFeedMenu({
                          feed: f,
                          x: Math.min(e.clientX, window.innerWidth - 240),
                          y: Math.min(e.clientY, window.innerHeight - 360),
                        });
                      }}
                      className={`group/feed flex items-center justify-between px-2 py-1 rounded-md text-[13px] transition-colors ${
                        scope.type === "feed" && scope.id === f.id
                          ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
                          : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <button
                        onClick={() =>
                          selectScope({ type: "feed", id: f.id, title: f.title })
                        }
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        <FeedIcon feedId={f.id} />
                        <span className="truncate">{f.title}</span>
                      </button>
                      <div className="flex items-center gap-1 pl-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (
                              e.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            setFeedMenu({
                              feed: f,
                              x: Math.min(rect.right + 4, window.innerWidth - 240),
                              y: Math.min(rect.top, window.innerHeight - 360),
                            });
                          }}
                          title="Tuỳ chọn feed"
                          className="opacity-0 group-hover/feed:opacity-100 p-0.5 rounded hover:bg-slate-300/60 dark:hover:bg-slate-700 text-slate-400"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                        {f.unread_count > 0 && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatBadge(f.unread_count)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Mục Tags phân loại thủ công */}
        <div className="pt-3 pb-1 px-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <button
            onClick={() => setTagsExpanded((v) => !v)}
            className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {tagsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>{t("tags")}</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void handleQuickCreateTag()}
              title={t("createQuickTagPrompt")}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-green-600"
            >
              <Plus className="w-3 h-3" />
            </button>
            <Link
              href="/manage?tab=tags"
              title={t("manageTags")}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <SlidersHorizontal className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {tagsExpanded && (
          <div className="space-y-0.5">
            {tagsList.length === 0 ? (
              <div className="px-2.5 py-1 text-[11px] text-slate-400">
                {t("noTagsYet")}
              </div>
            ) : (
              tagsList.map((tg) => {
                const st = getTagStyle(tg.color);
                const activeTag = scope.type === "tag" && scope.tag === tg.name;
                return (
                  <button
                    key={tg.name}
                    onClick={() => selectScope({ type: "tag", tag: tg.name })}
                    className={`w-full flex items-center justify-between px-2.5 py-1 rounded-lg text-[13px] transition-colors ${
                      activeTag
                        ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
                        : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                      <span className="truncate">{tg.name}</span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 pl-1 shrink-0">
                      {tg.unread_count > 0
                        ? formatBadge(tg.unread_count)
                        : tg.total_count > 0
                          ? `· ${tg.total_count}`
                          : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Thanh icon ngoài cùng bên trái (giống Inoreader) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-12 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 py-2">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={t("toggleSidebar")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Menu className="w-4 h-4" />
          </button>
          <button
            onClick={() => selectScope({ type: "all" })}
            title={t("newsfeed")}
            className={`p-2 rounded-lg ${
              scope.type === "all"
                ? "bg-green-600 text-white"
                : "hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={() => selectScope({ type: "starred" })}
            title={t("saved")}
            className={`p-2 rounded-lg ${
              scope.type === "starred"
                ? "bg-green-600 text-white"
                : "hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            <Bookmark className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setShowFilters((v) => !v);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            title={`${t("search")} (/)`}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Search className="w-4 h-4" />
          </button>
          <Link
            href="/add"
            title={t("addSource")}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
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
          {passwordEnabled && (
            <button
              onClick={() => void handleLogout()}
              title={t("logout")}
              className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Sidebar Feeds trên Desktop */}
      {sidebarOpen && (
        <aside className="hidden md:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
          {sidebarContent}
        </aside>
      )}

      {/* Drawer Sidebar trên Mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full shadow-2xl border-r border-slate-200 dark:border-slate-800">
            {sidebarContent}
          </div>
          <div
            className="flex-1 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Vùng nội dung chính */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Thanh công cụ trên cùng */}
        <header className="h-12 px-3 md:px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-white dark:bg-slate-950 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-base truncate">{currentHeading}</h1>
            <span className="hidden sm:inline text-xs text-slate-400">
              ({totalEntries})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Đánh dấu đã đọc + menu cũ hơn 1 ngày / 1 tuần */}
            {scope.type !== "starred" && (
              <div className="relative flex items-center">
                <button
                  onClick={() => void handleMarkAllRead()}
                  title={t("markAllReadTitle")}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-l-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-green-600" />
                  <span className="hidden lg:inline">{t("markAllRead")}</span>
                </button>
                <button
                  onClick={() => setMarkMenuOpen((v) => !v)}
                  className="px-1.5 py-1.5 rounded-r-lg border-y border-r border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {markMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg py-1 z-30 text-xs">
                    <button
                      onClick={() => void handleMarkAllRead()}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {t("markAllAsReadMenu")}
                    </button>
                    <button
                      onClick={() => void handleMarkAllRead(1)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {t("olderThan1Day")}
                    </button>
                    <button
                      onClick={() => void handleMarkAllRead(7)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {t("olderThan1Week")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Unread / All */}
            {scope.type !== "starred" &&
              !((scope.type === "feed" || scope.type === "category") && scope.starredOnly) && (
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 text-xs">
                <button
                  onClick={() => setStatusFilter("unread")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    statusFilter === "unread"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {t("unread")}
                </button>
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    statusFilter === "all"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {t("all")}
                </button>
              </div>
            )}

            {/* Đọc khi cuộn */}
            <button
              onClick={() => setMarkOnScroll((v) => !v)}
              title={t("markOnScrollTitle")}
              className={`hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs ${
                markOnScroll
                  ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300"
                  : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
              }`}
            >
              {t("markOnScroll")}
            </button>

            {/* Chọn nhiều */}
            <button
              onClick={() => {
                const next = !selectMode;
                setSelectMode(next);
                if (!next) {
                  setSelectedIds(new Set());
                  setSelectAllByFilter(false);
                  setBulkTagOpen(false);
                }
              }}
              title={t("selectTitle")}
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs ${
                selectMode
                  ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-medium"
                  : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t("select")}</span>
            </button>

            {/* Tìm kiếm */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              title={t("searchFilterTitle")}
              className={`p-1.5 rounded-lg border ${
                showFilters || appliedSearch || afterDate || beforeDate
                  ? "border-green-500 text-green-600"
                  : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Làm mới */}
            <button
              onClick={() => void handleRefreshFeeds()}
              title={t("refreshFeeds")}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${refreshingFeeds ? "animate-spin" : ""}`} />
            </button>

            {/* Mobile add, status & theme */}
            <Link
              href="/add"
              className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-green-600"
              title={t("addSource")}
            >
              <Plus className="w-4 h-4" />
            </Link>
            <Link
              href="/status"
              className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
              title={t("systemStatus")}
            >
              <Activity className="w-4 h-4" />
            </Link>
            <button
              onClick={toggleTheme}
              className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Thanh tìm kiếm & lọc ngày (U8) */}
        {showFilters && (
          <div className="px-3 md:px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 flex flex-wrap items-center gap-2 text-xs">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(searchQuery);
              }}
              className="flex items-center gap-1.5 flex-1 min-w-[200px]"
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
              >
                {t("search")}
              </button>
            </form>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">{t("fromDate")}</span>
              <input
                type="date"
                value={afterDate}
                onChange={(e) => setAfterDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <span className="text-slate-500">{t("toDate")}</span>
              <input
                type="date"
                value={beforeDate}
                onChange={(e) => setBeforeDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              {(appliedSearch || searchQuery || afterDate || beforeDate) && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setAppliedSearch("");
                    setAfterDate("");
                    setBeforeDate("");
                  }}
                  className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  {t("clearFilter")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Thanh hành động chọn nhiều (B1-B3 + Bulk Tag) */}
        {(selectMode || selectedIds.size > 0) && (
          <div className="px-3 md:px-5 py-2 border-b border-green-200 dark:border-green-900 bg-green-50/90 dark:bg-green-950/50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-green-800 dark:text-green-200">
                {t("selectedArticlesCount", { count: selectedIds.size })}
                {selectAllByFilter && totalEntries > entries.length
                  ? t("applyAllFilterSuffix", { max: Math.min(totalEntries, 200) })
                  : ""}
              </span>
              <button
                onClick={handleSelectAllFiltered}
                className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900"
              >
                {t("selectAllByFilter")}
              </button>
              <button
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectAllByFilter(false);
                }}
                className="px-2 py-1 rounded hover:underline text-slate-600 dark:text-slate-300"
              >
                {t("deselect")}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 relative">
              <div className="relative">
                <button
                  onClick={() => setBulkTagOpen((v) => !v)}
                  disabled={selectedIds.size === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 font-medium"
                >
                  <Tag className="w-3.5 h-3.5 text-green-600" />
                  {t("bulkTagBtn")}
                </button>
                {bulkTagOpen && selectedIds.size > 0 && (
                  <div className="absolute right-0 top-full mt-1 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-2.5 z-40 space-y-2">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleBulkAddTag(bulkTagInput);
                      }}
                      className="flex gap-1"
                    >
                      <input
                        type="text"
                        value={bulkTagInput}
                        onChange={(e) => setBulkTagInput(e.target.value)}
                        placeholder={t("bulkTagPlaceholder")}
                        autoFocus
                        className="flex-1 min-w-0 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                      >
                        {t("apply")}
                      </button>
                    </form>
                    {tagsList.length > 0 && (
                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pt-1">
                        {tagsList.map((tg) => {
                          const st = getTagStyle(tg.color);
                          return (
                            <button
                              key={tg.name}
                              type="button"
                              onClick={() => void handleBulkAddTag(tg.name)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] hover:opacity-80 ${st.badge}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {tg.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => void handleExportZip()}
                disabled={exporting || (selectedIds.size === 0 && !selectAllByFilter)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium"
              >
                <FileArchive className="w-3.5 h-3.5" />
                {exporting ? t("compressing") : t("exportZip")}
              </button>
              <button
                onClick={() => void handleCopyAllMarkdown()}
                disabled={exporting || selectedIds.size === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 font-medium"
              >
                <Copy className="w-3.5 h-3.5" />
                {t("copyAllMarkdown")}
              </button>
              <button
                onClick={() => void markEntriesStatus(Array.from(selectedIds), "read")}
                disabled={selectedIds.size === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {t("markAsRead")}
              </button>
            </div>
          </div>
        )}

        {/* Danh sách bài dạng thẻ Magazine (U2) */}
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-3">
          {loadingList ? (
            <div className="max-w-4xl mx-auto space-y-3 py-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-24 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
                />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="max-w-md mx-auto py-16 text-center space-y-2 text-slate-500">
              <p className="text-base font-medium text-slate-700 dark:text-slate-300">
                {t("noArticles")}
              </p>
              <p className="text-sm">{t("noArticlesHint")}</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto divide-y divide-slate-100 dark:divide-slate-800/80">
              {entries.map((item, idx) => {
                const isSelected = selectedIds.has(item.id);
                const isFocused = idx === focusedIndex;
                const isUnread = item.status === "unread";

                return (
                  <article
                    key={item.id}
                    data-entry-id={item.id}
                    onClick={() => {
                      if (selectMode) toggleSelectId(item.id);
                      else void openEntry(item, idx);
                    }}
                    className={`group flex gap-3.5 py-3.5 px-2.5 -mx-2.5 rounded-xl cursor-pointer transition-colors ${
                      isFocused
                        ? "bg-green-50/70 dark:bg-green-950/30 ring-1 ring-green-400/50"
                        : "hover:bg-slate-50 dark:hover:bg-slate-900/70"
                    }`}
                  >
                    {/* Checkbox chọn nhiều */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectMode(true);
                        toggleSelectId(item.id);
                      }}
                      className={`pt-1 shrink-0 ${
                        selectMode || isSelected
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      } transition-opacity`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-green-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </div>

                    {/* Nội dung thẻ: hàng trên (ảnh + tiêu đề/mô tả) & hàng dưới (chỉ số tương tác thẳng hàng mọi thẻ) */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex gap-3.5 items-start">
                        {/* Thumbnail (ảnh đầu tiên hoặc enclosure) */}
                        {item.thumbnail && (
                          <div className="w-24 h-16 sm:w-28 sm:h-20 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200/70 dark:border-slate-800">
                            <img
                              src={item.thumbnail}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        {/* Tiêu đề, nguồn, trích 2 dòng, thời gian */}
                        <div className="flex-1 min-w-0">
                          <h2
                            className={`text-[15px] leading-snug line-clamp-2 ${
                              isUnread
                                ? "font-bold text-slate-900 dark:text-white"
                                : "font-normal text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {item.title}
                          </h2>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium truncate max-w-[200px]">
                              {item.feed.title}
                            </span>
                            {item.feed.category?.title && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] truncate">
                                {item.feed.category.title}
                              </span>
                            )}
                            {(item.tags || []).map((tagName) => {
                              const st = getTagStyle(tagColorMap.get(tagName));
                              return (
                                <button
                                  key={tagName}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectScope({ type: "tag", tag: tagName });
                                  }}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium hover:opacity-80 ${st.badge}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                  {tagName}
                                </button>
                              );
                            })}
                            <span>· {formatRelTime(item.published_at, t("justNow"), dateLocale)}</span>
                          </div>
                          {item.excerpt && (
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                              {item.excerpt}
                            </p>
                          )}
                        </div>
                      </div>

                      {item.social_metrics &&
                        (item.social_metrics.views !== null ||
                          item.social_metrics.likes !== null ||
                          item.social_metrics.comments !== null ||
                          item.social_metrics.shares !== null) && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {item.social_metrics.views !== null && (
                              <span
                                title="Lượt xem"
                                className="inline-flex items-center gap-1 min-w-[68px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80"
                              >
                                <Eye className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                                <span>{formatCompactMetric(item.social_metrics.views)}</span>
                              </span>
                            )}
                            {item.social_metrics.likes !== null && (
                              <span
                                title="Lượt thích"
                                className="inline-flex items-center gap-1 min-w-[58px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80"
                              >
                                <Heart className="w-3 h-3 text-rose-500 shrink-0" />
                                <span>{formatCompactMetric(item.social_metrics.likes)}</span>
                              </span>
                            )}
                            {item.social_metrics.comments !== null && (
                              <span
                                title="Bình luận"
                                className="inline-flex items-center gap-1 min-w-[54px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80"
                              >
                                <MessageCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>{formatCompactMetric(item.social_metrics.comments)}</span>
                              </span>
                            )}
                            {item.social_metrics.shares !== null && (
                              <span
                                title="Chia sẻ / Retweet"
                                className="inline-flex items-center gap-1 min-w-[54px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80"
                              >
                                <Repeat2 className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                                <span>{formatCompactMetric(item.social_metrics.shares)}</span>
                              </span>
                            )}
                          </div>
                        )}
                    </div>

                    {/* Nút thao tác nhanh trên thẻ */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-col items-end justify-between shrink-0 gap-1 relative"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            setCardTagPopover((prev) =>
                              prev?.entryId === item.id
                                ? null
                                : { entryId: item.id, input: "" }
                            )
                          }
                          title={t("chooseTagsTitle")}
                          className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 ${
                            (item.tags || []).length > 0
                              ? "text-green-600"
                              : "text-slate-400"
                          }`}
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void toggleBookmark(item.id)}
                          title={t("bookmarkTitle")}
                          className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 ${
                            item.starred ? "text-amber-500" : "text-slate-400"
                          }`}
                        >
                          <Bookmark
                            className="w-4 h-4"
                            fill={item.starred ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          onClick={() =>
                            void markEntriesStatus(
                              [item.id],
                              isUnread ? "read" : "unread"
                            )
                          }
                          title={t("toggleReadTitle")}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400"
                        >
                          <span
                            className={`block w-2.5 h-2.5 rounded-full ${
                              isUnread
                                ? "bg-green-600"
                                : "border border-slate-400"
                            }`}
                          />
                        </button>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("openOriginalTitle")}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hidden sm:inline-flex"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>

                      {cardTagPopover?.entryId === item.id && (
                        <div className="absolute right-0 top-8 z-40 w-60 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-2.5 space-y-2">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const next = cardTagPopover.input.trim();
                              if (!next) return;
                              void mutateEntryTag(item.id, { add: next });
                              setCardTagPopover({ entryId: item.id, input: "" });
                            }}
                            className="flex gap-1"
                          >
                            <input
                              type="text"
                              value={cardTagPopover.input}
                              onChange={(e) =>
                                setCardTagPopover({
                                  entryId: item.id,
                                  input: e.target.value,
                                })
                              }
                              placeholder={t("tagInputPlaceholder")}
                              autoFocus
                              className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                            />
                            <button
                              type="submit"
                              className="px-2 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                            >
                              +
                            </button>
                          </form>
                          {tagsList.length > 0 && (
                            <div className="max-h-40 overflow-y-auto space-y-0.5 text-xs">
                              {tagsList.map((tg) => {
                                const hasTag = (item.tags || []).includes(tg.name);
                                const st = getTagStyle(tg.color);
                                return (
                                  <button
                                    key={tg.name}
                                    type="button"
                                    onClick={() =>
                                      void mutateEntryTag(
                                        item.id,
                                        hasTag
                                          ? { remove: tg.name }
                                          : { add: tg.name }
                                      )
                                    }
                                    className="w-full flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                                  >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`}
                                      />
                                      <span className="truncate">{tg.name}</span>
                                    </span>
                                    {hasTag && (
                                      <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {/* Nút Xem thêm (~20 bài cũ hơn) */}
              <div ref={loadMoreRef} className="py-6 text-center">
                {loadingMore ? (
                  <span className="text-xs text-slate-400">
                    {t("loadingMore")}
                  </span>
                ) : entries.length < totalEntries ||
                  (activeFeedSupportsArchive && !archiveExhausted) ? (
                  <button
                    onClick={() => void handleLoadMore()}
                    className="px-5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold shadow-sm transition-colors"
                  >
                    {t("loadMoreBtn")}
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">{t("endOfList")}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Màn hình đọc bài viết (U6 + U7) */}
        {(activeEntry || loadingDetail) && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[1px]">
            <div
              className="flex-1 hidden md:block"
              onClick={() => setActiveEntry(null)}
            />
            <section className="w-full md:w-[760px] max-w-full h-full bg-white dark:bg-slate-950 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
              {/* Header trình đọc */}
              <div className="h-12 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveEntry(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    title={`${t("close")} (Esc)`}
                  >
                    <ChevronLeft className="w-5 h-5 md:hidden" />
                    <X className="w-4 h-4 hidden md:block" />
                  </button>
                  <button
                    onClick={() => {
                      if (focusedIndex > 0) {
                        void openEntry(entries[focusedIndex - 1], focusedIndex - 1);
                      }
                    }}
                    disabled={focusedIndex <= 0}
                    title={t("prevArticleTitle")}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (focusedIndex >= 0 && focusedIndex < entries.length - 1) {
                        void openEntry(entries[focusedIndex + 1], focusedIndex + 1);
                      }
                    }}
                    disabled={focusedIndex >= entries.length - 1}
                    title={t("nextArticleTitle")}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {activeEntry && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => void handleFetchFullContent()}
                      disabled={fetchingFull}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-green-600" />
                      {fetchingFull ? t("fetchingFullText") : t("fetchFullText")}
                    </button>
                    <button
                      onClick={() => void toggleBookmark(activeEntry.id)}
                      title={t("bookmarkTitle")}
                      className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 ${
                        activeEntry.starred ? "text-amber-500" : "text-slate-500"
                      }`}
                    >
                      <Bookmark
                        className="w-4 h-4"
                        fill={activeEntry.starred ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      onClick={() =>
                        void markEntriesStatus(
                          [activeEntry.id],
                          activeEntry.status === "unread" ? "read" : "unread"
                        )
                      }
                      title={t("toggleReadTitle")}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                    >
                      {activeEntry.status === "unread" ? t("unread") : t("read")}
                    </button>
                    <a
                      href={activeEntry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("openOriginalTitle")}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>

              {/* Thanh Copy nhanh (U7) */}
              {activeEntry && (
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 flex flex-wrap items-center gap-1.5 text-xs shrink-0">
                  <button
                    onClick={() =>
                      void copyText(
                        `${activeEntry.title}\n\n${activeEntry.plain_text}`,
                        "text"
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {t("copyText")}
                  </button>
                  <button
                    onClick={() =>
                      void copyText(
                        `# ${activeEntry.title}\n\nSource: ${activeEntry.feed.title} (${activeEntry.url})\n\n${activeEntry.markdown}`,
                        "Markdown"
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {t("copyMarkdown")}
                  </button>
                  <button
                    onClick={() =>
                      void copyText(
                        `${activeEntry.title}\n${activeEntry.url}\n\n${activeEntry.plain_text}`,
                        "text + link"
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {t("copyTextLink")}
                  </button>
                  {activeEntry.images.length > 0 && (
                    <a
                      href={`/api/entries/${activeEntry.id}/images-zip`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("downloadAllImages", { count: activeEntry.images.length })}
                    </a>
                  )}
                  <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
                    {t("copyImageTip")}
                  </span>
                </div>
              )}

              {/* Nội dung bài viết */}
              <div className="flex-1 overflow-y-auto px-5 md:px-8 py-6">
                {loadingDetail && !activeEntry ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-7 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
                    <div className="h-48 bg-slate-100 dark:bg-slate-900 rounded" />
                  </div>
                ) : activeEntry ? (
                  <div className="max-w-2xl mx-auto">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-green-700 dark:text-green-400">
                        {activeEntry.feed.title}
                      </span>
                      {activeEntry.author && <span>· {activeEntry.author}</span>}
                      <span>
                        · {new Date(activeEntry.published_at).toLocaleString(dateLocale)}
                      </span>
                    </div>

                    <h1 className="text-2xl font-bold leading-tight mb-4">
                      <a
                        href={activeEntry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {activeEntry.title}
                      </a>
                    </h1>

                    {isTrackableSocialEntryUrl(activeEntry.url) && (
                      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                        {activeEntry.social_metrics?.views !== null &&
                          activeEntry.social_metrics?.views !== undefined && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/70 dark:border-sky-900 font-medium">
                              <Eye className="w-3.5 h-3.5" />
                              {activeEntry.social_metrics.views.toLocaleString("en-US")} {locale === "en" ? "views" : "lượt xem"}
                            </span>
                          )}
                        {activeEntry.social_metrics?.likes !== null &&
                          activeEntry.social_metrics?.likes !== undefined && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-900 font-medium">
                              <Heart className="w-3.5 h-3.5" />
                              {activeEntry.social_metrics.likes.toLocaleString("en-US")} {locale === "en" ? "likes" : "thích"}
                            </span>
                          )}
                        {activeEntry.social_metrics?.comments !== null &&
                          activeEntry.social_metrics?.comments !== undefined && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900 font-medium">
                              <MessageCircle className="w-3.5 h-3.5" />
                              {activeEntry.social_metrics.comments.toLocaleString("en-US")} {locale === "en" ? "comments" : "bình luận"}
                            </span>
                          )}
                        {activeEntry.social_metrics?.shares !== null &&
                          activeEntry.social_metrics?.shares !== undefined && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900 font-medium">
                              <Repeat2 className="w-3.5 h-3.5" />
                              {activeEntry.social_metrics.shares.toLocaleString("en-US")} {locale === "en" ? "shares" : "chia sẻ"}
                            </span>
                          )}
                        <button
                          type="button"
                          disabled={refreshingMetrics}
                          onClick={() => void syncMetricsForIds([activeEntry.id], true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-50"
                          title={
                            activeEntry.social_metrics?.updated_at
                              ? `${locale === "en" ? "Updated" : "Cập nhật"}: ${new Date(activeEntry.social_metrics.updated_at).toLocaleString(dateLocale)}`
                              : undefined
                          }
                        >
                          <RefreshCw className={`w-3 h-3 ${refreshingMetrics ? "animate-spin" : ""}`} />
                          {locale === "en" ? "Refresh stats" : "Cập nhật tương tác"}
                        </button>
                      </div>
                    )}

                    {/* Thanh gắn Tag thủ công cho bài đang đọc */}
                    <div className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
                      <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {(activeEntry.tags || []).map((tagName) => {
                        const st = getTagStyle(tagColorMap.get(tagName));
                        return (
                          <span
                            key={tagName}
                            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border font-medium ${st.badge}`}
                          >
                            <button
                              type="button"
                              onClick={() => selectScope({ type: "tag", tag: tagName })}
                              className="hover:underline"
                            >
                              {tagName}
                            </button>
                            <button
                              type="button"
                              title={t("removeTagTitle")}
                              onClick={() =>
                                void mutateEntryTag(activeEntry.id, {
                                  remove: tagName,
                                })
                              }
                              className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const next = detailTagInput.trim();
                          if (!next) return;
                          void mutateEntryTag(activeEntry.id, { add: next });
                          setDetailTagInput("");
                        }}
                        className="inline-flex items-center gap-1"
                      >
                        <input
                          ref={detailTagInputRef}
                          type="text"
                          list="rss-existing-tags-list"
                          value={detailTagInput}
                          onChange={(e) => setDetailTagInput(e.target.value)}
                          placeholder={t("addTag")}
                          className="w-28 focus:w-44 transition-all px-2.5 py-0.5 rounded-full border border-dashed border-slate-300 dark:border-slate-700 bg-transparent text-xs focus:outline-none focus:border-green-500"
                        />
                      </form>
                      <datalist id="rss-existing-tags-list">
                        {tagsList.map((tg) => (
                          <option key={tg.name} value={tg.name} />
                        ))}
                      </datalist>
                    </div>

                    {activeEntry.youtube_embed_id && (
                      <div className="mb-5 aspect-video w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-black">
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${activeEntry.youtube_embed_id}`}
                          title={activeEntry.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="w-full h-full"
                        />
                      </div>
                    )}

                    {activeEntry.videos && activeEntry.videos.length > 0 && !videoFallbackEmbed && (
                      <div className="mb-5 space-y-3">
                        {activeEntry.videos.map((v) => (
                          <video
                            key={v.url}
                            src={v.url}
                            poster={v.poster}
                            controls
                            playsInline
                            preload="metadata"
                            onError={() => {
                              if (activeEntry.tiktok_embed_id) {
                                setVideoFallbackEmbed(true);
                              }
                            }}
                            className="w-full max-h-[520px] rounded-xl bg-black border border-slate-200 dark:border-slate-800"
                          />
                        ))}
                      </div>
                    )}

                    {videoFallbackEmbed && activeEntry.tiktok_embed_id && (
                      <div className="mb-5 w-full flex justify-center">
                        <iframe
                          src={`https://www.tiktok.com/embed/v2/${activeEntry.tiktok_embed_id}`}
                          title={activeEntry.title}
                          allow="encrypted-media"
                          allowFullScreen
                          className="w-full max-w-[360px] h-[640px] rounded-xl border border-slate-200 dark:border-slate-800 bg-black"
                        />
                      </div>
                    )}

                    <div
                      className="article-prose"
                      onClick={(e) => {
                        const target = e.target as HTMLElement | null;
                        if (target && target.tagName === "IMG") {
                          e.preventDefault();
                          const src = (target as HTMLImageElement).src;
                          if (src) void copyImageFromSrc(src);
                        }
                      }}
                      dangerouslySetInnerHTML={{ __html: activeEntry.sanitized_html }}
                    />
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Menu chuột phải / tuỳ chọn cho từng Feed (Ảnh 1) */}
      {feedMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: feedMenu.x, top: feedMenu.y }}
          className="fixed z-50 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl py-1.5 text-[13px]"
        >
          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              setFeedModal({ feed: target, tab: "properties" });
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            {t("feedProperties")}
          </button>
          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              void handleRenameFeed(target);
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("renameFeed")}
          </button>
          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              handleSetStartPage(target);
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("setStartPage")}
          </button>

          {/* Submenu chuyển thư mục */}
          <div className="relative">
            <button
              onClick={() =>
                setFeedMenu((prev) =>
                  prev ? { ...prev, showFolders: !prev.showFolders } : null
                )
              }
              className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
            >
              <span>{t("moveToFolder")}</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {feedMenu.showFolders && (
              <div className="border-y border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 py-1 max-h-40 overflow-y-auto">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      const target = feedMenu.feed;
                      setFeedMenu(null);
                      void handleMoveFeedToFolder(target, c.id);
                    }}
                    className={`w-full px-5 py-1.5 text-left text-xs hover:bg-slate-200/60 dark:hover:bg-slate-800 flex items-center justify-between ${
                      feedMenu.feed.category?.id === c.id
                        ? "font-semibold text-green-600"
                        : ""
                    }`}
                  >
                    <span className="truncate">{c.title}</span>
                    {feedMenu.feed.category?.id === c.id && (
                      <Check className="w-3 h-3" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              setFeedModal({ feed: target, tab: "filter" });
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {t("filterFeed")}
          </button>
          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              void handleUnfollowFeed(target);
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("unfollow")}
          </button>
          <button
            onClick={() => {
              const target = feedMenu.feed;
              setFeedMenu(null);
              selectScope({
                type: "feed",
                id: target.id,
                title: target.title,
                starredOnly: true,
              });
            }}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Bookmark className="w-3.5 h-3.5 text-slate-400" />
            {t("viewSavedOnly")}
          </button>

          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <Link
            href="/manage"
            onClick={() => setFeedMenu(null)}
            className="w-full px-3.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            {t("manageContent")}
          </Link>
        </div>
      )}

      {feedModal && (
        <FeedPropertiesModal
          feed={feedModal.feed}
          folders={categories}
          initialTab={feedModal.tab}
          onClose={() => setFeedModal(null)}
          onSaved={(msg) => {
            showToast(msg);
            void Promise.all([loadSidebar(), loadEntries(true)]);
          }}
        />
      )}

      {/* Toast thông báo */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
