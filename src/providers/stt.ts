import { z } from 'zod';
import type { SttResult } from '../types.js';
import { ServiceError, upstreamError } from '../errors.js';
export interface TranscribeInput { audio?: Buffer; filename?: string; mimeType?: string; language?: string; keyTerms: string[]; signal?: AbortSignal }
export interface SttProvider { transcribe(input: TranscribeInput): Promise<SttResult> }
export interface XaiSttOptions { apiKey:string; baseUrl:string; model:string; timeoutMs?:number; fetchImpl?:typeof fetch }
const responseSchema = z.object({ text:z.string().max(20000), language:z.string().optional(), duration:z.number().finite().nonnegative().optional(), words:z.array(z.object({text:z.string(),start:z.number(),end:z.number(),confidence:z.number().optional()})).optional() });
// xAI's documented language field controls formatting, NOT language detection.
// Chinese is not listed in its formatting table at the verified API version.
const formattingLanguages = new Set('ar cs da nl en fil fr de hi id it ja ko mk ms fa pl pt ro ru es sv th tr vi'.split(' '));
export class XaiSttProvider implements SttProvider {
  constructor(private readonly options:XaiSttOptions) {}
  async transcribe(input:TranscribeInput):Promise<SttResult> {
    if (!input.audio?.length) throw new ServiceError(400,'empty_audio');
    const form = new FormData();
    form.append('model',this.options.model);
    // Preserve the provider transcript for self-correction analysis and evaluation.
    form.append('format','false'); form.append('filler_words','true');
    if (input.language && formattingLanguages.has(input.language)) form.append('language',input.language);
    for (const term of [...new Set(input.keyTerms.map(t=>t.trim()))].filter(t=>t.length>0 && [...t].length<=50).slice(0,100)) form.append('keyterm',term);
    form.append('file',new Blob([new Uint8Array(input.audio)],{type:input.mimeType ?? 'application/octet-stream'}),input.filename ?? 'audio.wav');
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 45000);
    const signal = input.signal ? AbortSignal.any([timeout,input.signal]) : timeout;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.baseUrl.replace(/\/$/,'')+'/stt',{method:'POST',headers:{Authorization:'Bearer '+this.options.apiKey},body:form,signal});
      if (!response.ok) throw upstreamError(response.status);
      return responseSchema.parse(await response.json()); // Empty text is valid silence.
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(signal.aborted ? 504 : 502,signal.aborted ? 'provider_timeout' : 'invalid_stt_response');
    }
  }
}
export class UnconfiguredStt implements SttProvider {
  async transcribe():Promise<SttResult> { throw new ServiceError(503,'audio_requires_xai_api_key'); }
}
