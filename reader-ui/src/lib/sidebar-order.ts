import type { Pool } from "pg";
import { getDbPool } from "./db";

let orderSchemaPromise: Promise<void> | null = null;

/**
 * Ensures lightweight Postgres tables for custom folder and feed display order.
 */
export async function ensureSidebarOrderSchema(poolArg?: Pool | null): Promise<Pool | null> {
  const p = poolArg ?? getDbPool();
  if (!p) return null;

  if (!orderSchemaPromise) {
    orderSchemaPromise = (async () => {
      await p.query(`
        CREATE TABLE IF NOT EXISTS rss_category_order (
          category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS rss_feed_order (
          feed_id BIGINT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0
        );
      `);
    })().catch((err) => {
      orderSchemaPromise = null;
      throw err;
    });
  }

  await orderSchemaPromise;
  return p;
}

export async function getSidebarOrder(): Promise<{
  categoryOrder: Map<number, number>;
  feedOrder: Map<number, number>;
}> {
  const categoryOrder = new Map<number, number>();
  const feedOrder = new Map<number, number>();

  const p = await ensureSidebarOrderSchema();
  if (!p) return { categoryOrder, feedOrder };

  const [catRows, feedRows] = await Promise.all([
    p.query<{ category_id: number; position: number }>(
      "SELECT category_id, position FROM rss_category_order"
    ),
    p.query<{ feed_id: string; position: number }>(
      "SELECT feed_id, position FROM rss_feed_order"
    ),
  ]);

  for (const r of catRows.rows) {
    categoryOrder.set(Number(r.category_id), Number(r.position));
  }
  for (const r of feedRows.rows) {
    feedOrder.set(Number(r.feed_id), Number(r.position));
  }

  return { categoryOrder, feedOrder };
}

export async function saveCategoryOrder(categoryIds: number[]): Promise<void> {
  const clean = Array.from(
    new Set(categoryIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (clean.length === 0) return;

  const p = await ensureSidebarOrderSchema();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < clean.length; i++) {
      await client.query(
        `INSERT INTO rss_category_order (category_id, position)
         VALUES ($1, $2)
         ON CONFLICT (category_id) DO UPDATE SET position = EXCLUDED.position`,
        [clean[i], i]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function saveFeedOrder(feedIds: number[]): Promise<void> {
  const clean = Array.from(
    new Set(feedIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (clean.length === 0) return;

  const p = await ensureSidebarOrderSchema();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < clean.length; i++) {
      await client.query(
        `INSERT INTO rss_feed_order (feed_id, position)
         VALUES ($1, $2)
         ON CONFLICT (feed_id) DO UPDATE SET position = EXCLUDED.position`,
        [clean[i], i]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
