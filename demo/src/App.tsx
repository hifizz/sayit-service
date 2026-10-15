import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, CopyIcon, MoonIcon, PaperclipIcon, SendIcon, SunIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Message, MessageContent } from "@/components/ui/message";
import { Response as ResponseText } from "@/components/ui/response";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { VoiceButton } from "@/components/ui/voice-button";
import {
  AudioPlayerButton,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerTime,
} from "@/components/ui/audio-player";
import { useRecorder, type RecordedClip } from "@/recorder";
import {
  checkReady,
  submitAudio,
  submitText,
  SayitError,
  type DictationResult,
  type SayitSettings,
} from "@/sayit";

const CONTEXT_TYPES = ["ai_prompt", "message", "email", "document", "other"] as const;

type Entry =
  | { kind: "user_text"; id: string; text: string }
  | { kind: "user_audio"; id: string; clip: RecordedClip }
  | { kind: "assistant"; id: string; result: DictationResult }
  | { kind: "error"; id: string; message: string; code: string; requestId: string | null };

let seq = 0;
const nextId = () => `${Date.now()}-${seq++}`;

export default function App() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    checkReady().then(setReady);
  }, []);

  // token 只存内存，刷新即失
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("demo");
  const [language, setLanguage] = useState("");
  const [contextType, setContextType] = useState<string>("ai_prompt");
  const [keyTermsRaw, setKeyTermsRaw] = useState("");
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, busy]);

  const settings: SayitSettings = useMemo(
    () => ({
      token: token.trim(),
      userId: userId.trim() || "demo",
      language: language.trim(),
      contextType,
      keyTerms: keyTermsRaw
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 100),
    }),
    [token, userId, language, contextType, keyTermsRaw]
  );

  const recorder = useRecorder(setError);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "processing" | "success" | "error">("idle");

  async function run(kind: "text" | "audio", work: () => Promise<DictationResult>) {
    if (!settings.token || settings.token.length < 32) {
      setError("请先填写服务 Token（SAYIT_SERVICE_TOKEN，至少 32 字符）");
      return;
    }
    setError(null);
    setBusy(true);
    if (kind === "audio") setVoiceState("processing");
    try {
      const result = await work();
      setEntries((prev) => [...prev, { kind: "assistant", id: nextId(), result }]);
      if (kind === "audio") {
        setVoiceState("success");
        setTimeout(() => setVoiceState("idle"), 1200);
      }
    } catch (e) {
      if (e instanceof SayitError) {
        setEntries((prev) => [
          ...prev,
          {
            kind: "error",
            id: nextId(),
            message: e.message,
            code: e.code,
            requestId: e.requestId,
          },
        ]);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (kind === "audio") {
        setVoiceState("error");
        setTimeout(() => setVoiceState("idle"), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setEntries((prev) => [...prev, { kind: "user_text", id: nextId(), text }]);
    await run("text", () => submitText(settings, text));
  }

  async function sendFile(file: File) {
    setEntries((prev) => [
      ...prev,
      { kind: "user_audio", id: nextId(), clip: { file, url: URL.createObjectURL(file), durationMs: 0 } },
    ]);
    await run("audio", () => submitAudio(settings, file));
  }

  async function onVoicePress() {
    if (voiceState === "idle") {
      setError(null);
      const ok = await recorder.start();
      if (ok) setVoiceState("recording");
    } else if (voiceState === "recording") {
      const clip = await recorder.stop();
      if (!clip) {
        setVoiceState("idle");
        return;
      }
      setEntries((prev) => [...prev, { kind: "user_audio", id: nextId(), clip }]);
      await run("audio", () => submitAudio(settings, clip.file));
    }
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <AudioPlayerProvider>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">SayIt Demo</h1>
            <p className="text-muted-foreground text-sm">
              语音 → 你本来想发的文字 · 本地链路测试页
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={ready === null ? "outline" : ready ? "secondary" : "destructive"}>
              {ready === null ? "检测中…" : ready ? "服务在线" : "服务离线"}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => setDark((d) => !d)} aria-label="切换主题">
              {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">连接设置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="token">服务 Token（.env 中的 SAYIT_SERVICE_TOKEN，仅存内存）</Label>
              <Input
                id="token"
                type="password"
                placeholder="至少 32 字符"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user">用户 ID（数据按此隔离）</Label>
              <Input id="user" value={userId} onChange={(e) => setUserId(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lang">语言（留空 = 不指定）</Label>
              <Input id="lang" placeholder="zh / en" value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Context 类型</Label>
              <Select value={contextType} onValueChange={setContextType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTEXT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="terms">Key terms（逗号/空格分隔，最多 100）</Label>
              <Input
                id="terms"
                placeholder="ThreadChat, E2B, PostgreSQL"
                value={keyTermsRaw}
                onChange={(e) => setKeyTermsRaw(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="text-destructive py-3 text-sm">{error}</CardContent>
          </Card>
        )}

        <Card className="flex min-h-[300px] flex-1 flex-col">
          <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto py-4">
            {entries.length === 0 && (
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm">
                <p>输入文字或录制音频，测试「转写 → 保守整理 → 语义检查」全链路。</p>
                <p className="text-xs">
                  mock 模式仅验证管线连通，不代表真实模型质量；本页不用于盲测评分。
                </p>
              </div>
            )}
            {entries.map((entry) => {
              if (entry.kind === "user_text") {
                return (
                  <Message key={entry.id} from="user">
                    <MessageContent>
                      <p className="whitespace-pre-wrap">{entry.text}</p>
                    </MessageContent>
                  </Message>
                );
              }
              if (entry.kind === "user_audio") {
                return (
                  <Message key={entry.id} from="user">
                    <MessageContent>
                      <div className="flex items-center gap-2">
                        <AudioPlayerButton
                          variant="secondary"
                          size="sm"
                          className="h-7 w-7 shrink-0 px-0"
                          item={{ id: entry.id, src: entry.clip.url }}
                        />
                        <AudioPlayerTime className="text-xs tabular-nums" />
                        <AudioPlayerProgress className="w-24" />
                        <span className="text-primary-foreground/70 truncate text-xs">
                          {entry.clip.file.name}
                          {entry.clip.durationMs ? ` · ${(entry.clip.durationMs / 1000).toFixed(1)}s` : ""}
                        </span>
                      </div>
                    </MessageContent>
                  </Message>
                );
              }
              if (entry.kind === "error") {
                return (
                  <div key={entry.id} className="text-destructive mx-auto max-w-[80%] text-center text-sm">
                    <p>请求失败：{entry.code}</p>
                    {entry.requestId && <p className="text-xs opacity-70">request_id: {entry.requestId}</p>}
                  </div>
                );
              }
              const { result } = entry;
              const guard = String(result.meta?.guard_status ?? "unknown");
              const latency = (result as DictationResult & { client_latency_ms?: number }).client_latency_ms;
              return (
                <Message key={entry.id} from="assistant">
                  <MessageContent className="w-[92%] sm:w-[85%]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {result.raw_transcript && result.raw_transcript !== result.text && (
                          <p className="text-muted-foreground mb-1 line-clamp-3 border-b pb-1 text-xs whitespace-pre-wrap">
                            ASR 原文：{result.raw_transcript}
                          </p>
                        )}
                        <ResponseText>{result.text || "（空转录）"}</ResponseText>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 px-0"
                        onClick={() => copy(result.text, entry.id)}
                        aria-label="复制"
                      >
                        {copied === entry.id ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge
                        variant={guard === "fallback" ? "destructive" : guard === "disabled" ? "outline" : "secondary"}
                      >
                        guard: {guard}
                      </Badge>
                      {latency != null && <Badge variant="outline">{latency} ms</Badge>}
                      {typeof result.meta?.duration === "number" && result.meta.duration > 0 && (
                        <Badge variant="outline">音频 {result.meta.duration.toFixed(1)}s</Badge>
                      )}
                      {Array.isArray(result.meta?.terms_applied) && result.meta.terms_applied.length > 0 && (
                        <Badge variant="outline">术语 ×{result.meta.terms_applied.length}</Badge>
                      )}
                      {Array.isArray(result.meta?.transformations) && result.meta.transformations.length > 0 && (
                        <Badge variant="outline">改写 ×{result.meta.transformations.length}</Badge>
                      )}
                    </div>
                    <details className="mt-2">
                      <summary className="text-muted-foreground cursor-pointer text-xs">
                        完整响应（id / output_sha256 / meta）
                      </summary>
                      <pre className="bg-muted/50 mt-1 overflow-x-auto rounded p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </details>
                  </MessageContent>
                </Message>
              );
            })}
            {busy && (
              <Message from="assistant">
                <MessageContent>
                  <ShimmeringText text="正在整理…" />
                  <Skeleton className="mt-2 h-3 w-48" />
                </MessageContent>
              </Message>
            )}
            <div ref={bottomRef} />
          </CardContent>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                placeholder="输入原始转写文本测试整理链路…（Enter 发送 / Shift+Enter 换行）"
                value={draft}
                rows={2}
                className="flex-1 resize-none"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendText();
                  }
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,.ogg,.opus,.flac,.aac,.mp4,.m4a,.mkv,.webm,audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void sendFile(file);
                }}
              />
              <Button
                variant="outline"
                size="icon"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                aria-label="上传音频文件"
              >
                <PaperclipIcon className="size-4" />
              </Button>
              <Button size="icon" disabled={busy || !draft.trim()} onClick={() => void sendText()} aria-label="发送">
                <SendIcon className="size-4" />
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <VoiceButton
                label={voiceState === "recording" ? "再次点击结束" : "口述"}
                state={voiceState}
                onPress={() => void onVoicePress()}
                className="min-w-[160px]"
                disabled={busy}
              />
              <span className="text-muted-foreground hidden text-xs sm:block">
                录音完成后自动提交（浏览器录音 → /v1/dictations）
              </span>
            </div>
          </div>
        </Card>

        <footer className="text-muted-foreground pb-4 text-center text-xs">
          Demo 仅用于本地链路测试，不构成质量或 Typeless parity 证据。Token 不落盘、不随请求日志外泄。
        </footer>
      </div>
    </AudioPlayerProvider>
  );
}
