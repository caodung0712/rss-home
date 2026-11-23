import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch, type MinifluxCategory } from "@/lib/miniflux";

interface SubscribeBody {
  platform?:
    | "rss"
    | "youtube"
    | "x"
    | "facebook"
    | "tiktok"
    | "linkedin"
    | "linkedin_jobs"
    | "google_news"
    | "telegram"
    | "bluesky"
    | "rsshub";
  feedUrl?: string;
  pageName?: string;
  pageUrl?: string;
  useFxTwitter?: boolean;
  title?: string;
  categoryId?: number;
  newCategoryTitle?: string;
  crawler?: boolean;
}

function normalizeXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^@/, "");
}

function normalizeTikTokHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, "")
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^@/, "");
}

function normalizeLinkedInUrl(raw: string): string {
  const val = raw.trim();
  if (!val) return "";
  if (/^https?:\/\//i.test(val)) {
    const u = new URL(val);
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  }
  const clean = val.replace(/^\/+|\/+$/g, "");
  if (clean.startsWith("in/") || clean.startsWith("company/") || clean.startsWith("school/")) {
    return `https://www.linkedin.com/${clean}`;
  }
  return `https://www.linkedin.com/in/${clean}`;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as SubscribeBody;
    let categoryId = body.categoryId;

    if (body.newCategoryTitle && body.newCategoryTitle.trim()) {
      const existingCats = await minifluxFetch<MinifluxCategory[]>("/v1/categories");
      const found = existingCats.find(
        (c) =>
          c.title.trim().toLowerCase() === body.newCategoryTitle!.trim().toLowerCase()
      );
      if (found) {
        categoryId = found.id;
      } else {
        const createdCat = await minifluxFetch<MinifluxCategory>("/v1/categories", {
          method: "POST",
          body: JSON.stringify({ title: body.newCategoryTitle.trim() }),
        });
        categoryId = createdCat.id;
      }
    }

    if (!categoryId) {
      const cats = await minifluxFetch<MinifluxCategory[]>("/v1/categories");
      if (cats.length > 0) {
        categoryId = cats[0].id;
      } else {
        const created = await minifluxFetch<MinifluxCategory>("/v1/categories", {
          method: "POST",
          body: JSON.stringify({ title: "Chung" }),
        });
        categoryId = created.id;
      }
    }

    let finalFeedUrl = (body.feedUrl || "").trim();
    let customTitle = (body.title || "").trim();

    if (body.platform === "facebook") {
      const taskId = (process.env.APIFY_FB_TASK_ID || "").trim();
      if (!taskId) {
        return NextResponse.json(
          {
            error:
              "Chưa có APIFY_FB_TASK_ID trong file .env. Hãy tạo Task trên Apify rồi điền vào .env trước.",
          },
          { status: 400 }
        );
      }
      const matchKey =
        (body.pageName || "").trim() ||
        (body.pageUrl || "").trim().replace(/\/+$/, "").split("/").pop() ||
        "";
      if (!matchKey) {
        return NextResponse.json(
          { error: "Vui lòng nhập tên Page hoặc URL Page Facebook." },
          { status: 400 }
        );
      }
      finalFeedUrl = `http://apify-bridge:8000/task/${taskId}.xml?match=${encodeURIComponent(
        matchKey
      )}`;
      if (!customTitle) customTitle = matchKey;
    } else if (body.platform === "x") {
      const handle = normalizeXHandle(finalFeedUrl);
      if (!handle) {
        return NextResponse.json(
          { error: "Vui lòng nhập tên tài khoản X (ví dụ: elonmusk)." },
          { status: 400 }
        );
      }
      finalFeedUrl = body.useFxTwitter
        ? `https://fxtwitter.com/${handle}/feed.xml`
        : `http://rsshub:1200/twitter/user/${handle}`;
      if (!customTitle) customTitle = `@${handle} (X)`;
    } else if (body.platform === "tiktok") {
      const handle = normalizeTikTokHandle(finalFeedUrl || body.pageUrl || "");
      if (!handle) {
        return NextResponse.json(
          { error: "Vui lòng nhập @handle hoặc link kênh TikTok." },
          { status: 400 }
        );
      }
      finalFeedUrl = `http://rsshub:1200/tiktok/user/@${handle}`;
      if (!customTitle) customTitle = `@${handle} (TikTok)`;
    } else if (body.platform === "linkedin") {
      const liUrl = normalizeLinkedInUrl(finalFeedUrl || body.pageUrl || "");
      if (!liUrl) {
        return NextResponse.json(
          { error: "Vui lòng nhập URL hồ sơ (/in/...) hoặc trang công ty (/company/...) LinkedIn." },
          { status: 400 }
        );
      }
      const nameParam = customTitle ? `&name=${encodeURIComponent(customTitle)}` : "";
      finalFeedUrl = `http://apify-bridge:8000/linkedin.xml?url=${encodeURIComponent(liUrl)}${nameParam}`;
      if (!customTitle) {
        const slug = liUrl.split("/").filter(Boolean).pop() || "LinkedIn";
        customTitle = `${slug} (LinkedIn)`;
      }
    } else if (body.platform === "linkedin_jobs") {
      const kw = (finalFeedUrl || "").trim();
      if (!kw) {
        return NextResponse.json(
          { error: "Vui lòng nhập từ khoá việc làm LinkedIn." },
          { status: 400 }
        );
      }
      finalFeedUrl = `http://rsshub:1200/linkedin/jobs/all/all/${encodeURIComponent(kw)}`;
      if (!customTitle) customTitle = `LinkedIn Jobs: ${kw}`;
    } else if (body.platform === "telegram") {
      const ch = finalFeedUrl
        .replace(/^https?:\/\/t\.me\/(s\/)?/i, "")
        .split("/")[0]
        .replace(/^@/, "");
      if (!ch) {
        return NextResponse.json({ error: "Tên kênh Telegram không hợp lệ." }, { status: 400 });
      }
      finalFeedUrl = `http://rsshub:1200/telegram/channel/${ch}`;
      if (!customTitle) customTitle = `${ch} (Telegram)`;
    } else if (body.platform === "bluesky") {
      const handle = finalFeedUrl
        .replace(/^https?:\/\/bsky\.app\/profile\//i, "")
        .split("/")[0]
        .replace(/^@/, "");
      if (!handle) {
        return NextResponse.json({ error: "Handle Bluesky không hợp lệ." }, { status: 400 });
      }
      finalFeedUrl = `https://bsky.app/profile/${handle}/rss`;
      if (!customTitle) customTitle = `${handle} (Bluesky)`;
    } else if (body.platform === "rsshub") {
      const route = finalFeedUrl.startsWith("http")
        ? finalFeedUrl
        : `http://rsshub:1200/${finalFeedUrl.replace(/^\/+/, "")}`;
      finalFeedUrl = route;
    }

    if (!finalFeedUrl || !/^https?:\/\//i.test(finalFeedUrl)) {
      return NextResponse.json(
        { error: "URL feed phải bắt đầu bằng http:// hoặc https://." },
        { status: 400 }
      );
    }

    const created = await minifluxFetch<{ feed_id: number }>("/v1/feeds", {
      method: "POST",
      body: JSON.stringify({
        feed_url: finalFeedUrl,
        category_id: categoryId,
        crawler: Boolean(body.crawler),
      }),
    });

    if (created?.feed_id && (customTitle || body.crawler)) {
      const patch: Record<string, unknown> = {};
      if (customTitle) patch.title = customTitle;
      if (body.crawler) patch.crawler = true;
      await minifluxFetch(`/v1/feeds/${created.feed_id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      feed_id: created?.feed_id,
      feed_url: finalFeedUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể thêm nguồn tin." },
      { status: 400 }
    );
  }
}
