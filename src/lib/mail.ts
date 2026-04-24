import nodemailer from "nodemailer";

export type RegisterMailChannel = "resend" | "smtp" | "console";

function hasSmtp(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function hasResend(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

async function sendViaResend(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY!.trim();
  const from =
    process.env.RESEND_FROM?.trim() || "隙光 <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend 发送失败 (${res.status})：${body.slice(0, 400)}`);
  }
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<void> {
  const port = Number(process.env.SMTP_PORT || "587");
  const explicitSecure = process.env.SMTP_SECURE?.toLowerCase() === "true";
  const secure = explicitSecure || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 45_000,
    greetingTimeout: 30_000,
    ...(port === 587 && !secure
      ? {
          requireTLS: true,
        }
      : {}),
  });

  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });
}

/**
 * 发注册验证码。优先级：Resend → SMTP → 开发环境仅控制台。
 */
export async function sendRegisterCodeEmail(
  to: string,
  code: string,
): Promise<{ channel: RegisterMailChannel }> {
  const subject = "隙光 · 注册验证码";
  const text = `您的验证码是：${code}\n10 分钟内有效。如非本人操作请忽略本邮件。`;

  if (hasResend()) {
    await sendViaResend(to, subject, text);
    return { channel: "resend" };
  }

  if (hasSmtp()) {
    await sendViaSmtp(to, subject, text);
    return { channel: "smtp" };
  }

  if (process.env.NODE_ENV === "development") {
    console.info("\n========== 隙光 · 注册验证码（未配置发信，仅开发模式）==========");
    console.info(`收件人: ${to}`);
    console.info(`验证码: ${code}`);
    console.info("请在 .env 中配置 RESEND_API_KEY 或 SMTP_* 以发送真实邮件。");
    console.info("================================================================\n");
    return { channel: "console" };
  }

  throw new Error(
    "未配置发信：请设置 RESEND_API_KEY（推荐）或 SMTP_HOST / SMTP_USER / SMTP_PASS。详见项目 env.example。",
  );
}
