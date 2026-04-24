import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { hashRegisterCode } from "@/lib/register-code";
import { sessionCookieName, sessionCookieOptions, signSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  try {
    if (!process.env.APP_SECRET?.trim()) {
      return NextResponse.json({ error: "服务器未配置 APP_SECRET" }, { status: 500 });
    }
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
        { error: "请填写有效邮箱、6 位验证码，以及至少 8 位密码" },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const intent = await prisma.registrationIntent.findUnique({ where: { email } });
    if (!intent) {
      return NextResponse.json({ error: "请先发送邮箱验证码" }, { status: 400 });
    }
    if (intent.expiresAt < new Date()) {
      await prisma.registrationIntent.delete({ where: { email } });
      return NextResponse.json({ error: "验证码已过期，请重新获取" }, { status: 400 });
    }

    const expected = hashRegisterCode(email, parsed.data.code);
    if (expected !== intent.codeHash) {
      return NextResponse.json({ error: "验证码不正确" }, { status: 400 });
    }

    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) {
      await prisma.registrationIntent.deleteMany({ where: { email } });
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.$transaction(async (tx) => {
      await tx.registrationIntent.delete({ where: { email } });
      return tx.user.create({
        data: { email, passwordHash },
      });
    });

    const token = await signSession({ sub: user.id, email: user.email });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(60 * 60 * 24 * 14));
    return res;
  } catch (e) {
    console.error("POST /api/auth/register/verify", e);
    const msg = e instanceof Error ? e.message : "服务器异常";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
