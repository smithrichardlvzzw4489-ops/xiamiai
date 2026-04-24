import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateSixDigitCode, hashRegisterCode } from "@/lib/register-code";
import { sendRegisterCodeEmail } from "@/lib/mail";

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    if (!process.env.APP_SECRET?.trim()) {
      return NextResponse.json(
        { error: "服务器未配置 APP_SECRET，无法生成验证码" },
        { status: 500 },
      );
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const code = generateSixDigitCode();
    const codeHash = hashRegisterCode(email, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.registrationIntent.upsert({
      where: { email },
      create: { email, codeHash, expiresAt },
      update: { codeHash, expiresAt },
    });

    let mailChannel: "resend" | "smtp" | "console";
    try {
      const sent = await sendRegisterCodeEmail(email, code);
      mailChannel = sent.channel;
    } catch (e) {
      await prisma.registrationIntent.deleteMany({ where: { email } });
      const msg = e instanceof Error ? e.message : "邮件发送失败";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const payload: Record<string, unknown> = {
      ok: true,
      message:
        mailChannel === "console"
          ? "开发模式：未配置发信服务，验证码已打印在运行 next dev 的终端。"
          : "验证码已发送，请查收邮件（含垃圾箱）。",
      mailChannel,
    };

    if (mailChannel === "console" && process.env.NODE_ENV === "development") {
      payload.devCode = code;
    }

    return NextResponse.json(payload);
  } catch (e) {
    console.error("POST /api/auth/register/send-code", e);
    const msg = e instanceof Error ? e.message : "服务器异常";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
