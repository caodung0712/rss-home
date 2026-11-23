import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch, type MinifluxFeed } from "@/lib/miniflux";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  let totalFeeds = 0;
  let brokenFeeds: Array<{
    id: number;
    title: string;
    folder: string;
    feed_url: string;
    error_count: number;
    error: string;
  }> = [];
  let xTotal = 0;
  let xBroken = 0;
  let xCookieExpired = false;
  let minifluxOk = true;
  let minifluxError: string | null = null;

  try {
    const feeds = await minifluxFetch<MinifluxFeed[]>("/v1/feeds");
    totalFeeds = feeds.length;
    const xFeeds = feeds.filter(
      (f) => f.feed_url.includes("/twitter/") || f.feed_url.includes("fxtwitter.com")
    );
    xTotal = xFeeds.length;
    xBroken = xFeeds.filter((f) => (f.parsing_error_count || 0) > 0).length;
    xCookieExpired = xTotal >= 1 && xBroken === xTotal;

    brokenFeeds = feeds
      .filter((f) => (f.parsing_error_count || 0) > 0 || f.disabled)
      .map((f) => ({
        id: f.id,
        title: f.title,
        folder: f.category?.title || "",
        feed_url: f.feed_url,
        error_count: f.parsing_error_count || 0,
        error: f.parsing_error_message || "",
      }));
  } catch (err) {
    minifluxOk = false;
    minifluxError = err instanceof Error ? err.message : "Không kết nối được Miniflux";
  }

  let apifyUsage: Record<string, unknown> = {
    configured: false,
    spend_usd: 0,
    budget_usd: 5,
    percent: 0,
    warning_over_80: false,
  };
  try {
    const bridgeUrl = (
      process.env.APIFY_BRIDGE_URL || "http://apify-bridge:8000"
    ).replace(/\/+$/, "");
    const res = await fetch(`${bridgeUrl}/usage`, { cache: "no-store" });
    if (res.ok) {
      apifyUsage = (await res.json()) as Record<string, unknown>;
    }
  } catch {
    apifyUsage = {
      configured: false,
      error: "Không kết nối được apify-bridge",
    };
  }

  let latestBackup: { file: string; modified_at: string; size_bytes: number } | null = null;
  const backupDir = process.env.BACKUP_MOUNT_DIR || "/backups";
  try {
    if (fs.existsSync(backupDir)) {
      const files = fs
        .readdirSync(backupDir)
        .filter((name) => name.endsWith(".sql.gz") || name.endsWith(".sql"))
        .map((name) => {
          const full = path.join(backupDir, name);
          const stat = fs.statSync(full);
          return {
            file: name,
            mtimeMs: stat.mtimeMs,
            modified_at: stat.mtime.toISOString(),
            size_bytes: stat.size,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (files.length > 0) {
        const top = files[0];
        latestBackup = {
          file: top.file,
          modified_at: top.modified_at,
          size_bytes: top.size_bytes,
        };
      }
    }
  } catch {
    latestBackup = null;
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    miniflux_ok: minifluxOk,
    miniflux_error: minifluxError,
    total_feeds: totalFeeds,
    healthy_feeds: Math.max(0, totalFeeds - brokenFeeds.length),
    broken_feeds: brokenFeeds,
    x_status: {
      total: xTotal,
      broken: xBroken,
      cookie_expired: xCookieExpired,
    },
    apify_usage: apifyUsage,
    latest_backup: latestBackup,
  });
}
