import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { sessionCookieName, sessionCookieOptions, signSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      return NextResponse.json({ error: "服务器未配置 JWT_SECRET" }, { status: 500 });
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请输入有效邮箱与至少 8 位密码" },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: { email, passwordHash },
    });

    const token = await signSession({ sub: user.id, email: user.email });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(60 * 60 * 24 * 14));
    return res;
  } catch (e) {
    console.error("POST /api/auth/register", e);
    const msg = e instanceof Error ? e.message : "服务器异常";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
