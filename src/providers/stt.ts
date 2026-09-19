import type { SttResult } from '../types.js';

export interface TranscribeInput {
  audio?: Buffer;
  audioUrl?: string;
  filename?: string;
  mimeType?: string;
  language?: string;
  keyTerms: string[];
}

export interface SttProvider {
  transcribe(input: TranscribeInput): Promise<SttResult>;
}

interface XaiSttOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class XaiSttProvider implements SttProvider {
  constructor(private readonly options: XaiSttOptions) {}

  async transcribe(input: TranscribeInput): Promise<SttResult> {
    if (!input.audio && !input.audioUrl) {
      throw new Error('Either audio or audioUrl is required');
    }

    const form = new FormData();
    form.append('model', this.options.model);
    form.append('format', 'true');
    form.append('filler_words', 'false');
    if (input.language) form.append('language', input.language);

    for (const term of input.keyTerms.slice(0, 100)) {
      const normalized = term.trim().slice(0, 50);
      if (normalized) form.append('keyterm', normalized);
    }

    if (input.audioUrl) {
      form.append('url', input.audioUrl);
    } else if (input.audio) {
      const blob = new Blob([input.audio], { type: input.mimeType || 'application/octet-stream' });
      // xAI requires the file field to be appended after all option fields.
      form.append('file', blob, input.filename || 'audio.webm');
    }

    const response = await fetch(this.options.baseUrl.replace(/\/$/, '') + '/stt', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.options.apiKey },
      body: form
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error('xAI STT error ' + response.status + ': ' + body.slice(0, 1000));
    }

    const result = await response.json() as SttResult;
    if (!result.text || typeof result.text !== 'string') {
      throw new Error('xAI STT returned an invalid response');
    }
    return result;
  }
}
