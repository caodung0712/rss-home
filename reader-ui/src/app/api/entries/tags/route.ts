import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { bulkMutateEntriesTags } from "@/lib/tags";

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      entryIds?: number[];
      addTags?: string[];
      removeTags?: string[];
    };
    const res = await bulkMutateEntriesTags({
      entryIds: Array.isArray(body.entryIds) ? body.entryIds : [],
      addTags: Array.isArray(body.addTags) ? body.addTags : [],
      removeTags: Array.isArray(body.removeTags) ? body.removeTags : [],
    });
    return NextResponse.json({ ok: true, updated: res.updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không gắn tag hàng loạt được." },
      { status: 400 }
    );
  }
}
