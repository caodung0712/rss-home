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
  FileArchive,
  FileText,
  Folder,
  Home,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Rss,
  Search,
  Sparkles,
  Square,
  Sun,
  X,
} from "lucide-react";

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
}

type ViewScope =
  | { type: "all" }
  | { type: "starred" }
  | { type: "category"; id: number; title: string }
  | { type: "feed"; id: number; title: string };

function formatBadge(n: number): string {
  if (n > 999) return "1000+";
  return String(Math.max(0, n));
}

function formatRelTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "vừa xong";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Date(ts).toLocaleDateString("vi-VN");
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
  // Sidebar & theme
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Dữ liệu sidebar
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [feeds, setFeeds] = useState<FeedItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [starredTotal, setStarredTotal] = useState(0);
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});

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
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [markMenuOpen, setMarkMenuOpen] = useState(false);

  // Bài đang chọn & màn hình đọc bài
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [activeEntry, setActiveEntry] = useState<EntryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [fetchingFull, setFetchingFull] = useState(false);

  // Chọn nhiều & xuất hàng loạt
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllByFilter, setSelectAllByFilter] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Toast thông báo
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const autoMarkedScrollRef = useRef<Set<number>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // Khởi tạo theme
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
        total_unread: number;
        starred_total: number;
      };
      setCategories(data.categories || []);
      setFeeds(data.feeds || []);
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

  const buildFilterQuery = useCallback(
    (offset: number, limit = 40) => {
      const p = new URLSearchParams();
      if (scope.type !== "starred" && statusFilter === "unread") {
        p.set("status", "unread");
      }
      if (scope.type === "category") p.set("category_id", String(scope.id));
      if (scope.type === "feed") p.set("feed_id", String(scope.id));
      if (scope.type === "starred") p.set("starred", "true");
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
        const params = buildFilterQuery(offset, 40);
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
        setTotalEntries(data.total || 0);
        if (reset) {
          setEntries(data.entries || []);
          setFocusedIndex(data.entries?.length ? 0 : -1);
        } else {
          setEntries((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const appended = (data.entries || []).filter((x) => !seen.has(x.id));
            return [...prev, ...appended];
          });
        }
      } catch {
        showToast("Không tải được danh sách bài viết.");
      } finally {
        setLoadingList(false);
        setLoadingMore(false);
      }
    },
    [buildFilterQuery, entries.length, showToast]
  );

  useEffect(() => {
    void loadSidebar();
  }, [loadSidebar]);

  useEffect(() => {
    void loadEntries(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusFilter, appliedSearch, afterDate, beforeDate]);

  // Cuộn vô hạn
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (items) => {
        if (
          items[0]?.isIntersecting &&
          !loadingList &&
          !loadingMore &&
          entries.length < totalEntries
        ) {
          void loadEntries(false);
        }
      },
      { rootMargin: "250px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [entries.length, totalEntries, loadingList, loadingMore, loadEntries]);

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
        showToast("Lỗi cập nhật trạng thái đọc.");
      }
    },
    [loadSidebar, showToast]
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
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/entries/${item.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("err");
        const detail = (await res.json()) as EntryDetail;
        setActiveEntry(detail);
        if (item.status === "unread") {
          void markEntriesStatus([item.id], "read");
        }
      } catch {
        showToast("Không mở được nội dung bài viết.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [markEntriesStatus, showToast]
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
        showToast("Không cập nhật được bookmark.");
      }
    },
    [loadSidebar, showToast]
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
      showToast("Đã lấy toàn văn bài viết.");
    } catch {
      showToast("Không lấy được toàn văn từ trang gốc.");
    } finally {
      setFetchingFull(false);
    }
  };

  const handleMarkAllRead = useCallback(
    async (olderThanDays?: number) => {
      setMarkMenuOpen(false);
      const payload: {
        scope: "all" | "category" | "feed";
        id?: number;
        olderThanDays?: number;
      } = {
        scope:
          scope.type === "category"
            ? "category"
            : scope.type === "feed"
              ? "feed"
              : "all",
        id:
          scope.type === "category" || scope.type === "feed"
            ? scope.id
            : undefined,
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
            ? `Đã đánh dấu đọc các bài cũ hơn ${olderThanDays} ngày.`
            : "Đã đánh dấu tất cả là đã đọc."
        );
        await Promise.all([loadSidebar(), loadEntries(true)]);
      } catch {
        showToast("Lỗi khi đánh dấu tất cả đã đọc.");
      }
    },
    [scope, loadSidebar, loadEntries, showToast]
  );

  const handleRefreshFeeds = async () => {
    setRefreshingFeeds(true);
    try {
      await fetch("/api/feeds/refresh", { method: "PUT" });
      showToast("Đã yêu cầu Miniflux quét lại các feed.");
      setTimeout(() => {
        void loadSidebar();
        void loadEntries(true);
      }, 1500);
    } catch {
      showToast("Không làm mới được feed.");
    } finally {
      setRefreshingFeeds(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã copy ${label}.`);
    } catch {
      showToast("Trình duyệt không cho phép copy tự động.");
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
      showToast("Đã copy ảnh vào clipboard!");
    } catch {
      showToast("Không copy được ảnh trực tiếp, hãy thử tải ZIP ảnh.");
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
        ? `Đã chọn toàn bộ theo bộ lọc hiện tại (tối đa 200 bài khi xuất ZIP).`
        : `Đã chọn tất cả ${entries.length} bài.`
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
      showToast("Đã xuất file ZIP thành công!");
    } catch {
      showToast("Lỗi khi xuất ZIP.");
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
      showToast(`Đã copy ${data.count} bài thành một khối Markdown!`);
    } catch {
      showToast("Lỗi copy Markdown hàng loạt.");
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

  const currentHeading = useMemo(() => {
    if (scope.type === "all") return "Newsfeed";
    if (scope.type === "starred") return "Đã lưu";
    return scope.title;
  }, [scope]);

  const selectScope = (next: ViewScope) => {
    setScope(next);
    setActiveEntry(null);
    setSelectedIds(new Set());
    setSelectAllByFilter(false);
    setMobileMenuOpen(false);
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleRefreshFeeds()}
            title="Làm mới feeds"
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
            Newsfeed
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
            Đã lưu
          </span>
          {starredTotal > 0 && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {formatBadge(starredTotal)}
            </span>
          )}
        </button>

        <div className="pt-2 pb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Thư mục
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
                    <button
                      key={f.id}
                      onClick={() =>
                        selectScope({ type: "feed", id: f.id, title: f.title })
                      }
                      className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-[13px] transition-colors ${
                        scope.type === "feed" && scope.id === f.id
                          ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-semibold"
                          : "hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FeedIcon feedId={f.id} />
                        <span className="truncate">{f.title}</span>
                      </span>
                      {f.unread_count > 0 && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 pl-1 shrink-0">
                          {formatBadge(f.unread_count)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
            title="Ẩn/hiện thanh Feeds"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Menu className="w-4 h-4" />
          </button>
          <button
            onClick={() => selectScope({ type: "all" })}
            title="Newsfeed"
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
            title="Đã lưu"
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
            title="Tìm kiếm (phím /)"
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Search className="w-4 h-4" />
          </button>
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
          {passwordEnabled && (
            <button
              onClick={() => void handleLogout()}
              title="Đăng xuất"
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
                  title="Đánh dấu tất cả đã đọc (Shift+A)"
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-l-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-green-600" />
                  <span className="hidden lg:inline">Đọc hết</span>
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
                      Đánh dấu tất cả đã đọc
                    </button>
                    <button
                      onClick={() => void handleMarkAllRead(1)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cũ hơn 1 ngày
                    </button>
                    <button
                      onClick={() => void handleMarkAllRead(7)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cũ hơn 1 tuần
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Unread / All */}
            {scope.type !== "starred" && (
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 text-xs">
                <button
                  onClick={() => setStatusFilter("unread")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    statusFilter === "unread"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Chưa đọc
                </button>
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    statusFilter === "all"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Tất cả
                </button>
              </div>
            )}

            {/* Đọc khi cuộn */}
            <button
              onClick={() => setMarkOnScroll((v) => !v)}
              title="Tự động đánh dấu đã đọc khi cuộn qua"
              className={`hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs ${
                markOnScroll
                  ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300"
                  : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
              }`}
            >
              Đọc khi cuộn
            </button>

            {/* Chọn nhiều */}
            <button
              onClick={() => {
                const next = !selectMode;
                setSelectMode(next);
                if (!next) {
                  setSelectedIds(new Set());
                  setSelectAllByFilter(false);
                }
              }}
              title="Chế độ chọn nhiều bài để xuất ZIP"
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs ${
                selectMode
                  ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 font-medium"
                  : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chọn</span>
            </button>

            {/* Tìm kiếm */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              title="Tìm kiếm & lọc ngày"
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
              title="Làm mới feeds"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${refreshingFeeds ? "animate-spin" : ""}`} />
            </button>

            {/* Mobile status & theme */}
            <Link
              href="/status"
              className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
              title="Trạng thái"
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
                placeholder="Tìm từ khoá trong tiêu đề hoặc nội dung..."
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
              >
                Tìm
              </button>
            </form>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Từ:</span>
              <input
                type="date"
                value={afterDate}
                onChange={(e) => setAfterDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <span className="text-slate-500">Đến:</span>
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
                  Xoá lọc
                </button>
              )}
            </div>
          </div>
        )}

        {/* Thanh hành động chọn nhiều (B1-B3) */}
        {(selectMode || selectedIds.size > 0) && (
          <div className="px-3 md:px-5 py-2 border-b border-green-200 dark:border-green-900 bg-green-50/90 dark:bg-green-950/50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-green-800 dark:text-green-200">
                Đã chọn {selectedIds.size} bài
                {selectAllByFilter && totalEntries > entries.length
                  ? ` (áp dụng toàn bộ bộ lọc ~${Math.min(totalEntries, 200)} bài)`
                  : ""}
              </span>
              <button
                onClick={handleSelectAllFiltered}
                className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900"
              >
                Chọn tất cả theo bộ lọc
              </button>
              <button
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectAllByFilter(false);
                }}
                className="px-2 py-1 rounded hover:underline text-slate-600 dark:text-slate-300"
              >
                Bỏ chọn
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => void handleExportZip()}
                disabled={exporting || (selectedIds.size === 0 && !selectAllByFilter)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium"
              >
                <FileArchive className="w-3.5 h-3.5" />
                {exporting ? "Đang nén..." : "Xuất ZIP (MD + ảnh + CSV)"}
              </button>
              <button
                onClick={() => void handleCopyAllMarkdown()}
                disabled={exporting || selectedIds.size === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 font-medium"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy tất cả Markdown
              </button>
              <button
                onClick={() => void markEntriesStatus(Array.from(selectedIds), "read")}
                disabled={selectedIds.size === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                Đánh dấu đã đọc
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
                Không có bài viết nào
              </p>
              <p className="text-sm">
                Thử chuyển sang mục &ldquo;Tất cả&rdquo; hoặc nhấn làm mới để quét thêm tin.
              </p>
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
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <h2
                          className={`text-[15px] leading-snug line-clamp-2 ${
                            isUnread
                              ? "font-bold text-slate-900 dark:text-white"
                              : "font-normal text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {item.title}
                        </h2>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-medium truncate max-w-[200px]">
                            {item.feed.title}
                          </span>
                          {item.feed.category?.title && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] truncate">
                              {item.feed.category.title}
                            </span>
                          )}
                          <span>· {formatRelTime(item.published_at)}</span>
                        </div>
                        {item.excerpt && (
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                            {item.excerpt}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Nút thao tác nhanh trên thẻ */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-col items-end justify-between shrink-0 gap-1"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void toggleBookmark(item.id)}
                          title="Lưu bài viết (s)"
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
                          title="Đánh dấu đã đọc / chưa đọc (m)"
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
                          title="Mở bài gốc (v)"
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hidden sm:inline-flex"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}

              {/* Sentinel cuộn vô hạn */}
              <div ref={loadMoreRef} className="py-6 text-center">
                {loadingMore ? (
                  <span className="text-xs text-slate-400">Đang tải thêm...</span>
                ) : entries.length < totalEntries ? (
                  <button
                    onClick={() => void loadEntries(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Tải thêm bài viết
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">Đã hiển thị hết danh sách</span>
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
                    title="Đóng (Esc)"
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
                    title="Bài trước (k)"
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
                    title="Bài tiếp (j)"
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
                      {fetchingFull ? "Đang lấy..." : "Lấy toàn văn"}
                    </button>
                    <button
                      onClick={() => void toggleBookmark(activeEntry.id)}
                      title="Lưu bài viết (s)"
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
                      title="Đánh dấu đã đọc / chưa đọc (m)"
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                    >
                      {activeEntry.status === "unread" ? "Chưa đọc" : "Đã đọc"}
                    </button>
                    <a
                      href={activeEntry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Mở bài gốc (v)"
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
                        "text bài viết"
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Copy text
                  </button>
                  <button
                    onClick={() =>
                      void copyText(
                        `# ${activeEntry.title}\n\nNguồn: ${activeEntry.feed.title} (${activeEntry.url})\n\n${activeEntry.markdown}`,
                        "Markdown"
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Markdown
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
                    Copy text + link
                  </button>
                  {activeEntry.images.length > 0 && (
                    <a
                      href={`/api/entries/${activeEntry.id}/images-zip`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Tải tất cả ảnh ({activeEntry.images.length})
                    </a>
                  )}
                  <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
                    Mẹo: bấm trực tiếp vào ảnh bên dưới để copy ảnh
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
                        · {new Date(activeEntry.published_at).toLocaleString("vi-VN")}
                      </span>
                    </div>

                    <h1 className="text-2xl font-bold leading-tight mb-6">
                      <a
                        href={activeEntry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {activeEntry.title}
                      </a>
                    </h1>

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

      {/* Toast thông báo */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
