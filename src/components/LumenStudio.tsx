"use client";

import type { MeState } from "@/lib/me-state";
import { parseFetchJson } from "@/lib/parse-fetch-json";
import { useCallback, useEffect, useRef, useState } from "react";

type Me = MeState;

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  imageUrls?: string[];
  pending?: boolean;
  error?: boolean;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const authFieldClass =
  "w-full rounded-lg border border-white/[0.12] bg-zinc-900/70 px-3 py-2.5 text-sm text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none placeholder:text-zinc-600 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15";

export function LumenStudio({ initialMe }: { initialMe: Me }) {
  const [me, setMe] = useState<Me | null>(initialMe);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshMe = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const { httpOk, json } = await parseFetchJson(r);
    if (!httpOk) return;
    setMe(json as unknown as Me);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setMessages([]);
    void refreshMe();
  };

  const register = async () => {
    setAuthErr(null);
    if (password !== password2) {
      setAuthErr("两次输入的密码不一致");
      return;
    }
    setAuthBusy(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const { httpOk, errorMessage } = await parseFetchJson(r);
      if (!httpOk) {
        setAuthErr(errorMessage ?? "注册失败");
        return;
      }
      setAuthOpen(false);
      setEmail("");
      setPassword("");
      setPassword2("");
      void refreshMe();
    } finally {
      setAuthBusy(false);
    }
  };

  const login = async () => {
    setAuthErr(null);
    setAuthBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const { httpOk, errorMessage } = await parseFetchJson(r);
      if (!httpOk) {
        setAuthErr(errorMessage ?? "登录失败");
        return;
      }
      setAuthOpen(false);
      setEmail("");
      setPassword("");
      void refreshMe();
    } finally {
      setAuthBusy(false);
    }
  };

  const sendImage = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;
    if (!me?.user) {
      setAuthOpen(true);
      return;
    }
    const used = me.quota?.used ?? 0;
    const limit = me.quota?.limit ?? 5;
    if (used >= limit) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: `今日 ${limit} 次免费额度已用尽，UTC 日切后自动恢复。`,
          error: true,
        },
      ]);
      return;
    }

    const userMsg: ChatMsg = { id: uid(), role: "user", text: prompt };
    const pending: ChatMsg = { id: uid(), role: "assistant", pending: true };
    setMessages((m) => [...m, userMsg, pending]);
    setInput("");
    setSending(true);

    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const { httpOk, errorMessage, json: j } = await parseFetchJson(r);
      setMessages((m) => {
        const next = [...m];
        const i = next.findIndex((x) => x.id === pending.id);
        if (i === -1) return m;
        if (!httpOk) {
          next[i] = {
            id: pending.id,
            role: "assistant",
            text: errorMessage ?? "请求失败",
            error: true,
          };
          return next;
        }
        next[i] = {
          id: pending.id,
          role: "assistant",
          text: "已根据你的描述生成画面。",
          imageUrls: j.imageUrls as string[],
        };
        return next;
      });
      if (httpOk && typeof j.quotaUsed === "number") {
        setMe((prev) =>
          prev?.user
            ? {
                ...prev,
                quota: {
                  used: j.quotaUsed as number,
                  limit: (j.quotaLimit as number) ?? limit,
                  day: prev.quota?.day ?? "",
                },
              }
            : prev,
        );
        void refreshMe();
      }
    } catch {
      setMessages((m) => {
        const next = [...m];
        const i = next.findIndex((x) => x.id === pending.id);
        if (i >= 0) {
          next[i] = {
            id: pending.id,
            role: "assistant",
            text: "网络异常，请稍后重试。",
            error: true,
          };
        }
        return next;
      });
    } finally {
      setSending(false);
    }
  };

  const quotaLabel =
    me?.user && me.quota
      ? `${me.quota.used}/${me.quota.limit}`
      : me?.user
        ? "—"
        : null;

  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(56,189,248,0.25), transparent 55%), radial-gradient(ellipse 70% 50% at 100% 0%, rgba(167,139,250,0.2), transparent 45%), radial-gradient(ellipse 60% 40% at 0% 100%, rgba(34,211,238,0.12), transparent 50%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 75%)",
          maskImage: "radial-gradient(ellipse at center, black, transparent 75%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_24px_rgba(34,211,238,0.25)]">
            <span className="font-mono text-sm font-semibold tracking-tight text-cyan-200">隙</span>
          </div>
          <div>
            <h1 className="text-sm font-medium tracking-[0.2em] text-zinc-100">隙光</h1>
            <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Image lab</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {me?.user ? (
            <>
              <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-zinc-300 backdrop-blur sm:block">
                今日额度 <span className="text-cyan-300">{quotaLabel}</span>
              </div>
              <span className="max-w-[140px] truncate text-xs text-zinc-500">{me.user.email}</span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/20 hover:text-white"
              >
                退出
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAuthErr(null);
                setCodeSent(false);
                setMailTip(null);
                setAuthOpen(true);
              }}
              className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.15)] transition hover:bg-cyan-500/20"
            >
              登录 / 注册
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center px-4 pb-8 pt-2 sm:px-6">
        <div className="flex w-full max-w-2xl flex-1 flex-col rounded-2xl border border-white/[0.08] bg-zinc-950/40 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset,0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="border-b border-white/[0.06] px-5 py-3">
            <p className="text-center text-[11px] font-mono tracking-[0.25em] text-zinc-500">DIALOGUE</p>
            <p className="text-center text-xs text-zinc-400">用一句话召唤画面 · 每位注册用户每日 5 次免费</p>
          </div>

          <div
            ref={listRef}
            className="scrollbar-thin flex max-h-[min(52vh,520px)] min-h-[220px] flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6"
          >
            {messages.length === 0 && (
              <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
                <div className="h-px w-16 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
                <p className="text-sm leading-relaxed text-zinc-400">
                  在下方输入你的想象：光影、材质、镜头与情绪。模型将返回可预览的图像链接。
                </p>
                {!me?.user && (
                  <p className="text-xs text-zinc-600">开始使用前请先完成邮箱注册或登录。</p>
                )}
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[85%] ${
                    msg.role === "user"
                      ? "border border-white/10 bg-white/[0.06] text-zinc-100"
                      : msg.error
                        ? "border border-red-500/20 bg-red-950/30 text-red-200/90"
                        : "border border-cyan-500/15 bg-cyan-950/20 text-zinc-200"
                  }`}
                >
                  {msg.pending ? (
                    <div className="flex items-center gap-2 font-mono text-xs text-cyan-200/80">
                      <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                      生成中…
                    </div>
                  ) : (
                    <>
                      {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                      {msg.imageUrls?.map((url) => (
                        <div key={url} className="mt-3 overflow-hidden rounded-xl border border-white/10">
                          {/* Remote signed URLs from the model; native img avoids host allowlist churn. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="生成结果"
                            className="max-h-[360px] w-full object-contain bg-black/40"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/[0.06] p-4 sm:p-5">
            <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/30 p-2 sm:flex-row sm:items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void sendImage();
                  }
                }}
                rows={3}
                placeholder="例如：赛博朋克雨夜中的霓虹巷口，电影级景深，体积光…"
                className="min-h-[88px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <button
                type="button"
                disabled={sending || !input.trim()}
                onClick={() => void sendImage()}
                className="shrink-0 rounded-lg bg-gradient-to-br from-cyan-500/90 to-violet-600/90 px-5 py-3 text-sm font-medium text-white shadow-[0_0_24px_rgba(34,211,238,0.2)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? "生成中" : "生成"}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] font-mono text-zinc-600">Ctrl / ⌘ + Enter 快速发送</p>
          </div>
        </div>
      </main>

      {authOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/90 p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-6 flex gap-2 rounded-lg bg-black/40 p-1">
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setAuthTab(t);
                    setAuthErr(null);
                    setPassword("");
                    setPassword2("");
                  }}
                  className={`flex-1 rounded-md py-2 text-xs font-medium transition ${
                    authTab === t
                      ? "bg-white/10 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {authTab === "login" ? (
                <>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    邮箱
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={authFieldClass}
                  />
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    密码
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={authFieldClass}
                  />
                </>
              ) : (
                <>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    邮箱
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className={authFieldClass}
                  />
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    密码
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 8 位"
                    className={authFieldClass}
                  />
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    确认密码
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    placeholder="再次输入密码"
                    className={authFieldClass}
                  />
                </>
              )}
              {authErr && <p className="text-xs text-red-300/90">{authErr}</p>}
            </div>
            <div className="mt-6 flex flex-col gap-2">
              {authTab === "register" ? (
                <button
                  type="button"
                  disabled={
                    authBusy || !email.trim() || password.length < 8 || password2.length < 8
                  }
                  onClick={() => void register()}
                  className="w-full rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-700 py-2.5 text-sm font-medium text-white shadow-lg shadow-cyan-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {authBusy ? "注册中…" : "注册"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void login()}
                  className="w-full rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-700 py-2.5 text-sm font-medium text-white shadow-lg shadow-cyan-900/30 transition hover:brightness-110 disabled:opacity-50"
                >
                  {authBusy ? "登录中…" : "登录"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setAuthOpen(false);
                }}
                className="py-2 text-xs text-zinc-500 hover:text-zinc-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
