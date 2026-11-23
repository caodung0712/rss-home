import type { Pool } from "pg";
import { getDbPool } from "./db";
import {
  TAG_COLORS,
  getTagStyle,
  normalizeTagColor,
  type TagColorKey,
} from "./tag-colors";

export { TAG_COLORS, getTagStyle, normalizeTagColor, type TagColorKey };

export interface TagSummary {
  name: string;
  color: TagColorKey;
  total_count: number;
  unread_count: number;
}

export function normalizeTagName(raw: string): string {
  return (raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

let schemaReadyPromise: Promise<void> | null = null;

/**
 * Ensures lightweight Postgres catalog table for custom tag colors + GIN index on entries.tags.
 */
export async function ensureTagsSchema(poolArg?: Pool | null): Promise<Pool> {
  const p = poolArg ?? getDbPool();
  if (!p) {
    throw new Error("Thiếu DATABASE_URL để sử dụng tính năng Tags.");
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await p.query(`
        CREATE INDEX IF NOT EXISTS entries_tags_gin_idx ON entries USING gin (tags);

        CREATE TABLE IF NOT EXISTS rss_tags (
          name TEXT PRIMARY KEY,
          color TEXT NOT NULL DEFAULT 'emerald',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }

  await schemaReadyPromise;
  return p;
}

export async function listTagsSummary(): Promise<TagSummary[]> {
  const p = await ensureTagsSchema();
  const res = await p.query<{
    name: string;
    color: string;
    total_count: string;
    unread_count: string;
  }>(`
    WITH entry_tag_counts AS (
      SELECT
        t.tag AS name,
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE e.status = 'unread')::bigint AS unread_count
      FROM entries e
      CROSS JOIN LATERAL unnest(e.tags) AS t(tag)
      WHERE e.status <> 'removed' AND BTRIM(t.tag) <> ''
      GROUP BY t.tag
    ),
    all_names AS (
      SELECT name FROM rss_tags
      UNION
      SELECT name FROM entry_tag_counts
    )
    SELECT
      a.name,
      COALESCE(rt.color, 'emerald') AS color,
      COALESCE(etc.total_count, 0)::text AS total_count,
      COALESCE(etc.unread_count, 0)::text AS unread_count
    FROM all_names a
    LEFT JOIN rss_tags rt ON rt.name = a.name
    LEFT JOIN entry_tag_counts etc ON etc.name = a.name
    ORDER BY COALESCE(etc.unread_count, 0) DESC, COALESCE(etc.total_count, 0) DESC, a.name ASC
  `);

  return res.rows.map((r) => ({
    name: r.name,
    color: normalizeTagColor(r.color),
    total_count: Number(r.total_count || 0),
    unread_count: Number(r.unread_count || 0),
  }));
}

export async function upsertTagDefinition(
  rawName: string,
  color?: string | null
): Promise<{ name: string; color: TagColorKey }> {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error("Tên tag không hợp lệ.");
  const p = await ensureTagsSchema();
  const normColor = normalizeTagColor(color);
  await p.query(
    `INSERT INTO rss_tags (name, color)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET color = COALESCE($3, rss_tags.color)`,
    [name, normColor, color ? normColor : null]
  );
  return { name, color: normColor };
}

export async function renameTagEverywhere(
  rawOld: string,
  rawNew: string
): Promise<{ oldName: string; newName: string }> {
  const oldName = normalizeTagName(rawOld);
  const newName = normalizeTagName(rawNew);
  if (!oldName || !newName) throw new Error("Tên tag không hợp lệ.");
  if (oldName === newName) return { oldName, newName };

  const p = await ensureTagsSchema();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ color: string }>(
      "SELECT color FROM rss_tags WHERE name = $1",
      [oldName]
    );
    const color = existing.rows[0]?.color || "emerald";
    await client.query(
      `INSERT INTO rss_tags (name, color) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [newName, color]
    );
    await client.query("DELETE FROM rss_tags WHERE name = $1", [oldName]);
    await client.query(
      `UPDATE entries
       SET tags = (
         SELECT ARRAY(
           SELECT DISTINCT CASE WHEN x = $1 THEN $2 ELSE x END
           FROM unnest(tags) AS t(x)
           WHERE BTRIM(x) <> ''
         )
       ),
       changed_at = NOW()
       WHERE status <> 'removed' AND $1 = ANY(tags)`,
      [oldName, newName]
    );
    await client.query("COMMIT");
    return { oldName, newName };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteTagEverywhere(rawName: string): Promise<void> {
  const name = normalizeTagName(rawName);
  if (!name) return;
  const p = await ensureTagsSchema();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM rss_tags WHERE name = $1", [name]);
    await client.query(
      `UPDATE entries
       SET tags = array_remove(tags, $1),
           changed_at = NOW()
       WHERE $1 = ANY(tags)`,
      [name]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function mutateSingleEntryTags(
  entryId: number,
  opts: { tags?: string[]; add?: string; remove?: string }
): Promise<string[]> {
  const p = await ensureTagsSchema();

  if (Array.isArray(opts.tags)) {
    const clean = Array.from(
      new Set(opts.tags.map(normalizeTagName).filter(Boolean))
    );
    for (const t of clean) {
      await upsertTagDefinition(t);
    }
    const res = await p.query<{ tags: string[] }>(
      `UPDATE entries
       SET tags = $1::text[], changed_at = NOW()
       WHERE id = $2
       RETURNING tags`,
      [clean, entryId]
    );
    return res.rows[0]?.tags || clean;
  }

  if (opts.add) {
    const clean = normalizeTagName(opts.add);
    if (!clean) throw new Error("Tên tag không hợp lệ.");
    await upsertTagDefinition(clean);
    const res = await p.query<{ tags: string[] }>(
      `UPDATE entries
       SET tags = CASE
         WHEN $1 = ANY(COALESCE(tags, '{}'::text[])) THEN tags
         ELSE array_append(COALESCE(tags, '{}'::text[]), $1)
       END,
       changed_at = NOW()
       WHERE id = $2
       RETURNING tags`,
      [clean, entryId]
    );
    return res.rows[0]?.tags || [];
  }

  if (opts.remove) {
    const clean = normalizeTagName(opts.remove);
    const res = await p.query<{ tags: string[] }>(
      `UPDATE entries
       SET tags = array_remove(COALESCE(tags, '{}'::text[]), $1),
           changed_at = NOW()
       WHERE id = $2
       RETURNING tags`,
      [clean, entryId]
    );
    return res.rows[0]?.tags || [];
  }

  const cur = await p.query<{ tags: string[] }>(
    "SELECT COALESCE(tags, '{}'::text[]) AS tags FROM entries WHERE id = $1",
    [entryId]
  );
  return cur.rows[0]?.tags || [];
}

export async function bulkMutateEntriesTags(opts: {
  entryIds: number[];
  addTags?: string[];
  removeTags?: string[];
}): Promise<{ updated: number }> {
  const ids = Array.from(
    new Set((opts.entryIds || []).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (ids.length === 0) return { updated: 0 };

  const p = await ensureTagsSchema();
  let updated = 0;

  for (const rawAdd of opts.addTags || []) {
    const tag = normalizeTagName(rawAdd);
    if (!tag) continue;
    await upsertTagDefinition(tag);
    const res = await p.query(
      `UPDATE entries
       SET tags = array_append(COALESCE(tags, '{}'::text[]), $1),
           changed_at = NOW()
       WHERE id = ANY($2::bigint[])
         AND status <> 'removed'
         AND NOT ($1 = ANY(COALESCE(tags, '{}'::text[])))`,
      [tag, ids]
    );
    updated += res.rowCount || 0;
  }

  for (const rawRem of opts.removeTags || []) {
    const tag = normalizeTagName(rawRem);
    if (!tag) continue;
    const res = await p.query(
      `UPDATE entries
       SET tags = array_remove(COALESCE(tags, '{}'::text[]), $1),
           changed_at = NOW()
       WHERE id = ANY($2::bigint[])
         AND $1 = ANY(COALESCE(tags, '{}'::text[]))`,
      [tag, ids]
    );
    updated += res.rowCount || 0;
  }

  return { updated };
}
