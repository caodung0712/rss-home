import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxFeed,
} from "@/lib/miniflux";

interface ExportedFeedItem {
  title?: string;
  feed_url?: string;
  site_url?: string;
  category?: string;
  crawler?: boolean;
  disabled?: boolean;
  blocklist_rules?: string;
  keeplist_rules?: string;
  rewrite_rules?: string;
  scraper_rules?: string;
  user_agent?: string;
}

interface ExportedChannelsPayload {
  version?: number;
  categories?: Array<{ title?: string }>;
  feeds?: ExportedFeedItem[];
  overwriteExisting?: boolean;
}

interface ChannelImportResult {
  index: number;
  title: string;
  feed_url: string;
  category: string;
  status: "added" | "updated" | "exists" | "error";
  message: string;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    let payload: ExportedChannelsPayload;
    let overwriteExisting = false;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      overwriteExisting = String(fd.get("overwriteExisting") || "") === "true";
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "Thiếu file JSON danh sách kênh." }, { status: 400 });
      }
      const text = await file.text();
      payload = JSON.parse(text) as ExportedChannelsPayload;
    } else {
      payload = (await req.json()) as ExportedChannelsPayload;
      overwriteExisting = Boolean(payload.overwriteExisting);
    }

    if (!payload || !Array.isArray(payload.feeds) || payload.feeds.length === 0) {
      return NextResponse.json(
        { error: "File JSON không chứa danh sách `feeds` hợp lệ." },
        { status: 400 }
      );
    }

    const [existingCats, existingFeeds] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
    ]);

    const catMap = new Map<string, number>();
    for (const c of existingCats) {
      catMap.set(c.title.trim().toLowerCase(), c.id);
    }

    const ensureCategory = async (rawTitle: string): Promise<number> => {
      const title = rawTitle.trim() || "Chung";
      const key = title.toLowerCase();
      const hit = catMap.get(key);
      if (hit) return hit;
      const created = await minifluxFetch<MinifluxCategory>("/v1/categories", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      catMap.set(key, created.id);
      return created.id;
    };

    // Tạo trước các thư mục rỗng nếu có trong file export
    if (Array.isArray(payload.categories)) {
      for (const c of payload.categories) {
        if (c?.title && c.title.trim()) {
          await ensureCategory(c.title).catch(() => undefined);
        }
      }
    }

    const feedByUrl = new Map<string, MinifluxFeed>();
    for (const f of existingFeeds) {
      feedByUrl.set(f.feed_url.trim(), f);
    }

    const results: ChannelImportResult[] = [];
    let added = 0;
    let updated = 0;
    let exists = 0;
    let errorCount = 0;

    for (let i = 0; i < payload.feeds.length; i++) {
      const item = payload.feeds[i];
      const feedUrl = (item?.feed_url || "").trim();
      const catTitle = (item?.category || "").trim() || "Chung";
      const displayTitle = (item?.title || "").trim() || feedUrl;

      if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) {
        errorCount++;
        results.push({
          index: i + 1,
          title: displayTitle || `(Kênh #${i + 1})`,
          feed_url: feedUrl,
          category: catTitle,
          status: "error",
          message: "URL feed không hợp lệ.",
        });
        continue;
      }

      try {
        const categoryId = await ensureCategory(catTitle);
        const existing = feedByUrl.get(feedUrl);

        if (existing) {
          if (overwriteExisting) {
            await minifluxFetch(`/v1/feeds/${existing.id}`, {
              method: "PUT",
              body: JSON.stringify({
                title: displayTitle,
                category_id: categoryId,
                crawler: Boolean(item.crawler),
                disabled: Boolean(item.disabled),
                blocklist_rules: item.blocklist_rules || "",
                keeplist_rules: item.keeplist_rules || "",
                rewrite_rules: item.rewrite_rules || "",
                scraper_rules: item.scraper_rules || "",
                user_agent: item.user_agent || "",
              }),
            });
            updated++;
            results.push({
              index: i + 1,
              title: displayTitle,
              feed_url: feedUrl,
              category: catTitle,
              status: "updated",
              message: "Đã cập nhật cài đặt kênh.",
            });
          } else {
            exists++;
            results.push({
              index: i + 1,
              title: displayTitle,
              feed_url: feedUrl,
              category: catTitle,
              status: "exists",
              message: "Kênh đã tồn tại.",
            });
          }
          continue;
        }

        const created = await minifluxFetch<{ feed_id: number }>("/v1/feeds", {
          method: "POST",
          body: JSON.stringify({
            feed_url: feedUrl,
            category_id: categoryId,
            crawler: Boolean(item.crawler),
            disabled: Boolean(item.disabled),
            blocklist_rules: item.blocklist_rules || undefined,
            keeplist_rules: item.keeplist_rules || undefined,
            rewrite_rules: item.rewrite_rules || undefined,
            scraper_rules: item.scraper_rules || undefined,
            user_agent: item.user_agent || undefined,
          }),
        });

        if (created?.feed_id) {
          await minifluxFetch(`/v1/feeds/${created.feed_id}`, {
            method: "PUT",
            body: JSON.stringify({
              title: displayTitle,
              crawler: Boolean(item.crawler),
              disabled: Boolean(item.disabled),
              blocklist_rules: item.blocklist_rules || "",
              keeplist_rules: item.keeplist_rules || "",
              rewrite_rules: item.rewrite_rules || "",
              scraper_rules: item.scraper_rules || "",
              user_agent: item.user_agent || "",
            }),
          }).catch(() => undefined);
        }

        feedByUrl.set(feedUrl, {
          id: created?.feed_id || 0,
          title: displayTitle,
          feed_url: feedUrl,
          site_url: item.site_url || "",
          checked_at: "",
          parsing_error_count: 0,
          parsing_error_message: "",
          crawler: Boolean(item.crawler),
          disabled: Boolean(item.disabled),
          category: { id: categoryId, title: catTitle },
        });

        added++;
        results.push({
          index: i + 1,
          title: displayTitle,
          feed_url: feedUrl,
          category: catTitle,
          status: "added",
          message: "Đã thêm thành công.",
        });
      } catch (err) {
        errorCount++;
        results.push({
          index: i + 1,
          title: displayTitle,
          feed_url: feedUrl,
          category: catTitle,
          status: "error",
          message: err instanceof Error ? err.message : "Không thể thêm kênh.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      summary: {
        total: payload.feeds.length,
        added,
        updated,
        exists,
        error: errorCount,
      },
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi khi import danh sách kênh." },
      { status: 400 }
    );
  }
}
