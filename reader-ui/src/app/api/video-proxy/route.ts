import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  decodeMinifluxProxyOriginalUrl,
  isAllowedExternalUrl,
  rewriteMinifluxProxyUrl,
} from "@/lib/export-helpers";

export const dynamic = "force-dynamic";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function inferVideoContentType(url: string, upstreamType: string | null): string | null {
  const ct = (upstreamType || "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("video/") || ct === "application/mp4" || ct === "audio/mp4") {
    return ct;
  }
  if (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream") {
    if (/\.webm(\?|$)/i.test(url)) return "video/webm";
    if (/\.mov(\?|$)/i.test(url)) return "video/quicktime";
    return "video/mp4";
  }
  return null;
}

async function fetchVideoUpstream(
  targetUrl: string,
  method: "GET" | "HEAD",
  rangeHeader: string | null,
  clientSignal: AbortSignal
): Promise<{ response: Response; cleanup: () => void } | null> {
  const controller = new AbortController();
  const connectTimer = setTimeout(
    () => controller.abort(new Error("Upstream connect timeout")),
    15000
  );
  const onAbort = () => controller.abort(clientSignal.reason);

  if (clientSignal.aborted) {
    clearTimeout(connectTimer);
    return null;
  }
  clientSignal.addEventListener("abort", onAbort, { once: true });

  const cleanup = () => {
    clearTimeout(connectTimer);
    clientSignal.removeEventListener("abort", onAbort);
  };

  try {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const res = await fetch(targetUrl, {
      method,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(connectTimer);
    return { response: res, cleanup };
  } catch {
    cleanup();
    return null;
  }
}

async function handleProxy(req: NextRequest, method: "GET" | "HEAD") {
  if (!(await isAuthenticated())) {
    return new NextResponse(null, { status: 401 });
  }

  const rawUrl = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!rawUrl || !isAllowedExternalUrl(rawUrl)) {
    return NextResponse.json({ error: "URL video không hợp lệ." }, { status: 400 });
  }

  const rangeHeader = req.headers.get("range");
  const candidates: string[] = [];
  const internalProxy = rewriteMinifluxProxyUrl(rawUrl);
  if (internalProxy) {
    candidates.push(internalProxy);
    const decoded = decodeMinifluxProxyOriginalUrl(rawUrl);
    if (decoded && isAllowedExternalUrl(decoded)) {
      candidates.push(decoded);
    }
  } else {
    candidates.push(rawUrl);
  }

  let upstream: Response | null = null;
  let cleanupFn: (() => void) | null = null;

  for (const candidate of candidates) {
    const attempt = await fetchVideoUpstream(
      candidate,
      method,
      rangeHeader,
      req.signal
    );
    if (!attempt) continue;

    const res = attempt.response;
    if (res.status === 200 || res.status === 206 || res.status === 416) {
      upstream = res;
      cleanupFn = attempt.cleanup;
      break;
    }

    await res.body?.cancel().catch(() => {});
    attempt.cleanup();
  }

  if (!upstream) {
    return NextResponse.json(
      { error: "Không tải được luồng video." },
      { status: 502 }
    );
  }

  if (upstream.status === 416) {
    const outHeaders = new Headers();
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) outHeaders.set("content-range", contentRange);
    await upstream.body?.cancel().catch(() => {});
    cleanupFn?.();
    return new NextResponse(null, { status: 416, headers: outHeaders });
  }

  const contentType = inferVideoContentType(
    rawUrl,
    upstream.headers.get("content-type")
  );
  if (!contentType) {
    await upstream.body?.cancel().catch(() => {});
    cleanupFn?.();
    return NextResponse.json(
      { error: "Nguồn trả về không phải luồng video hợp lệ." },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  outHeaders.set("content-type", contentType);
  for (const h of [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const val = upstream.headers.get(h);
    if (val) outHeaders.set(h, val);
  }
  if (!outHeaders.has("accept-ranges")) {
    outHeaders.set("accept-ranges", "bytes");
  }
  outHeaders.set("cache-control", "private, max-age=3600");

  if (method === "HEAD") {
    await upstream.body?.cancel().catch(() => {});
    cleanupFn?.();
    return new NextResponse(null, {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export async function GET(req: NextRequest) {
  return handleProxy(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return handleProxy(req, "HEAD");
}
