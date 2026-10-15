/** SayIt API 客户端：token 只保留在内存中，不写 localStorage/cookie。 */

export interface SayitMeta {
  guard_status?: string;
  transformations?: string[];
  terms_applied?: string[];
  duration?: number;
  language?: string;
  policy_version?: string;
  prompt_hash?: string;
  processing_ms?: number;
  [key: string]: unknown;
}

export interface DictationResult {
  id: string;
  text: string;
  output_sha256: string;
  raw_transcript: string;
  meta: SayitMeta;
  created_at: string;
}

export class SayitError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId: string | null,
    public detail: string
  ) {
    super(`${code} (${status})`);
  }
}

export interface SayitSettings {
  token: string;
  userId: string;
  language: string;
  contextType: string;
  keyTerms: string[];
}

function headers(s: SayitSettings, extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${s.token}`,
    "x-sayit-user-id": s.userId,
    "idempotency-key": crypto.randomUUID(),
    ...extra,
  };
}

async function unwrap(res: Response): Promise<DictationResult> {
  if (!res.ok) {
    let code = `http_${res.status}`;
    let requestId: string | null = res.headers.get("x-request-id");
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string; request_id?: string };
      code = body.error ?? code;
      requestId = body.request_id ?? requestId;
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new SayitError(res.status, code, requestId, detail);
  }
  return (await res.json()) as DictationResult;
}

export async function submitText(
  s: SayitSettings,
  rawTranscript: string
): Promise<DictationResult> {
  const started = performance.now();
  const res = await fetch("/v1/dictations/text", {
    method: "POST",
    headers: headers(s, { "content-type": "application/json" }),
    body: JSON.stringify({
      raw_transcript: rawTranscript,
      context: { type: s.contextType },
      language: s.language || undefined,
      key_terms: s.keyTerms.length ? s.keyTerms : undefined,
    }),
  });
  const result = await unwrap(res);
  (result as DictationResult & { client_latency_ms?: number }).client_latency_ms =
    Math.round(performance.now() - started);
  return result;
}

export async function submitAudio(
  s: SayitSettings,
  file: File
): Promise<DictationResult> {
  const started = performance.now();
  const form = new FormData();
  form.append("file", file, file.name);
  if (s.contextType) form.append("context", JSON.stringify({ type: s.contextType }));
  if (s.language) form.append("language", s.language);
  if (s.keyTerms.length) form.append("key_terms", JSON.stringify(s.keyTerms));
  const res = await fetch("/v1/dictations", {
    method: "POST",
    headers: headers(s),
    body: form,
  });
  const result = await unwrap(res);
  (result as DictationResult & { client_latency_ms?: number }).client_latency_ms =
    Math.round(performance.now() - started);
  return result;
}

export async function checkReady(): Promise<boolean> {
  try {
    const res = await fetch("/ready", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
