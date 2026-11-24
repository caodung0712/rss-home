import type { Pool } from "pg";
import { getDbPool } from "./db";

export interface SocialMetrics {
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  updated_at: string;
}

const METRICS_TTL_MS = 2 * 60 * 60 * 1000; // 2 giờ
let metricsSchemaPromise: Promise<void> | null = null;

function getBridgeBaseUrl(): string {
  return (process.env.APIFY_BRIDGE_URL || "http://apify-bridge:8000").replace(
    /\/+$/,
    ""
  );
}

export function isSupportedSocialUrl(url: string, feedUrl = ""): boolean {
  const combined = `${url} ${feedUrl}`.toLowerCase();
  if (
    combined.includes("facebook.com") ||
    combined.includes("fb.watch") ||
    combined.includes("/facebook")
  ) {
    return false;
  }
  const u = (url || "").toLowerCase();
  const f = (feedUrl || "").toLowerCase();
  if (u.includes("tiktok.com") || f.includes("/tiktok/")) return true;
  if (u.includes("youtube.com") || u.includes("youtu.be/") || f.includes("youtube.com/feeds/")) {
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

export async function ensureSocialMetricsSchema(poolArg?: Pool | null): Promise<Pool | null> {
  const p = poolArg ?? getDbPool();
  if (!p) return null;

  if (!metricsSchemaPromise) {
    metricsSchemaPromise = (async () => {
      await p.query(`
        CREATE TABLE IF NOT EXISTS entry_social_metrics (
          entry_id BIGINT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
          platform TEXT NOT NULL,
          views BIGINT,
          likes BIGINT,
          comments BIGINT,
          shares BIGINT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((err) => {
      metricsSchemaPromise = null;
      throw err;
    });
  }

  await metricsSchemaPromise;
  return p;
}

function toNullableNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getStoredSocialMetrics(
  entryIds: number[]
): Promise<Record<number, SocialMetrics>> {
  const cleanIds = Array.from(
    new Set(entryIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (cleanIds.length === 0) return {};

  const p = await ensureSocialMetricsSchema();
  if (!p) return {};

  const res = await p.query<{
    entry_id: string;
    platform: string;
    views: string | null;
    likes: string | null;
    comments: string | null;
    shares: string | null;
    updated_at: Date;
  }>(
    `SELECT entry_id, platform, views, likes, comments, shares, updated_at
     FROM entry_social_metrics
     WHERE entry_id = ANY($1::bigint[])`,
    [cleanIds]
  );

  const out: Record<number, SocialMetrics> = {};
  for (const row of res.rows) {
    out[Number(row.entry_id)] = {
      platform: row.platform,
      views: toNullableNum(row.views),
      likes: toNullableNum(row.likes),
      comments: toNullableNum(row.comments),
      shares: toNullableNum(row.shares),
      updated_at: row.updated_at.toISOString(),
    };
  }
  return out;
}

export async function upsertSocialMetrics(
  rows: Array<{
    entry_id: number;
    platform: string;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
  }>
): Promise<void> {
  if (rows.length === 0) return;
  const p = await ensureSocialMetricsSchema();
  if (!p) return;

  for (const row of rows) {
    if (!Number.isFinite(row.entry_id) || row.entry_id <= 0) continue;
    await p.query(
      `INSERT INTO entry_social_metrics (entry_id, platform, views, likes, comments, shares, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (entry_id) DO UPDATE SET
         platform = EXCLUDED.platform,
         views = COALESCE(EXCLUDED.views, entry_social_metrics.views),
         likes = COALESCE(EXCLUDED.likes, entry_social_metrics.likes),
         comments = COALESCE(EXCLUDED.comments, entry_social_metrics.comments),
         shares = COALESCE(EXCLUDED.shares, entry_social_metrics.shares),
         updated_at = NOW()`,
      [
        row.entry_id,
        row.platform,
        toNullableNum(row.views),
        toNullableNum(row.likes),
        toNullableNum(row.comments),
        toNullableNum(row.shares),
      ]
    );
  }
}

export async function syncSocialMetricsForEntries(
  items: Array<{ entry_id: number; url: string; feed_url?: string }>,
  force = false
): Promise<Record<number, SocialMetrics>> {
  const supported = items
    .filter(
      (it) =>
        Number.isFinite(it.entry_id) &&
        it.entry_id > 0 &&
        it.url &&
        isSupportedSocialUrl(it.url, it.feed_url || "")
    )
    .slice(0, 40);

  if (supported.length === 0) return {};

  const existing = await getStoredSocialMetrics(supported.map((i) => i.entry_id));
  const now = Date.now();

  const stale = force
    ? supported
    : supported.filter((it) => {
        const cur = existing[it.entry_id];
        if (!cur) return true;
        const ts = Date.parse(cur.updated_at);
        return Number.isNaN(ts) || now - ts > METRICS_TTL_MS;
      });

  if (stale.length === 0) {
    return existing;
  }

  try {
    const res = await fetch(`${getBridgeBaseUrl()}/social/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: stale, force }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      return existing;
    }
    const data = (await res.json()) as {
      metrics?: Record<
        string,
        {
          platform: string;
          views?: number | null;
          likes?: number | null;
          comments?: number | null;
          shares?: number | null;
        }
      >;
    };
    const fetched = data.metrics || {};
    const toUpsert: Array<{
      entry_id: number;
      platform: string;
      views?: number | null;
      likes?: number | null;
      comments?: number | null;
      shares?: number | null;
    }> = [];
    const nowIso = new Date().toISOString();

    for (const [idStr, m] of Object.entries(fetched)) {
      const entryId = Number(idStr);
      if (!Number.isFinite(entryId) || !m?.platform) continue;
      toUpsert.push({
        entry_id: entryId,
        platform: m.platform,
        views: m.views ?? null,
        likes: m.likes ?? null,
        comments: m.comments ?? null,
        shares: m.shares ?? null,
      });
      existing[entryId] = {
        platform: m.platform,
        views: toNullableNum(m.views),
        likes: toNullableNum(m.likes),
        comments: toNullableNum(m.comments),
        shares: toNullableNum(m.shares),
        updated_at: nowIso,
      };
    }

    await upsertSocialMetrics(toUpsert);
  } catch {
    // Giữ số liệu cũ nếu apify-bridge hoặc mạng tạm chậm
  }

  return existing;
}
