export interface MinifluxCategory {
  id: number;
  title: string;
  user_id?: number;
  hide_globally?: boolean;
  feed_count?: number;
  total_unread?: number;
}

export interface MinifluxFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  checked_at: string;
  next_check_at?: string;
  parsing_error_count: number;
  parsing_error_message: string;
  crawler: boolean;
  disabled: boolean;
  blocklist_rules?: string;
  keeplist_rules?: string;
  rewrite_rules?: string;
  scraper_rules?: string;
  user_agent?: string;
  category: {
    id: number;
    title: string;
  };
  icon?: {
    feed_id: number;
    icon_id: number;
  };
}

export interface MinifluxEnclosure {
  id: number;
  user_id: number;
  entry_id: number;
  url: string;
  mime_type: string;
  size: number;
}

export interface MinifluxEntry {
  id: number;
  user_id: number;
  feed_id: number;
  status: "unread" | "read" | "removed";
  hash: string;
  title: string;
  url: string;
  comments_url: string;
  published_at: string;
  created_at: string;
  changed_at: string;
  content: string;
  author: string;
  share_code: string;
  starred: boolean;
  reading_time: number;
  tags?: string[];
  enclosures?: MinifluxEnclosure[] | null;
  feed: MinifluxFeed;
}

export interface MinifluxEntriesResponse {
  total: number;
  entries: MinifluxEntry[];
}

export interface MinifluxCountersResponse {
  reads: Record<string, number>;
  unreads: Record<string, number>;
}

function getMinifluxBaseUrl(): string {
  return (
    process.env.MINIFLUX_INTERNAL_URL ||
    process.env.MINIFLUX_BASE_URL ||
    "http://miniflux:8080"
  ).replace(/\/+$/, "");
}

function getAuthHeaders(): Record<string, string> {
  const apiKey = (process.env.MINIFLUX_API_KEY || "").trim();
  if (apiKey) {
    return { "X-Auth-Token": apiKey };
  }
  const user = (process.env.MINIFLUX_ADMIN_USERNAME || "admin").trim();
  const pass = (process.env.MINIFLUX_ADMIN_PASSWORD || "").trim();
  if (user && pass) {
    const encoded = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  throw new Error("Thiếu MINIFLUX_API_KEY hoặc MINIFLUX_ADMIN_PASSWORD trong biến môi trường.");
}

export async function minifluxFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${getMinifluxBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...getAuthHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Miniflux API ${init.method || "GET"} ${path} -> ${res.status}: ${errText}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
