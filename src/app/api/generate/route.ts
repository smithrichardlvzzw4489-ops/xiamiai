import { OpenRouter } from "@openrouter/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/get-session-user";
import { DAILY_FREE_LIMIT, utcDayString } from "@/lib/usage";

export const runtime = "nodejs";

type ImageChatResult = {
  choices: Array<{
    message?: {
      images?: { image_url?: { url?: string } }[];
      content?: string | unknown;
    };
  }>;
};

const bodySchema = z.object({
  prompt: z.string().min(1).max(4000),
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

  let result: ImageChatResult;
  try {
    result = (await openrouter.chat.send({
      model: "openai/gpt-5.4-image-2",
      messages: [
        {
          role: "user",
          content: parsed.data.prompt,
        },
      ],
      modalities: ["image", "text"],
    } as never)) as ImageChatResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "生成失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const message = result.choices[0]?.message;

  const urls: string[] = [];
  if (message?.images?.length) {
    for (const image of message.images) {
      const u = image.image_url?.url;
      if (u) urls.push(u);
    }
  }

  if (!urls.length) {
    const text =
      typeof message?.content === "string"
        ? message.content
        : "模型未返回图片，请调整描述后重试。";
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
