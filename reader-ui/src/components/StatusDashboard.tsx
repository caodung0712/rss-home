"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  DollarSign,
  RefreshCw,
  Twitter,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface StatusPayload {
  checked_at: string;
  miniflux_ok: boolean;
  miniflux_error: string | null;
  total_feeds: number;
  healthy_feeds: number;
  broken_feeds: Array<{
    id: number;
    title: string;
    folder: string;
    feed_url: string;
    error_count: number;
    error: string;
  }>;
  x_status: {
    total: number;
    broken: number;
    cookie_expired: boolean;
  };
  apify_usage: {
    configured?: boolean;
    spend_usd?: number;
    budget_usd?: number;
    percent?: number;
    warning_over_80?: boolean;
    message?: string;
    error?: string;
  };
  latest_backup: {
    file: string;
    modified_at: string;
    size_bytes: number;
  } | null;
}

export default function StatusDashboard() {
  const { locale, t } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "vi-VN";
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as StatusPayload);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const usage = data?.apify_usage || {};
  const spend = Number(usage.spend_usd || 0);
  const budget = Number(usage.budget_usd || 5);
  const percent = Math.min(100, Number(usage.percent || 0));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
              {t("statusBackBtn")}
            </Link>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-600" />
              {t("statusTitle")}
            </h1>
          </div>

          <button
            onClick={() => void loadStatus()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {t("statusRecheck")}
          </button>
        </div>

        {!data && loading ? (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
            {t("statusLoading")}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Miniflux */}
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-500">
                    {t("statusMinifluxFeeds")}
                  </span>
                  {data.miniflux_ok && data.broken_feeds.length === 0 ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  )}
                </div>
                <div className="text-2xl font-bold">
                  {data.healthy_feeds}/{data.total_feeds}
                </div>
                <p className="text-xs text-slate-500">
                  {data.miniflux_ok
                    ? t("statusBrokenCount", { count: data.broken_feeds.length })
                    : data.miniflux_error || t("statusMinifluxLost")}
                </p>
              </div>

              {/* X / Twitter Cookie */}
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-500">
                    {t("statusXCookie")}
                  </span>
                  <Twitter
                    className={`w-5 h-5 ${
                      data.x_status.cookie_expired ? "text-red-500" : "text-sky-500"
                    }`}
                  />
                </div>
                <div className="text-2xl font-bold">
                  {data.x_status.total === 0
                    ? t("statusXNone")
                    : data.x_status.cookie_expired
                      ? t("statusXExpired")
                      : t("statusXOk")}
                </div>
                <p className="text-xs text-slate-500">
                  {data.x_status.total === 0
                    ? t("statusXEmpty")
                    : t("statusXSummary", {
                        broken: data.x_status.broken,
                        total: data.x_status.total,
                      })}
                </p>
              </div>

              {/* Sao lưu */}
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-500">
                    {t("statusBackupTitle")}
                  </span>
                  <Database className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="text-base font-semibold truncate">
                  {data.latest_backup
                    ? new Date(data.latest_backup.modified_at).toLocaleString(dateLocale)
                    : t("statusBackupNone")}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {data.latest_backup
                    ? `${data.latest_backup.file} (${(data.latest_backup.size_bytes / 1024).toFixed(1)} KB)`
                    : t("statusBackupHint")}
                </p>
              </div>
            </div>

            {/* Chi phí Apify */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  {t("statusApifyTitle")}
                </h2>
                <span className="text-sm font-medium">
                  ${spend.toFixed(2)} / ${budget.toFixed(2)} ({Number(usage.percent || 0).toFixed(1)}%)
                </span>
              </div>

              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usage.warning_over_80 ? "bg-red-500" : "bg-green-600"
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {usage.warning_over_80 && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {t("statusApifyWarn")}
                </p>
              )}
              {!usage.configured && (
                <p className="text-xs text-slate-500">
                  {usage.message || t("statusApifyMissing")}
                </p>
              )}
              {usage.error && (
                <p className="text-xs text-amber-600">{usage.error}</p>
              )}
            </div>

            {/* Danh sách feed lỗi */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h2 className="font-semibold">
                  {t("statusBrokenSection", { count: data.broken_feeds.length })}
                </h2>
                <span className="text-xs text-slate-500">
                  {t("statusUpdatedAt")}{" "}
                  {new Date(data.checked_at).toLocaleTimeString(dateLocale)}
                </span>
              </div>

              {data.broken_feeds.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 text-center">
                  {t("statusAllHealthy")}
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.broken_feeds.map((f) => (
                    <div key={f.id} className="p-4 space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          [{f.folder || "General"}] {f.title}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          {t("statusErrorBadge", { count: f.error_count })}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">{f.feed_url}</div>
                      {f.error && (
                        <div className="text-xs text-red-600 dark:text-red-400">
                          {f.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
