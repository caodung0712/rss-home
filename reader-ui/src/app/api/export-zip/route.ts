import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { buildEntriesExportZip } from "@/lib/export-helpers";
import {
  minifluxFetch,
  type MinifluxEntriesResponse,
  type MinifluxEntry,
} from "@/lib/miniflux";

interface ExportRequestBody {
  entryIds?: number[];
  filter?: {
    status?: string;
    categoryId?: number;
    feedId?: number;
    starred?: boolean;
    search?: string;
    after?: string;
    before?: string;
  };
}

async function resolveEntries(body: ExportRequestBody): Promise<MinifluxEntry[]> {
  if (Array.isArray(body.entryIds) && body.entryIds.length > 0) {
    const ids = body.entryIds.slice(0, 300);
    const entries: MinifluxEntry[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const fetched = await Promise.all(
        chunk.map((id) =>
          minifluxFetch<MinifluxEntry>(`/v1/entries/${id}`).catch(() => null)
        )
      );
      for (const e of fetched) {
        if (e) entries.push(e);
      }
    }
    return entries;
  }

  if (body.filter) {
    const params = new URLSearchParams({
      order: "published_at",
      direction: "desc",
      limit: "200",
      offset: "0",
    });
    if (body.filter.status === "unread" || body.filter.status === "read") {
      params.set("status", body.filter.status);
    }
    if (body.filter.categoryId) params.set("category_id", String(body.filter.categoryId));
    if (body.filter.feedId) params.set("feed_id", String(body.filter.feedId));
    if (body.filter.starred) params.set("starred", "true");
    if (body.filter.search) params.set("search", body.filter.search);
    if (body.filter.after) params.set("published_after", body.filter.after);
    if (body.filter.before) params.set("published_before", body.filter.before);

    const res = await minifluxFetch<MinifluxEntriesResponse>(
      `/v1/entries?${params.toString()}`
    );
    return res.entries || [];
  }

  return [];
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as ExportRequestBody;
    const entries = await resolveEntries(body);
    if (entries.length === 0) {
      return NextResponse.json({ error: "Không có bài viết nào để xuất." }, { status: 400 });
    }

    const zipBytes = await buildEntriesExportZip(entries);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return new NextResponse(Buffer.from(zipBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="rss-export-${stamp}.zip"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi xuất ZIP." },
      { status: 500 }
    );
  }
}
