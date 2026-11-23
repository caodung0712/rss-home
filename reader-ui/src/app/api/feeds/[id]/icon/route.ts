import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { minifluxFetch } from "@/lib/miniflux";

interface IconResponse {
  id: number;
  data: string;
  mime_type: string;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const icon = await minifluxFetch<IconResponse>(`/v1/feeds/${id}/icon`);
    if (!icon?.data) {
      return new NextResponse(null, { status: 404 });
    }
    // Miniflux trả dạng "image/png;base64,iVBORw0..." hoặc "data:image/png;base64,..."
    const commaIdx = icon.data.indexOf(",");
    const base64Part = commaIdx >= 0 ? icon.data.slice(commaIdx + 1) : icon.data;
    const buffer = Buffer.from(base64Part, "base64");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": icon.mime_type || "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
