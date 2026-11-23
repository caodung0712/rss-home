"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bookmark,
  Edit2,
  FileText,
  Filter,
  Folder,
  FolderPlus,
  Home,
  Moon,
  Plus,
  RefreshCw,
  Rocket,
  Rss,
  Search,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
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
  engagement_pct: number;
  last_post_at: string | null;
  is_filtered: boolean;
}

interface ContentCategory extends FolderOption {
  feed_count?: number;
  total_unread?: number;
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
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"feeds" | "folders">("feeds");
  const [loading, setLoading] = useState(true);

  const [feeds, setFeeds] = useState<ContentFeed[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);

  // Bộ lọc bảng Feeds (giống ảnh 2)
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [limitCount, setLimitCount] = useState<number>(100);
  const [showUrls, setShowUrls] = useState(false);
  const [statusPill, setStatusPill] = useState<
    "all" | "deactivated" | "filtered" | "issues"
  >("all");

  // Chọn nhiều
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Modal thuộc tính / lọc feed
  const [modalState, setModalState] = useState<{
    feed: ContentFeed;
    tab: "properties" | "filter";
  } | null>(null);

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
      const res = await fetch("/api/content", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        categories: ContentCategory[];
        feeds: ContentFeed[];
      };
      setCategories(data.categories || []);
      setFeeds(data.feeds || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const filteredFeeds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return feeds
      .filter((f) => {
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
      })
      .slice(0, limitCount);
  }, [feeds, search, folderFilter, typeFilter, statusPill, limitCount]);

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
    if (!confirm(`Xoá thư mục "${cat.title}"?`)) return;
    const res = await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
    if (res.ok) {
      showToast(`Đã xoá thư mục "${cat.title}".`);
      await loadContent();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(data.error || "Không xoá được thư mục (hãy chuyển hết feed ra trước).");
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Thanh icon ngoài cùng bên trái */}
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
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <Plus className="w-4 h-4" />
          </Link>
          <Link
            href="/manage"
            title="Quản lý nội dung (Content)"
            className="p-2 rounded-lg bg-green-600 text-white"
          >
            <Settings className="w-4 h-4" />
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

      {/* Vùng Content chính */}
      <main className="flex-1 overflow-y-auto px-4 md:px-10 py-6">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Header + Tabs (giống mục Content trong ảnh 2) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-bold">Content</h1>
              <div className="flex items-center gap-4 text-sm">
                <button
                  onClick={() => setActiveTab("feeds")}
                  className={`pb-1 border-b-2 transition-colors ${
                    activeTab === "feeds"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Feeds
                </button>
                <button
                  onClick={() => setActiveTab("folders")}
                  className={`pb-1 border-b-2 transition-colors ${
                    activeTab === "folders"
                      ? "border-blue-600 text-blue-600 font-semibold"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Folders
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Link
                href="/add"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Thêm nguồn
              </Link>
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Về đọc tin
              </Link>
            </div>
          </div>

          {activeTab === "feeds" ? (
            <div className="space-y-4">
              {/* Thanh tìm kiếm */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm trong danh sách feeds..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Bộ lọc giống ảnh 2 */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="all">Tất cả thư mục</option>
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
                  <option value="all">Tất cả loại feed</option>
                  <option value="rss">Website / RSS</option>
                  <option value="youtube">YouTube</option>
                  <option value="x">X (Twitter)</option>
                  <option value="facebook">Facebook</option>
                  <option value="google">Google News / Alerts</option>
                  <option value="rsshub">RSSHub khác</option>
                </select>

                <select
                  value={limitCount}
                  onChange={(e) => setLimitCount(Number(e.target.value))}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value={50}>Hiện: 50</option>
                  <option value={100}>Hiện: 100</option>
                  <option value={200}>Hiện: 200</option>
                  <option value={9999}>Tất cả</option>
                </select>

                <label className="inline-flex items-center gap-1.5 cursor-pointer px-2">
                  <input
                    type="checkbox"
                    checked={showUrls}
                    onChange={(e) => setShowUrls(e.target.checked)}
                  />
                  Hiện URL
                </label>

                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 ml-auto">
                  {(
                    [
                      ["all", "Tất cả"],
                      ["deactivated", "Đang tắt"],
                      ["filtered", "Có lọc"],
                      ["issues", "Đang lỗi"],
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

              {/* Thanh thao tác hàng loạt khi chọn checkbox */}
              {selectedIds.size > 0 && (
                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">
                    Đã chọn {selectedIds.size} feed
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
                        Chuyển vào thư mục...
                      </option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void bulkDelete()}
                      className="px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
                    >
                      Huỷ theo dõi
                    </button>
                  </div>
                </div>
              )}

              <div className="text-sm font-semibold">
                Tổng cộng: {filteredFeeds.length} feeds
              </div>

              {/* Bảng danh sách Feeds giống ảnh 2 */}
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
                      <th className="p-3 w-16">Bật</th>
                      <th className="p-3">Feed</th>
                      <th className="p-3 w-32 hidden md:table-cell">Tỷ lệ đọc</th>
                      <th className="p-3 w-24 hidden sm:table-cell">Quét</th>
                      <th className="p-3 w-24 hidden sm:table-cell">Bài mới</th>
                      <th className="p-3 w-16 text-center">Tình trạng</th>
                      <th className="p-3 w-40 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 text-xs">
                          Đang tải danh sách feeds...
                        </td>
                      </tr>
                    ) : filteredFeeds.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 text-xs">
                          Không có feed nào khớp điều kiện.
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
                                        Lọc
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
          ) : (
            /* Tab Folders */
            <div className="space-y-4">
              <form onSubmit={handleCreateFolder} className="flex gap-2 max-w-md">
                <input
                  type="text"
                  value={newFolderTitle}
                  onChange={(e) => setNewFolderTitle(e.target.value)}
                  placeholder="Tên thư mục mới..."
                  required
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
                >
                  <FolderPlus className="w-4 h-4" />
                  Tạo thư mục
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
                          ({feedCount} feeds · {cat.total_unread || 0} chưa đọc)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void handleRenameFolder(cat)}
                          title="Đổi tên thư mục"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void handleDeleteFolder(cat)}
                          title="Xoá thư mục"
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

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
