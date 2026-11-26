import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { extractExcerpt, extractThumbnail } from "@/lib/html-utils";
import type { MinifluxEnclosure, MinifluxEntry } from "@/lib/miniflux";
import {
  ensureSocialMetricsSchema,
  isSupportedSocialUrl,
  syncSocialMetricsForEntries,
} from "@/lib/social-metrics";

export const dynamic = "force-dynamic";

interface HotRow {
  id: string;
  feed_id: string;
  status: "unread" | "read" | "removed";
  title: string;
  url: string;
  published_at: Date;
  author: string | null;
  starred: boolean;
  reading_time: number | null;
  tags: string[] | null;
  content: string | null;
  feed_title: string;
  feed_site_url: string | null;
  category_id: number | null;
  category_title: string | null;
  platform: string;
  views: string;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  metrics_updated_at: Date;
  enclosures: Array<{ url: string; mime_type: string; size?: number }> | null;
}

function getWindowHours(raw: string | null): number {
  return raw === "week" ? 24 * 7 : 24;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const windowHours = getWindowHours(sp.get("window"));
  const status = sp.get("status");
  const search = (sp.get("search") || "").trim();
  const afterSec = Number(sp.get("after"));
  const beforeSec = Number(sp.get("before"));
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const offset = Math.max(0, Number(sp.get("offset") || "0") || 0);

  try {
    const p = await ensureSocialMetricsSchema();
    if (!p) {
      return NextResponse.json({ total: 0, entries: [] });
    }

    const conditions: string[] = [
      "e.status <> 'removed'",
      "f.hide_globally = false",
      "m.views IS NOT NULL",
      "m.views > 0",
      `e.published_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
    ];
    const params: unknown[] = [windowHours];

    if (status === "unread" || status === "read") {
      params.push(status);
      conditions.push(`e.status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(e.title ILIKE $${params.length} OR e.content ILIKE $${params.length})`);
    }

    if (Number.isFinite(afterSec) && afterSec > 0) {
      params.push(afterSec);
      conditions.push(`e.published_at >= to_timestamp($${params.length})`);
    }

    if (Number.isFinite(beforeSec) && beforeSec > 0) {
      params.push(beforeSec);
      conditions.push(`e.published_at <= to_timestamp($${params.length})`);
    }

    const whereClause = conditions.join(" AND ");

    const countRes = await p.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM entries e
       JOIN feeds f ON f.id = e.feed_id
       JOIN entry_social_metrics m ON m.entry_id = e.id
       WHERE ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.cnt || 0);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rowsRes = await p.query<HotRow>(
      `SELECT
         e.id::text,
         e.feed_id::text,
         e.status::text AS status,
         e.title,
         e.url,
         e.published_at,
         e.author,
         e.starred,
         e.reading_time,
         e.tags,
         e.content,
         f.title AS feed_title,
         f.site_url AS feed_site_url,
         c.id AS category_id,
         c.title AS category_title,
         m.platform,
         m.views::text,
         m.likes::text,
         m.comments::text,
         m.shares::text,
         m.updated_at AS metrics_updated_at,
         COALESCE(
           (
             SELECT json_agg(json_build_object('url', enc.url, 'mime_type', enc.mime_type, 'size', enc.size))
             FROM enclosures enc
             WHERE enc.entry_id = e.id
           ),
           '[]'::json
         ) AS enclosures
       FROM entries e
       JOIN feeds f ON f.id = e.feed_id
       LEFT JOIN categories c ON c.id = f.category_id
       JOIN entry_social_metrics m ON m.entry_id = e.id
       WHERE ${whereClause}
       ORDER BY m.views DESC, e.published_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );

    const items = rowsRes.rows.map((row) => {
      const enclosures = Array.isArray(row.enclosures)
        ? (row.enclosures as unknown as MinifluxEnclosure[])
        : [];
      const thumb = extractThumbnail({
        content: row.content || "",
        enclosures,
      } as MinifluxEntry);

      return {
        id: Number(row.id),
        feed_id: Number(row.feed_id),
        status: row.status,
        title: row.title,
        url: row.url,
        published_at: row.published_at.toISOString(),
        author: row.author || "",
        starred: Boolean(row.starred),
        reading_time: Number(row.reading_time || 0),
        tags: Array.isArray(row.tags) ? row.tags : [],
        social_metrics: {
          platform: row.platform,
          views: Number(row.views),
          likes: row.likes !== null ? Number(row.likes) : null,
          comments: row.comments !== null ? Number(row.comments) : null,
          shares: row.shares !== null ? Number(row.shares) : null,
          updated_at: row.metrics_updated_at.toISOString(),
        },
        feed: {
          id: Number(row.feed_id),
          title: row.feed_title,
          site_url: row.feed_site_url || "",
          category:
            row.category_id && row.category_title
              ? { id: row.category_id, title: row.category_title }
              : null,
        },
        thumbnail: thumb ? `/api/image-proxy?url=${encodeURIComponent(thumb)}` : null,
        excerpt: extractExcerpt(row.content || "", 200),
      };
    });

    return NextResponse.json({ total, entries: items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi tải Hot News." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      window?: "day" | "week";
      force?: boolean;
    };
    const windowHours = getWindowHours(body.window || "day");
    const force = Boolean(body.force);
    const p = getDbPool();
    if (!p) {
      return NextResponse.json({ synced: 0 });
    }
    await ensureSocialMetricsSchema(p);

    const res = await p.query<{ id: string; url: string; feed_url: string }>(
      `SELECT e.id::text, e.url, f.feed_url
       FROM entries e
       JOIN feeds f ON f.id = e.feed_id
       LEFT JOIN entry_social_metrics m ON m.entry_id = e.id
       WHERE e.status <> 'removed'
         AND f.hide_globally = false
         AND e.published_at >= NOW() - ($1::int * INTERVAL '1 hour')
         AND ($2::boolean = true OR m.entry_id IS NULL OR m.updated_at < NOW() - INTERVAL '2 hours')
       ORDER BY e.published_at DESC
       LIMIT 60`,
      [windowHours, force]
    );

    const candidates = res.rows
      .map((r) => ({
        entry_id: Number(r.id),
        url: r.url,
        feed_url: r.feed_url,
      }))
      .filter((it) => isSupportedSocialUrl(it.url, it.feed_url))
      .slice(0, 30);

    if (candidates.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    const syncedMap = await syncSocialMetricsForEntries(candidates, force);
    return NextResponse.json({ synced: Object.keys(syncedMap).length });
  } catch {
    return NextResponse.json({ synced: 0 });
  }
}
