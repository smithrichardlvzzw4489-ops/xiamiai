import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/get-session-user";
import { DAILY_FREE_LIMIT, utcDayString } from "@/lib/usage";

export const runtime = "nodejs";

const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_IMAGE_MODEL = "openai/gpt-5.4-image-2";

/**
 * Fetch header values are ByteString (Latin-1 only per char code ≤ 255).
 * Chinese in e.g. X-Title throws: "Cannot convert argument to a ByteString…".
 */
function headerValueOrAsciiFallback(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  if (!v) return fallback;
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) > 255) return fallback;
  }
  return v;
}

/** Walk raw API JSON: SDK Zod schemas strip unknown keys (e.g. `images`), so we use untyped JSON + deep walk. */
function deepCollectImageUrls(node: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<unknown>();

  function addUrl(s: string) {
    const t = s.trim();
    if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("data:image")) {
      urls.push(t);
    }
  }

  function walk(n: unknown): void {
    if (n == null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);

    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }

    const o = n as Record<string, unknown>;

    if (o.type === "image_url") {
      const wrap = o.image_url ?? o.imageUrl;
      if (wrap && typeof wrap === "object" && typeof (wrap as Record<string, unknown>).url === "string") {
        addUrl(String((wrap as Record<string, unknown>).url));
      }
    }

    for (const [k, v] of Object.entries(o)) {
      if ((k === "image_url" || k === "imageUrl") && v != null && typeof v === "object") {
        const u = (v as Record<string, unknown>).url;
        if (typeof u === "string") addUrl(u);
      }
      walk(v);
    }
  }

  walk(node);
  return [...new Set(urls)];
}

function collectImageUrlsFromMessage(message: unknown): string[] {
  const fromDeep = deepCollectImageUrls(message);
  if (fromDeep.length) return fromDeep;

  if (message && typeof message === "object" && "content" in message) {
    const c = (message as { content?: unknown }).content;
    if (typeof c === "string") {
      const urls: string[] = [];
      const md = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = md.exec(c)) !== null) {
        urls.push(match[1]);
      }
      if (c.startsWith("data:image") && c.includes(";base64,")) {
        urls.push(c.trim().split(/\s/)[0]);
      }
      return [...new Set(urls)];
    }
  }

  return [];
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

  const base = (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE).replace(/\/$/, "");
  const chatUrl = `${base}/chat/completions`;
  const model = process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;

  let result: unknown;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 280_000);
    let res: Response;
    try {
      res = await fetch(chatUrl, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": headerValueOrAsciiFallback(
            process.env.OPENROUTER_HTTP_REFERER,
            "https://www.xiami.club",
          ),
          "X-Title": headerValueOrAsciiFallback(process.env.OPENROUTER_APP_TITLE, "Xiami AI"),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: parsed.data.prompt }],
          modalities: ["image", "text"],
        }),
      });
    } finally {
      clearTimeout(t);
    }

    const raw = await res.text();
    try {
      result = JSON.parse(raw) as unknown;
    } catch {
      return NextResponse.json(
        { error: `OpenRouter 返回非 JSON（HTTP ${res.status}）` },
        { status: 502 },
      );
    }

    if (!res.ok) {
      const errMsg =
        result &&
        typeof result === "object" &&
        "error" in result &&
        (result as { error?: { message?: string } }).error?.message;
      return NextResponse.json(
        { error: typeof errMsg === "string" ? errMsg : `OpenRouter 错误 HTTP ${res.status}` },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }
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

  const urls = collectImageUrlsFromMessage(message);

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
