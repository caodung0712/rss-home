import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { downloadImageBuffer, isAllowedExternalUrl } from "@/lib/export-helpers";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return new NextResponse(null, { status: 401 });
  }

  const targetUrl = req.nextUrl.searchParams.get("url") || "";
  if (!targetUrl || !isAllowedExternalUrl(targetUrl)) {
    return new NextResponse("URL ảnh không hợp lệ.", { status: 400 });
  }

  const dl = await downloadImageBuffer(targetUrl);
  if (!dl) {
    return new NextResponse("Không tải được ảnh.", { status: 502 });
  }

  return new NextResponse(Buffer.from(dl.data), {
    status: 200,
    headers: {
      "Content-Type": dl.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
