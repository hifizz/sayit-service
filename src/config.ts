import 'dotenv/config';
import { z } from 'zod';

const bool = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.string().default('info'),
  XAI_API_KEY: z.string().optional(),
  XAI_STT_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
  XAI_STT_MODEL: z.string().default('grok-voice-transcribe-2.0'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
  LLM_MODEL: z.string().default('grok-4.6'),
  DATABASE_URL: z.string().optional(),
  SEMANTIC_GUARD_ENABLED: bool.default(true),
  ENABLE_DEBUG_ROUTES: bool.default(false),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024)
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  llmApiKey: parsed.LLM_API_KEY || parsed.XAI_API_KEY
};

export type AppConfig = typeof config;
