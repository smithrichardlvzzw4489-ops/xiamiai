import { NextResponse } from "next/server";
import { getMeState } from "@/lib/me-state";

export async function GET() {
  try {
    const me = await getMeState();
    return NextResponse.json(me);
  } catch (e) {
    console.error("GET /api/auth/me", e);
    return NextResponse.json(
      { user: null, quota: null, error: e instanceof Error ? e.message : "服务器异常" },
      { status: 500 },
    );
  }
}
