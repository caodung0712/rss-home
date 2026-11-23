import net from "node:net";
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool | null {
  const connStr = (process.env.DATABASE_URL || "").trim();
  if (!connStr) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: connStr,
      max: 4,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 4000,
    });
  }
  return pool;
}

export interface FeedStorageRow {
  feed_id: number;
  total_entries: number;
  read_entries: number;
  unread_entries: number;
  starred_entries: number;
  removed_entries: number;
  storage_bytes: number;
}

export interface StorageSummary {
  db_bytes: number;
  total_active_entries: number;
  total_removed_entries: number;
  redis_bytes: number;
  redis_keys: number;
  by_feed: Record<number, FeedStorageRow>;
}

function sendRedisCommand(cmd: string): Promise<string> {
  const host = (process.env.REDIS_HOST || "redis").trim();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 6379 });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis timeout"));
    }, 2500);

    socket.on("connect", () => {
      socket.write(`${cmd}\r\n`);
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      // Kết thúc khi nhận phản hồi hoàn chỉnh cho PING/FLUSHDB/DBSIZE/INFO
      if (data.endsWith("\r\n")) {
        clearTimeout(timer);
        socket.end();
        resolve(data);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function getRedisStats(): Promise<{ bytes: number; keys: number }> {
  try {
    const info = await sendRedisCommand("INFO memory");
    const mMem = info.match(/used_memory:(\d+)/);
    const dbsizeRaw = await sendRedisCommand("DBSIZE");
    const mKeys = dbsizeRaw.match(/:(\d+)/);
    return {
      bytes: mMem ? Number(mMem[1]) : 0,
      keys: mKeys ? Number(mKeys[1]) : 0,
    };
  } catch {
    return { bytes: 0, keys: 0 };
  }
}

export async function getStorageStats(): Promise<StorageSummary> {
  const p = getPool();
  const redis = await getRedisStats();

  if (!p) {
    return {
      db_bytes: 0,
      total_active_entries: 0,
      total_removed_entries: 0,
      redis_bytes: redis.bytes,
      redis_keys: redis.keys,
      by_feed: {},
    };
  }

  const [dbSizeRes, feedRowsRes] = await Promise.all([
    p.query<{ db_bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS db_bytes"
    ),
    p.query<{
      feed_id: string;
      total_entries: string;
      read_entries: string;
      unread_entries: string;
      starred_entries: string;
      removed_entries: string;
      storage_bytes: string;
    }>(`
      SELECT
        feed_id::text AS feed_id,
        COUNT(*) FILTER (WHERE status <> 'removed')::text AS total_entries,
        COUNT(*) FILTER (WHERE status = 'read')::text AS read_entries,
        COUNT(*) FILTER (WHERE status = 'unread')::text AS unread_entries,
        COUNT(*) FILTER (WHERE starred = true AND status <> 'removed')::text AS starred_entries,
        COUNT(*) FILTER (WHERE status = 'removed')::text AS removed_entries,
        COALESCE(
          SUM(
            CASE WHEN status <> 'removed' THEN
              octet_length(COALESCE(title, '')) +
              octet_length(COALESCE(content, '')) +
              octet_length(COALESCE(url, '')) +
              octet_length(COALESCE(author, '')) +
              octet_length(COALESCE(document_vectors::text, ''))
            ELSE 0 END
          ),
          0
        )::text AS storage_bytes
      FROM entries
      GROUP BY feed_id
    `),
  ]);

  const byFeed: Record<number, FeedStorageRow> = {};
  let totalActive = 0;
  let totalRemoved = 0;

  for (const r of feedRowsRes.rows) {
    const fid = Number(r.feed_id);
    const active = Number(r.total_entries || 0);
    const removed = Number(r.removed_entries || 0);
    totalActive += active;
    totalRemoved += removed;
    byFeed[fid] = {
      feed_id: fid,
      total_entries: active,
      read_entries: Number(r.read_entries || 0),
      unread_entries: Number(r.unread_entries || 0),
      starred_entries: Number(r.starred_entries || 0),
      removed_entries: removed,
      storage_bytes: Number(r.storage_bytes || 0),
    };
  }

  return {
    db_bytes: Number(dbSizeRes.rows[0]?.db_bytes || 0),
    total_active_entries: totalActive,
    total_removed_entries: totalRemoved,
    redis_bytes: redis.bytes,
    redis_keys: redis.keys,
    by_feed: byFeed,
  };
}

export async function cleanupOldEntries(opts: {
  feedIds?: number[];
  olderThanDays: number;
  includeUnread?: boolean;
}): Promise<{ cleared: number }> {
  const p = getPool();
  if (!p) {
    throw new Error("Chưa cấu hình DATABASE_URL để dọn bài viết theo bộ lọc.");
  }

  const statuses = opts.includeUnread ? ["read", "unread"] : ["read"];
  const params: unknown[] = [statuses];
  const conditions: string[] = [
    "status = ANY($1::entry_status[])",
    "starred = false",
  ];

  if (opts.feedIds && opts.feedIds.length > 0) {
    params.push(opts.feedIds);
    conditions.push(`feed_id = ANY($${params.length}::bigint[])`);
  }

  if (opts.olderThanDays > 0) {
    params.push(opts.olderThanDays);
    conditions.push(`published_at < NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  // Giữ hash tombstone theo đúng cơ chế Miniflux để không kéo lại bài cũ, nhưng giải phóng toàn bộ nội dung
  const sql = `
    UPDATE entries
    SET status = 'removed',
        content = '',
        document_vectors = NULL,
        changed_at = NOW()
    WHERE ${conditions.join(" AND ")}
  `;
  const result = await p.query(sql, params);
  const cleared = result.rowCount || 0;

  if (cleared > 0) {
    await p.query("VACUUM (ANALYZE) entries").catch(() => undefined);
  }

  return { cleared };
}

export async function clearAllCaches(): Promise<{
  redis_cleared: boolean;
  bridge_cleared: boolean;
}> {
  let redisCleared = false;
  let bridgeCleared = false;

  try {
    const resp = await sendRedisCommand("FLUSHDB");
    redisCleared = resp.includes("OK");
  } catch {
    redisCleared = false;
  }

  try {
    const bridgeUrl = (
      process.env.APIFY_BRIDGE_URL || "http://apify-bridge:8000"
    ).replace(/\/+$/, "");
    const res = await fetch(`${bridgeUrl}/cache/clear`, {
      method: "POST",
      cache: "no-store",
    });
    bridgeCleared = res.ok;
  } catch {
    bridgeCleared = false;
  }

  return { redis_cleared: redisCleared, bridge_cleared: bridgeCleared };
}
