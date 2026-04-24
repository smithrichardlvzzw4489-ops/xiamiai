import { OpenRouter } from "@openrouter/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/get-session-user";
import { DAILY_FREE_LIMIT, utcDayString } from "@/lib/usage";

export const runtime = "nodejs";

/** OpenRouter / OpenAI-style assistant message; images often live in `content[]`, not `images`. */
function extractImageUrlsFromAssistantMessage(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const m = message as Record<string, unknown>;
  const urls: string[] = [];

  const images = m.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (!img || typeof img !== "object") continue;
      const im = img as Record<string, unknown>;
      const iu = im.image_url ?? im.imageUrl;
      if (iu && typeof iu === "object" && typeof (iu as Record<string, unknown>).url === "string") {
        urls.push(String((iu as Record<string, unknown>).url));
      }
    }
  }

  const content = m.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type === "image_url") {
        const iu = p.imageUrl ?? p.image_url;
        if (iu && typeof iu === "object" && typeof (iu as Record<string, unknown>).url === "string") {
          urls.push(String((iu as Record<string, unknown>).url));
        }
      }
    }
  } else if (typeof content === "string") {
    const md = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = md.exec(content)) !== null) {
      urls.push(match[1]);
    }
    if (content.startsWith("data:image") && content.includes(";base64,")) {
      urls.push(content.trim().split(/\s/)[0]);
    }
  }

  return [...new Set(urls)];
}

const bodySchema = z.object({
  prompt: z.string().min(1).max(16_000),
});

export async function POST(req: Request) {
  try {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "描述内容过长或为空" }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "服务器未配置 OPENROUTER_API_KEY" }, { status: 500 });
  }

  const day = utcDayString();
  const existing = await prisma.usageDay.findUnique({
    where: { userId_day: { userId: user.id, day } },
  });
  const usedBefore = existing?.count ?? 0;
  if (usedBefore >= DAILY_FREE_LIMIT) {
    return NextResponse.json(
      { error: `今日免费额度已用完（${DAILY_FREE_LIMIT} 次），请明日再来` },
      { status: 429 },
    );
  }

  const openrouter = new OpenRouter({ apiKey });

  let result: unknown;
  try {
    result = await openrouter.chat.send({
      model: "openai/gpt-5.4-image-2",
      messages: [
        {
          role: "user",
          content: parsed.data.prompt,
        },
      ],
      modalities: ["image", "text"],
    } as never);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "生成失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const choices = (result as { choices?: unknown[] })?.choices;
  const message = Array.isArray(choices) ? (choices[0] as { message?: unknown })?.message : undefined;

  const refusal =
    message && typeof message === "object" && "refusal" in message
      ? (message as { refusal?: string | null }).refusal
      : null;
  if (typeof refusal === "string" && refusal.trim()) {
    return NextResponse.json({ error: refusal.trim() }, { status: 422 });
  }

  const urls = extractImageUrlsFromAssistantMessage(message);

  if (!urls.length) {
    let text = "模型未返回图片，请缩短或简化描述后重试。";
    if (message && typeof message === "object" && "content" in message) {
      const c = (message as { content?: unknown }).content;
      if (typeof c === "string" && c.trim()) text = c.trim();
    }
    return NextResponse.json({ error: text }, { status: 422 });
  }

  const updated = await prisma.usageDay.upsert({
    where: { userId_day: { userId: user.id, day } },
    create: { userId: user.id, day, count: 1 },
    update: { count: { increment: 1 } },
  });

  return NextResponse.json({
    imageUrls: urls,
    quotaUsed: updated.count,
    quotaLimit: DAILY_FREE_LIMIT,
  });
  } catch (e) {
    console.error("POST /api/generate", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "服务器异常" },
      { status: 500 },
    );
  }
}
