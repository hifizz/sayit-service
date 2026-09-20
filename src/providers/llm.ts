import { ServiceError, upstreamError } from '../errors.js';
export interface JsonRequest { system: string; user: string; schemaName: string; schema: Record<string, unknown>; temperature?: number; signal?: AbortSignal }
export interface JsonLlm { generateJson<T>(input: JsonRequest): Promise<T> }
export interface LlmOptions {
  apiKey: string; baseUrl: string; model: string; timeoutMs?: number;
  jsonMode?: 'json_object' | 'json_schema'; fetchImpl?: typeof fetch;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
}
export class OpenAiCompatibleLlm implements JsonLlm {
  constructor(private readonly options: LlmOptions) {}
  async generateJson<T>(input: JsonRequest): Promise<T> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30000);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    const structured = this.options.jsonMode === 'json_schema';
    const host = new URL(this.options.baseUrl).hostname;
    // Grok 4.5/4.6 default to high reasoning. Dictation explicitly chooses low;
    // do not send provider-specific parameters to arbitrary compatible models.
    const nativeGrok = (host === 'api.x.ai' || host === 'us.api.x.ai') && /^grok-4\.[56]$/.test(this.options.model);
    const effort = this.options.reasoningEffort ?? (nativeGrok ? 'low' : undefined);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: 'Bearer ' + this.options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          temperature: input.temperature ?? (effort ? undefined : 0),
          reasoning_effort: effort,
          max_tokens: 8192,
          messages: [
            { role: 'system', content: input.system + '\nRequired JSON schema: ' + JSON.stringify(input.schema) },
            { role: 'user', content: input.user }
          ],
          response_format: structured
            ? { type: 'json_schema', json_schema: { name: input.schemaName, strict: true, schema: input.schema } }
            : { type: 'json_object' }
        })
      });
      if (!response.ok) throw upstreamError(response.status);
      const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
      const choice = body.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || choice?.finish_reason === 'length' || content.length > 100000) throw new ServiceError(502, 'invalid_provider_json');
      return JSON.parse(content) as T; // Domain code MUST runtime-validate the parsed object.
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(signal.aborted ? 504 : 502, signal.aborted ? 'provider_timeout' : 'invalid_provider_json');
    }
  }
}
/** Offline wiring only: intentionally does not imitate intelligent cleanup. */
export class PassthroughLlm implements JsonLlm {
  async generateJson<T>(input: JsonRequest): Promise<T> {
    const data = JSON.parse(input.user) as { raw?: string; spans?: unknown[] };
    if (input.schemaName.startsWith('sayit_rewrite')) return { final_text: data.raw ?? '', applied_terms: [], transformations: ['mock_passthrough'] } as T;
    if (input.schemaName === 'sayit_feedback') return { items: (data.spans ?? []).map((_, i) => ({ span_index: i, type: 'UNKNOWN', confidence: 0, reason: 'mock' })), style: { verbosity: null, formality: null, bulletPreference: null } } as T;
    throw new ServiceError(503, 'mock_cannot_judge_semantics');
  }
}
