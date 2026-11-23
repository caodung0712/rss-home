import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  minifluxFetch,
  type MinifluxCategory,
  type MinifluxFeed,
} from "@/lib/miniflux";
import { resolveYouTubeFeed } from "@/lib/youtube";

function parseCsvLines(text: string): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });
    rows.push(rec);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const noShorts = formData.get("noShorts") === "true";
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file CSV." }, { status: 400 });
    }

    const csvText = await file.text();
    const rows = parseCsvLines(csvText);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "File CSV trống hoặc sai định dạng." },
        { status: 400 }
      );
    }

    const [categories, existingFeeds] = await Promise.all([
      minifluxFetch<MinifluxCategory[]>("/v1/categories"),
      minifluxFetch<MinifluxFeed[]>("/v1/feeds"),
    ]);

    const catMap = new Map<string, number>();
    for (const c of categories) {
      catMap.set(c.title.trim().toLowerCase(), c.id);
    }
    const feedUrlSet = new Set(existingFeeds.map((f) => f.feed_url));
    const fbTaskId = (process.env.APIFY_FB_TASK_ID || "").trim();

    const results: Array<{
      row: number;
      platform: string;
      name: string;
      status: "added" | "exists" | "skipped" | "error";
      message: string;
    }> = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const platform = (r.platform || "").toLowerCase();
      const target = (r.url_or_handle || "").trim();
      const folder = (r.folder || "Social").trim();
      const name = (r.name || "").trim();

      if (!platform || !target || target.startsWith("<")) {
        continue;
      }

      try {
        let feedUrl = "";
        if (platform === "x") {
          const handle = target
            .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
            .split("/")[0]
            .replace(/^@/, "");
          feedUrl = `http://rsshub:1200/twitter/user/${handle}`;
        } else if (platform === "youtube") {
          const resolved = await resolveYouTubeFeed(target, noShorts);
          feedUrl = resolved.url;
        } else if (platform === "facebook") {
          if (!fbTaskId) {
            results.push({
              row: idx + 2,
              platform,
              name: name || target,
              status: "skipped",
              message: "Thiếu APIFY_FB_TASK_ID trong .env",
            });
            continue;
          }
          const matchKey = name || target.replace(/\/+$/, "").split("/").pop() || "";
          feedUrl = `http://apify-bridge:8000/task/${fbTaskId}.xml?match=${encodeURIComponent(
            matchKey
          )}`;
        } else {
          results.push({
            row: idx + 2,
            platform,
            name: name || target,
            status: "skipped",
            message: `Không hỗ trợ nền tảng '${platform}'`,
          });
          continue;
        }

        if (feedUrlSet.has(feedUrl)) {
          results.push({
            row: idx + 2,
            platform,
            name: name || target,
            status: "exists",
            message: "Đã tồn tại trong Miniflux",
          });
          continue;
        }

        let catId = catMap.get(folder.toLowerCase());
        if (!catId) {
          const createdCat = await minifluxFetch<MinifluxCategory>("/v1/categories", {
            method: "POST",
            body: JSON.stringify({ title: folder }),
          });
          catId = createdCat.id;
          catMap.set(folder.toLowerCase(), catId);
        }

        const created = await minifluxFetch<{ feed_id: number }>("/v1/feeds", {
          method: "POST",
          body: JSON.stringify({ feed_url: feedUrl, category_id: catId }),
        });

        if (name && created?.feed_id) {
          await minifluxFetch(`/v1/feeds/${created.feed_id}`, {
            method: "PUT",
            body: JSON.stringify({ title: name }),
          }).catch(() => undefined);
        }

        feedUrlSet.add(feedUrl);
        results.push({
          row: idx + 2,
          platform,
          name: name || target,
          status: "added",
          message: feedUrl,
        });
      } catch (err) {
        results.push({
          row: idx + 2,
          platform,
          name: name || target,
          status: "error",
          message: err instanceof Error ? err.message : "Lỗi thêm nguồn",
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi xử lý file CSV." },
      { status: 500 }
    );
  }
}
