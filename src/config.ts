import { z } from 'zod';
const schema=z.object({
  NODE_ENV:z.string().default('development'),SAYIT_MODE:z.enum(['mock','live']).default('mock'),
  SAYIT_SERVICE_TOKEN:z.string().min(32),DATABASE_URL:z.string().optional(),
  HOST:z.string().default('127.0.0.1'),PORT:z.coerce.number().int().min(1).max(65535).default(8787),
  XAI_API_KEY:z.string().optional(),XAI_BASE_URL:z.string().url().default('https://api.x.ai/v1'),XAI_STT_MODEL:z.string().default('grok-voice-transcribe-2.0'),
  LLM_API_KEY:z.string().optional(),LLM_BASE_URL:z.string().url().default('https://api.x.ai/v1'),LLM_MODEL:z.string().default('glm-5.3-flash'),LLM_JSON_MODE:z.enum(['json_object','json_schema']).default('json_object'),
  RETENTION_HOURS:z.coerce.number().int().min(1).max(8760).default(168),MAX_AUDIO_BYTES:z.coerce.number().int().min(1024).max(52428800).default(26214400),
  MAX_REQUESTS_PER_MINUTE:z.coerce.number().int().min(1).max(1000).default(60),MAX_CONCURRENT:z.coerce.number().int().min(1).max(100).default(16)
});
export function loadConfig(env:NodeJS.ProcessEnv=process.env){
  const config=schema.parse(env);
  if(/replace|change-me|example/i.test(config.SAYIT_SERVICE_TOKEN))throw new Error('Generate a random SAYIT_SERVICE_TOKEN; do not use the example token');
  if(config.NODE_ENV==='production'&&!config.DATABASE_URL)throw new Error('Production requires DATABASE_URL; memory storage is volatile');
  if(config.SAYIT_MODE==='live'&&(!config.XAI_API_KEY||!(config.LLM_API_KEY||config.XAI_API_KEY)))throw new Error('Live mode requires XAI_API_KEY and an LLM key');\n  if(config.SAYIT_MODE==='live'&&config.LLM_MODEL==='glm-5.3-flash'&&/api\\.x\\.ai$/i.test(new URL(config.LLM_BASE_URL).hostname))throw new Error('glm-5.3-flash requires LLM_BASE_URL to point at your OpenAI-compatible relay, not xAI');
  return config;
}
