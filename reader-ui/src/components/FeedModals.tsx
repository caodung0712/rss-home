"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface EditableFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  crawler?: boolean;
  disabled?: boolean;
  blocklist_rules?: string;
  keeplist_rules?: string;
  parsing_error_count?: number;
  parsing_error_message?: string;
  category: { id: number; title: string };
}

export interface FolderOption {
  id: number;
  title: string;
}

export function FeedPropertiesModal({
  feed,
  folders,
  initialTab = "properties",
  onClose,
  onSaved,
}: {
  feed: EditableFeed;
  folders: FolderOption[];
  initialTab?: "properties" | "filter";
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"properties" | "filter">(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [title, setTitle] = useState(feed.title);
  const [categoryId, setCategoryId] = useState(feed.category?.id || 0);
  const [feedUrl, setFeedUrl] = useState(feed.feed_url);
  const [siteUrl, setSiteUrl] = useState(feed.site_url);
  const [crawler, setCrawler] = useState(Boolean(feed.crawler));
  const [disabled, setDisabled] = useState(Boolean(feed.disabled));
  const [keeplist, setKeeplist] = useState(feed.keeplist_rules || "");
  const [blocklist, setBlocklist] = useState(feed.blocklist_rules || "");
  const [errorCount, setErrorCount] = useState(feed.parsing_error_count || 0);
  const [errorMsg, setErrorMsg] = useState(feed.parsing_error_message || "");

  useEffect(() => {
    let active = true;
    fetch(`/api/feeds/${feed.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((full: EditableFeed | null) => {
        if (!active || !full) return;
        setTitle(full.title || "");
        setCategoryId(full.category?.id || feed.category?.id || 0);
        setFeedUrl(full.feed_url || "");
        setSiteUrl(full.site_url || "");
        setCrawler(Boolean(full.crawler));
        setDisabled(Boolean(full.disabled));
        setKeeplist(full.keeplist_rules || "");
        setBlocklist(full.blocklist_rules || "");
        setErrorCount(full.parsing_error_count || 0);
        setErrorMsg(full.parsing_error_message || "");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [feed.id, feed.category?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/feeds/${feed.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category_id: categoryId,
          feed_url: feedUrl.trim(),
          site_url: siteUrl.trim(),
          crawler,
          disabled,
          keeplist_rules: keeplist,
          blocklist_rules: blocklist,
        }),
      });
      if (!res.ok) throw new Error("err");
      onSaved(t("modalSavedFeed"));
      onClose();
    } catch {
      onSaved(t("modalSaveFeedErr"));
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshNow = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/feeds/${feed.id}/refresh`, { method: "PUT" });
      onSaved(t("modalRescanSent", { title }));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-base truncate max-w-[260px]">
              {feed.title}
            </h3>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTab("properties")}
                className={`px-2.5 py-1 rounded-md ${
                  tab === "properties"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                    : ""
                }`}
              >
                {t("modalProperties")}
              </button>
              <button
                type="button"
                onClick={() => setTab("filter")}
                className={`px-2.5 py-1 rounded-md ${
                  tab === "filter"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                    : ""
                }`}
              >
                {t("modalFilter")}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4 text-sm">
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400">
              {t("modalLoading")}
            </div>
          ) : tab === "properties" ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalDisplayName")}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalFolder")}
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalFeedUrl")}
                </label>
                <input
                  type="url"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalSiteUrl")}
                </label>
                <input
                  type="text"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={crawler}
                    onChange={(e) => setCrawler(e.target.checked)}
                  />
                  {t("modalCrawler")}
                </label>
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!disabled}
                    onChange={(e) => setDisabled(!e.target.checked)}
                  />
                  {t("modalEnabled")}
                </label>
              </div>

              {errorCount > 0 && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  <strong>{t("modalErrorsCount", { count: errorCount })}</strong>{" "}
                  {errorMsg || t("modalUnknownErr")}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">{t("modalFilterDesc")}</p>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalKeeplist")}
                </label>
                <textarea
                  rows={3}
                  value={keeplist}
                  onChange={(e) => setKeeplist(e.target.value)}
                  placeholder="(?i)(bitcoin|ethereum|ai agent)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("modalBlocklist")}
                </label>
                <textarea
                  rows={3}
                  value={blocklist}
                  onChange={(e) => setBlocklist(e.target.value)}
                  placeholder="(?i)(sponsored|advertisement)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>
            </>
          )}

          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => void handleRefreshNow()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {t("modalRescanNow")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving ? t("saving") : t("saveChanges")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
