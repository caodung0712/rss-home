import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { syncSocialMetricsForEntries } from "@/lib/social-metrics";

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      entry_ids?: number[];
      force?: boolean;
    };
    const entryIds = Array.isArray(body.entry_ids)
      ? body.entry_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 40)
      : [];
    if (entryIds.length === 0) {
      return NextResponse.json({ metrics: {} });
    }

    const p = getDbPool();
    if (!p) {
      return NextResponse.json({ metrics: {} });
    }

    const res = await p.query<{ id: string; url: string; feed_url: string }>(
      `SELECT e.id, e.url, f.feed_url
       FROM entries e
       JOIN feeds f ON f.id = e.feed_id
       WHERE e.id = ANY($1::bigint[])`,
      [entryIds]
    );

    const items = res.rows.map((r) => ({
      entry_id: Number(r.id),
      url: r.url,
      feed_url: r.feed_url,
    }));

    const metrics = await syncSocialMetricsForEntries(items, Boolean(body.force));
    return NextResponse.json({ metrics });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không đồng bộ được số tương tác." },
      { status: 500 }
    );
  }
}
