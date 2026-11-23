"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpDown,
  Bookmark,
  Check,
  Database,
  Edit2,
  Eraser,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  FolderPlus,
  Globe,
  HardDrive,
  Home,
  Moon,
  Plus,
  RefreshCw,
  Rocket,
  Rss,
  Search,
  Settings,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useI18n, type Locale } from "@/lib/i18n";
import { TAG_COLORS, getTagStyle, type TagColorKey } from "@/lib/tag-colors";
import {
  FeedPropertiesModal,
  type EditableFeed,
  type FolderOption,
} from "./FeedModals";

interface ContentFeed extends EditableFeed {
  checked_at: string;
  feed_type: string;
  read_count: number;
  unread_count: number;
  starred_count?: number;
  stored_entries?: number;
  storage_bytes?: number;
  engagement_pct: number;
  last_post_at: string | null;
  is_filtered: boolean;
}

interface StorageSummary {
  db_bytes: number;
  total_active_entries: number;
  total_removed_entries: number;
  redis_bytes: number;
  redis_keys: number;
  auto_cleanup_days: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface ContentCategory extends FolderOption {
  feed_count?: number;
  total_unread?: number;
}

interface ManagedTag {
  name: string;
  color: TagColorKey;
  total_count: number;
  unread_count: number;
}

function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "<1m";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function FeedLogo({ feedId }: { feedId: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Rss className="w-5 h-5 text-slate-400 shrink-0" />;
  }
  return (
    <img
      src={`/api/feeds/${feedId}/icon`}
      alt=""
      className="w-6 h-6 rounded object-contain shrink-0 bg-slate-100 dark:bg-slate-800"
      onError={() => setFailed(true)}
    />
  );
}

export default function ContentManager() {
  const { locale, setLocale, t } = useI18n();
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"feeds" | "folders" | "tags" | "settings">("feeds");
  const [loading, setLoading] = useState(true);

  const [feeds, setFeeds] = useState<ContentFeed[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [tagsList, setTagsList] = useState<ManagedTag[]>([]);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);

  // Tạo tag mới
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<TagColorKey>("emerald");
  const [savingTag, setSavingTag] = useState(false);

  // Bộ lọc bảng Feeds (giống ảnh 2)
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [limitCount, setLimitCount] = useState<number>(100);
  const [sortBy, setSortBy] = useState<"name" | "size" | "entries">("size");
  const [showUrls, setShowUrls] = useState(false);
  const [statusPill, setStatusPill] = useState<
    "all" | "deactivated" | "filtered" | "issues"
  >("all");

  // Chọn nhiều
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Modal thuộc tính / lọc feed & modal dọn bài cũ
  const [modalState, setModalState] = useState<{
    feed: ContentFeed;
    tab: "properties" | "filter";
  } | null>(null);
  const [cleanupModal, setCleanupModal] = useState<{
    feedIds?: number[];
    label: string;
  } | null>(null);
  const [cleanupDays, setCleanupDays] = useState<number>(180);
  const [cleanupIncludeUnread, setCleanupIncludeUnread] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  // Quản lý thư mục
  const [newFolderTitle, setNewFolderTitle] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    const saved = localStorage.getItem("rss-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved ? saved === "dark" : prefersDark;
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);

    try {
      const tabParam = new URLSearchParams(window.location.search).get("tab");
      if (
        tabParam === "feeds" ||
        tabParam === "folders" ||
        tabParam === "tags" ||
        tabParam === "settings"
      ) {
        setActiveTab(tabParam);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("rss-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      const [res, tagsRes] = await Promise.all([
        fetch("/api/content", { cache: "no-store" }),
        fetch("/api/tags", { cache: "no-store" }),
      ]);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as {
          categories: ContentCategory[];
          feeds: ContentFeed[];
          storage_summary?: StorageSummary;
        };
        setCategories(data.categories || []);
        setFeeds(data.feeds || []);
        setStorageSummary(data.storage_summary || null);
      }
      if (tagsRes.ok) {
        const tData = (await tagsRes.json()) as { tags?: ManagedTag[] };
        setTagsList(tData.tags || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const filteredFeeds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = feeds.filter((f) => {
      if (folderFilter !== "all" && String(f.category?.id) !== folderFilter) {
        return false;
      }
      if (typeFilter !== "all" && f.feed_type !== typeFilter) {
        return false;
      }
      if (statusPill === "deactivated" && !f.disabled) return false;
      if (statusPill === "filtered" && !f.is_filtered) return false;
      if (statusPill === "issues" && (f.parsing_error_count || 0) === 0) return false;
      if (q) {
        const hit =
          f.title.toLowerCase().includes(q) ||
          f.feed_url.toLowerCase().includes(q) ||
          (f.category?.title || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "size") {
        return (b.storage_bytes || 0) - (a.storage_bytes || 0);
      }
      if (sortBy === "entries") {
        return (b.stored_entries || 0) - (a.stored_entries || 0);
      }
      return a.title.localeCompare(b.title, "vi");
    });

    return filtered.slice(0, limitCount);
  }, [feeds, search, folderFilter, typeFilter, statusPill, sortBy, limitCount]);

  const handleClearCache = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/content/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_cache" }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      showToast(data.message || "Đã xoá cache thành công.");
      await loadContent();
    } finally {
      setCleaning(false);
    }
  };

  const handleRunCleanup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanupModal) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/content/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_old_entries",
          feedIds: cleanupModal.feedIds,
          olderThanDays: cleanupDays,
          includeUnread: cleanupIncludeUnread,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        showToast(data.error || "Lỗi khi dọn bài cũ.");
      } else {
        showToast(data.message || "Đã dọn bài cũ thành công.");
        setCleanupModal(null);
        await loadContent();
      }
    } finally {
      setCleaning(false);
    }
  };

  const toggleEnabled = async (feed: ContentFeed) => {
    const nextDisabled = !feed.disabled;
    setFeeds((prev) =>
      prev.map((f) => (f.id === feed.id ? { ...f, disabled: nextDisabled } : f))
    );
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: nextDisabled }),
    });
    showToast(nextDisabled ? `Đã tạm tắt "${feed.title}".` : `Đã bật "${feed.title}".`);
  };

  const toggleCrawler = async (feed: ContentFeed) => {
    const next = !feed.crawler;
    setFeeds((prev) =>
      prev.map((f) => (f.id === feed.id ? { ...f, crawler: next } : f))
    );
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crawler: next }),
    });
    showToast(
      next
        ? `Đã bật lấy toàn văn cho "${feed.title}".`
        : `Đã tắt lấy toàn văn cho "${feed.title}".`
    );
  };

  const refreshFeed = async (feed: ContentFeed) => {
    await fetch(`/api/feeds/${feed.id}/refresh`, { method: "PUT" });
    showToast(`Đã yêu cầu quét lại "${feed.title}".`);
    setTimeout(() => void loadContent(), 1200);
  };

  const deleteFeed = async (feed: ContentFeed) => {
    if (!confirm(`Huỷ theo dõi "${feed.title}"?`)) return;
    const res = await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (res.ok) {
      setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
      selectedIds.delete(feed.id);
      setSelectedIds(new Set(selectedIds));
      showToast(`Đã huỷ theo dõi "${feed.title}".`);
    }
  };

  const bulkMoveFolder = async (catId: number) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/feeds/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_id: catId }),
        })
      )
    );
    setSelectedIds(new Set());
    showToast(`Đã chuyển ${ids.length} feed sang thư mục mới.`);
    await loadContent();
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Huỷ theo dõi ${ids.length} feed đã chọn?`)) return;
    await Promise.all(
      ids.map((id) => fetch(`/api/feeds/${id}`, { method: "DELETE" }))
    );
    setSelectedIds(new Set());
    showToast(`Đã huỷ theo dõi ${ids.length} feed.`);
    await loadContent();
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderTitle.trim()) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newFolderTitle.trim() }),
    });
    if (res.ok) {
      setNewFolderTitle("");
      showToast("Đã tạo thư mục mới.");
      await loadContent();
    } else {
      showToast("Không tạo được thư mục (có thể tên bị trùng).");
    }
  };

  const handleRenameFolder = async (cat: ContentCategory) => {
    const next = prompt("Tên thư mục mới:", cat.title);
    if (!next || next.trim() === cat.title) return;
    const res = await fetch(`/api/categories/${cat.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next.trim() }),
    });
    if (res.ok) {
      showToast("Đã đổi tên thư mục.");
      await loadContent();
    }
  };

  const handleDeleteFolder = async (cat: ContentCategory) => {
    if (!confirm(`${t("delete")} "${cat.title}"?`)) return;
    const res = await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
    if (res.ok) {
      showToast(t("toastTagUpdated"));
      await loadContent();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(data.error || t("toastErrMoveFeed"));
    }
  };

  const handleSaveTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newTagName.trim().replace(/^#+/, "");
    if (!clean) return;
    setSavingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean, color: newTagColor }),
      });
      if (!res.ok) throw new Error("err");
      setNewTagName("");
      showToast(t("toastTagUpdated"));
      await loadContent();
    } catch {
      showToast(t("toastTagErr"));
    } finally {
      setSavingTag(false);
    }
  };

  const handleChangeTagColor = async (tagName: string, color: TagColorKey) => {
    setTagsList((prev) =>
      prev.map((tg) => (tg.name === tagName ? { ...tg, color } : tg))
    );
    await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tagName, color }),
    });
    showToast(t("toastTagUpdated"));
  };

  const handleRenameTag = async (tagName: string) => {
    const next = prompt(t("renameTagPrompt"), tagName);
    const clean = (next || "").trim().replace(/^#+/, "");
    if (!clean || clean === tagName) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", oldName: tagName, newName: clean }),
    });
    if (res.ok) {
      showToast(t("toastTagUpdated"));
      await loadContent();
    } else {
      showToast(t("toastTagErr"));
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(t("confirmDeleteTag", { name: tagName }))) return;
    const res = await fetch(`/api/tags?name=${encodeURIComponent(tagName)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      showToast(t("toastTagUpdated"));
      await loadContent();
    } else {
      showToast(t("toastTagErr"));
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Thanh icon ngoài cùng bên trái */}
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
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Plus className="w-4 h-4" />
          </Link>
          <Link
            href="/manage"
            title={t("manageContent")}
            className="p-2 rounded-lg bg-green-600 text-white"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>

        <div className="flex flex-col items-center gap-2">
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

      {/* Vùng Content chính */}
      <main className="flex-1 overflow-y-auto px-4 md:px-10 py-6">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Header + Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex flex-wrap items-center gap-6">
              <h1 className="text-xl font-bold">Content &amp; {t("settings")}</h1>
              <div className="flex items-center gap-4 text-sm">
                <button
                  onClick={() => setActiveTab("feeds")}
                  className={`pb-1 border-b-2 transition-colors ${
                    activeTab === "feeds"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {t("tabFeeds")}
                </button>
                <button
                  onClick={() => setActiveTab("folders")}
                  className={`pb-1 border-b-2 transition-colors ${
                    activeTab === "folders"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {t("tabFolders")}
                </button>
                <button
                  onClick={() => setActiveTab("tags")}
                  className={`pb-1 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                    activeTab === "tags"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  {t("tabTags")}
                </button>
                <button
                  onClick={() => setActiveTab("settings")}
                  className={`pb-1 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                    activeTab === "settings"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  {t("tabSettings")}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <div
                title={t("settingsLanguageTitle")}
                className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-900"
              >
                {(
                  [
                    ["vi", "VI"],
                    ["en", "EN"],
                  ] as Array<[Locale, string]>
                ).map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLocale(code)}
                    className={`px-2 py-1 rounded-md font-medium transition-colors ${
                      locale === code
                        ? "bg-green-600 text-white"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Link
                href="/add"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("addSourceShort")}
              </Link>
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t("backToReader")}
              </Link>
            </div>
          </div>

          {activeTab === "feeds" ? (
            <div className="space-y-4">
              {/* Thẻ tóm tắt dung lượng & Clear cache / Dọn bài cũ */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm">
                        {t("postgresLabel")} {formatBytes(storageSummary?.db_bytes || 0)}
                      </div>
                      <div className="text-slate-500">
                        {t("activeEntriesAutoClean", {
                          count: storageSummary?.total_active_entries ?? 0,
                          days: storageSummary?.auto_cleanup_days ?? 180,
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="h-7 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm">
                        {t("redisCacheLabel")} {formatBytes(storageSummary?.redis_bytes || 0)}
                      </div>
                      <div className="text-slate-500">
                        {t("redisKeysSuffix", { count: storageSummary?.redis_keys ?? 0 })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => void handleClearCache()}
                    disabled={cleaning}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${cleaning ? "animate-spin" : ""}`} />
                    {t("clearCache")}
                  </button>
                  <button
                    onClick={() => {
                      setCleanupDays(180);
                      setCleanupIncludeUnread(false);
                      setCleanupModal({ label: t("allFeedsLabel") });
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    {t("cleanOldEntries")}
                  </button>
                </div>
              </div>

              {/* Thanh tìm kiếm */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchFeedsPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Bộ lọc */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="all">{t("allFoldersOpt")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.title}
                    </option>
                  ))}
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="all">{t("allFeedTypesOpt")}</option>
                  <option value="rss">Website / RSS</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X (Twitter)</option>
                  <option value="facebook">Facebook</option>
                  <option value="google">Google News / Alerts</option>
                  <option value="rsshub">RSSHub</option>
                </select>

                <select
                  value={limitCount}
                  onChange={(e) => setLimitCount(Number(e.target.value))}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value={50}>{t("showCountPrefix")} 50</option>
                  <option value={100}>{t("showCountPrefix")} 100</option>
                  <option value={200}>{t("showCountPrefix")} 200</option>
                  <option value={9999}>{t("all")}</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "size" | "entries" | "name")}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="size">{t("sortSize")}</option>
                  <option value="entries">{t("sortEntries")}</option>
                  <option value="name">{t("sortName")}</option>
                </select>

                <label className="inline-flex items-center gap-1.5 cursor-pointer px-2">
                  <input
                    type="checkbox"
                    checked={showUrls}
                    onChange={(e) => setShowUrls(e.target.checked)}
                  />
                  {t("showUrl")}
                </label>

                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 ml-auto">
                  {(
                    [
                      ["all", t("pillAll")],
                      ["deactivated", t("pillDisabled")],
                      ["filtered", t("pillFiltered")],
                      ["issues", t("pillIssues")],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setStatusPill(key)}
                      className={`px-2.5 py-1 rounded-md ${
                        statusPill === key
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold"
                          : "text-slate-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Thanh thao tác hàng loạt */}
              {selectedIds.size > 0 && (
                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">
                    {t("selectedFeedsCount", { count: selectedIds.size })}
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const cid = Number(e.target.value);
                        if (cid) void bulkMoveFolder(cid);
                        e.target.value = "";
                      }}
                      className="px-2.5 py-1 rounded-lg border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900"
                    >
                      <option value="" disabled>
                        {t("moveToFolderOpt")}
                      </option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setCleanupDays(90);
                        setCleanupIncludeUnread(false);
                        setCleanupModal({
                          feedIds: Array.from(selectedIds),
                          label: t("selectedFeedsCount", { count: selectedIds.size }),
                        });
                      }}
                      className="px-3 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 font-medium"
                    >
                      {t("cleanOldEntries")}
                    </button>
                    <button
                      onClick={() => void bulkDelete()}
                      className="px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
                    >
                      {t("unfollow")}
                    </button>
                  </div>
                </div>
              )}

              <div className="text-sm font-semibold">
                {t("totalFeedsCount", { count: filteredFeeds.length })}
              </div>

              {/* Bảng danh sách Feeds */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/80 dark:bg-slate-900/60">
                      <th className="p-3 w-8">
                        <input
                          type="checkbox"
                          checked={
                            filteredFeeds.length > 0 &&
                            filteredFeeds.every((f) => selectedIds.has(f.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredFeeds.map((f) => f.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                        />
                      </th>
                      <th className="p-3 w-16">{t("colEnabled")}</th>
                      <th className="p-3">{t("colFeed")}</th>
                      <th className="p-3 w-28">
                        <button
                          onClick={() =>
                            setSortBy((s) => (s === "size" ? "entries" : "size"))
                          }
                          className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
                        >
                          {t("colStorage")}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="p-3 w-28 hidden md:table-cell">{t("colReadRate")}</th>
                      <th className="p-3 w-20 hidden sm:table-cell">{t("colChecked")}</th>
                      <th className="p-3 w-20 hidden sm:table-cell">{t("colLastPost")}</th>
                      <th className="p-3 w-16 text-center">{t("colHealth")}</th>
                      <th className="p-3 w-44 text-right">{t("colActions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400 text-xs">
                          {t("loadingFeeds")}
                        </td>
                      </tr>
                    ) : filteredFeeds.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400 text-xs">
                          {t("noMatchingFeeds")}
                        </td>
                      </tr>
                    ) : (
                      filteredFeeds.map((feed) => {
                        const hasError = (feed.parsing_error_count || 0) > 0;
                        return (
                          <tr
                            key={feed.id}
                            className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                          >
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(feed.id)}
                                onChange={() => {
                                  const next = new Set(selectedIds);
                                  if (next.has(feed.id)) next.delete(feed.id);
                                  else next.add(feed.id);
                                  setSelectedIds(next);
                                }}
                              />
                            </td>

                            {/* Toggle Enabled */}
                            <td className="p-3">
                              <button
                                onClick={() => void toggleEnabled(feed)}
                                title={feed.disabled ? "Đang tắt - bấm để bật" : "Đang bật - bấm để tắt"}
                                className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                                  feed.disabled
                                    ? "bg-slate-300 dark:bg-slate-700 justify-start"
                                    : "bg-blue-600 justify-end"
                                }`}
                              >
                                <span className="w-4 h-4 rounded-full bg-white shadow" />
                              </button>
                            </td>

                            {/* Feed icon + Title + Folder + URL */}
                            <td className="p-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <FeedLogo feedId={feed.id} />
                                <div className="min-w-0">
                                  <div className="font-semibold truncate max-w-[260px] flex items-center gap-1.5">
                                    <span className="truncate">{feed.title}</span>
                                    {feed.is_filtered && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">
                                        {t("filterBadge")}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-slate-500">
                                    <Folder className="w-3 h-3" />
                                    <span>{feed.category?.title}</span>
                                  </div>
                                  {showUrls && (
                                    <div className="text-[11px] text-slate-400 truncate max-w-[300px] mt-0.5 font-mono">
                                      {feed.feed_url}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Dung lượng & số bài */}
                            <td className="p-3 text-xs">
                              <div className="font-semibold">
                                {formatBytes(feed.storage_bytes || 0)}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {feed.stored_entries ?? 0} {t("entriesSuffix")}
                                {(feed.starred_count || 0) > 0
                                  ? ` · ★${feed.starred_count}`
                                  : ""}
                              </div>
                            </td>

                            {/* Engagement */}
                            <td className="p-3 hidden md:table-cell">
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full bg-slate-600 dark:bg-slate-300"
                                    style={{ width: `${feed.engagement_pct}%` }}
                                  />
                                </div>
                                <span>{feed.engagement_pct}%</span>
                              </div>
                            </td>

                            {/* Update */}
                            <td className="p-3 text-xs text-slate-500 hidden sm:table-cell">
                              {formatShortTime(feed.checked_at)}
                            </td>

                            {/* Last post */}
                            <td className="p-3 text-xs text-slate-500 hidden sm:table-cell">
                              {formatShortTime(feed.last_post_at)}
                            </td>

                            {/* Health dot */}
                            <td className="p-3 text-center">
                              <span
                                title={
                                  feed.disabled
                                    ? "Đang tạm tắt"
                                    : hasError
                                      ? `${feed.parsing_error_count} lỗi: ${feed.parsing_error_message}`
                                      : "Hoạt động tốt"
                                }
                                className={`inline-block w-3 h-3 rounded-full ${
                                  feed.disabled
                                    ? "bg-slate-400"
                                    : hasError
                                      ? "bg-red-500"
                                      : "bg-lime-500"
                                }`}
                              />
                            </td>

                            {/* Action icons giống ảnh 2 */}
                            <td className="p-3">
                              <div className="flex items-center justify-end gap-1 text-slate-500">
                                <button
                                  onClick={() => void refreshFeed(feed)}
                                  title="Quét lại ngay"
                                  className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800"
                                >
                                  <Rocket className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() =>
                                    setModalState({ feed, tab: "properties" })
                                  }
                                  title="Thuộc tính & đổi tên feed"
                                  className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => void toggleCrawler(feed)}
                                  title={
                                    feed.crawler
                                      ? "Lấy toàn văn: ĐANG BẬT (bấm để tắt)"
                                      : "Lấy toàn văn: TẮT (bấm để bật)"
                                  }
                                  className={`p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 ${
                                    feed.crawler ? "text-green-600" : ""
                                  }`}
                                >
                                  <FileText className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setModalState({ feed, tab: "filter" })}
                                  title="Bộ lọc từ khoá (Filter feed)"
                                  className={`p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 ${
                                    feed.is_filtered ? "text-amber-600" : ""
                                  }`}
                                >
                                  <Filter className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setCleanupDays(30);
                                    setCleanupIncludeUnread(false);
                                    setCleanupModal({
                                      feedIds: [feed.id],
                                      label: feed.title,
                                    });
                                  }}
                                  title="Dọn bớt bài cũ của feed này"
                                  className="p-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-600"
                                >
                                  <Eraser className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => void deleteFeed(feed)}
                                  title="Huỷ theo dõi"
                                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === "folders" ? (
            /* Tab Folders */
            <div className="space-y-4">
              <form onSubmit={handleCreateFolder} className="flex gap-2 max-w-md">
                <input
                  type="text"
                  value={newFolderTitle}
                  onChange={(e) => setNewFolderTitle(e.target.value)}
                  placeholder={t("newFolderPlaceholder")}
                  required
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
                >
                  <FolderPlus className="w-4 h-4" />
                  {t("createFolderBtn")}
                </button>
              </form>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {categories.map((cat) => {
                  const feedCount = feeds.filter((f) => f.category?.id === cat.id).length;
                  return (
                    <div
                      key={cat.id}
                      className="p-3.5 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2.5">
                        <Folder className="w-4 h-4 text-slate-400" />
                        <span className="font-semibold">{cat.title}</span>
                        <span className="text-xs text-slate-500">
                          {t("folderStats", {
                            feeds: feedCount,
                            unread: cat.total_unread || 0,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void handleRenameFolder(cat)}
                          title={t("rename")}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void handleDeleteFolder(cat)}
                          title={t("delete")}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeTab === "tags" ? (
            /* Tab Tags (quản lý thủ công) */
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-1">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Tag className="w-4 h-4 text-green-600" />
                  {t("tagsIntroTitle")}
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t("tagsIntroDesc")}
                </p>
              </div>

              <form
                onSubmit={handleSaveTag}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
              >
                <div className="text-sm font-semibold">{t("createTagTitle")}</div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder={t("tagNamePlaceholder")}
                    required
                    className="flex-1 min-w-[220px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                  <div className="flex items-center gap-1.5">
                    {(Object.keys(TAG_COLORS) as TagColorKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setNewTagColor(key)}
                        title={
                          locale === "en"
                            ? TAG_COLORS[key].labelEn
                            : TAG_COLORS[key].labelVi
                        }
                        className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-transform ${
                          TAG_COLORS[key].dot
                        } ${
                          newTagColor === key
                            ? "border-slate-900 dark:border-white scale-110"
                            : "border-transparent opacity-75 hover:opacity-100"
                        }`}
                      >
                        {newTagColor === key && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={savingTag}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    {t("createTagBtn")}
                  </button>
                </div>
              </form>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {tagsList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    {t("noTagsYet")}
                  </div>
                ) : (
                  tagsList.map((tg) => {
                    const st = getTagStyle(tg.color);
                    return (
                      <div
                        key={tg.name}
                        className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium ${st.badge}`}
                          >
                            <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                            {tg.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            {t("tagStats", {
                              total: tg.total_count,
                              unread: tg.unread_count,
                            })}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1 mr-1">
                            {(Object.keys(TAG_COLORS) as TagColorKey[]).map((ck) => (
                              <button
                                key={ck}
                                type="button"
                                onClick={() => void handleChangeTagColor(tg.name, ck)}
                                className={`w-4 h-4 rounded-full ${TAG_COLORS[ck].dot} ${
                                  tg.color === ck
                                    ? "ring-2 ring-offset-1 ring-slate-700 dark:ring-white"
                                    : "opacity-50 hover:opacity-100"
                                }`}
                              />
                            ))}
                          </div>
                          <Link
                            href={`/?tag=${encodeURIComponent(tg.name)}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t("viewTagArticles")}
                          </Link>
                          <button
                            onClick={() => void handleRenameTag(tg.name)}
                            title={t("rename")}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void handleDeleteTag(tg.name)}
                            title={t("delete")}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Tab Settings (Ngôn ngữ Tiếng Việt / Tiếng Anh & Giao diện) */
            <div className="space-y-5 max-w-2xl">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Globe className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="font-semibold text-base">
                      {t("settingsLanguageTitle")}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("settingsLanguageDesc")}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setLocale("vi")}
                    className={`p-4 rounded-xl border text-left transition-all flex items-start justify-between gap-2 ${
                      locale === "vi"
                        ? "border-green-600 bg-green-50/70 dark:bg-green-950/40 ring-1 ring-green-600"
                        : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        <span>🇻🇳</span>
                        <span>{t("vietnamese")}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {t("langViDesc")}
                      </p>
                    </div>
                    {locale === "vi" && (
                      <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocale("en")}
                    className={`p-4 rounded-xl border text-left transition-all flex items-start justify-between gap-2 ${
                      locale === "en"
                        ? "border-green-600 bg-green-50/70 dark:bg-green-950/40 ring-1 ring-green-600"
                        : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        <span>🇬🇧</span>
                        <span>{t("english")}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {t("langEnDesc")}
                      </p>
                    </div>
                    {locale === "en" && (
                      <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <h2 className="font-semibold text-base">
                  {t("settingsAppearanceTitle")}
                </h2>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t("settingsThemeLabel")}
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setDarkMode(false);
                        localStorage.setItem("rss-theme", "light");
                        document.documentElement.classList.remove("dark");
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-md ${
                        !darkMode
                          ? "bg-slate-900 text-white font-medium"
                          : "text-slate-500"
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      {t("lightModeName")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDarkMode(true);
                        localStorage.setItem("rss-theme", "dark");
                        document.documentElement.classList.add("dark");
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-md ${
                        darkMode
                          ? "bg-slate-100 text-slate-900 font-medium"
                          : "text-slate-500"
                      }`}
                    >
                      <Moon className="w-3.5 h-3.5" />
                      {t("darkModeName")}
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-sm font-medium">
                    {t("settingsRetentionTitle")}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("settingsRetentionDesc", {
                      days: storageSummary?.auto_cleanup_days ?? 180,
                    })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {modalState && (
        <FeedPropertiesModal
          feed={modalState.feed}
          folders={categories}
          initialTab={modalState.tab}
          onClose={() => setModalState(null)}
          onSaved={(msg) => {
            showToast(msg);
            void loadContent();
          }}
        />
      )}

      {cleanupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCleanupModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">{t("cleanupModalTitle")}</h3>
              <button
                onClick={() => setCleanupModal(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {t("cleanupScopePrefix")}{" "}
              <strong className="text-slate-800 dark:text-slate-200">{cleanupModal.label}</strong>.{" "}
              {t("cleanupScopeNote")}
            </p>

            <form onSubmit={handleRunCleanup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  {t("cleanupOlderThan")}
                </label>
                <select
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value={180}>{t("cleanup180d")}</option>
                  <option value={90}>{t("cleanup90d")}</option>
                  <option value={30}>{t("cleanup30d")}</option>
                  <option value={7}>{t("cleanup7d")}</option>
                  <option value={0}>{t("cleanup0d")}</option>
                </select>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanupIncludeUnread}
                  onChange={(e) => setCleanupIncludeUnread(e.target.checked)}
                />
                {t("cleanupIncludeUnread")}
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setCleanupModal(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={cleaning}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {cleaning ? t("cleaning") : t("confirmCleanup")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
