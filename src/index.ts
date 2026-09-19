import { config } from './config.js';
import { buildApp } from './app.js';
import { XaiSttProvider } from './providers/stt.js';
import { OpenAiCompatibleLlm } from './providers/llm.js';
import { createStorage } from './storage/index.js';

if (!config.XAI_API_KEY) {
  throw new Error('XAI_API_KEY is required to run the service');
}
if (!config.llmApiKey) {
  throw new Error('LLM_API_KEY or XAI_API_KEY is required to run the service');
}

const storage = createStorage(config);
const stt = new XaiSttProvider({
  apiKey: config.XAI_API_KEY,
  baseUrl: config.XAI_STT_BASE_URL,
  model: config.XAI_STT_MODEL
});
const llm = new OpenAiCompatibleLlm({
  apiKey: config.llmApiKey,
  baseUrl: config.LLM_BASE_URL,
  model: config.LLM_MODEL
});

const app = buildApp({
  storage,
  stt,
  llm,
  semanticGuardEnabled: config.SEMANTIC_GUARD_ENABLED,
  enableDebugRoutes: config.ENABLE_DEBUG_ROUTES,
  maxAudioBytes: config.MAX_AUDIO_BYTES,
  logger: { level: config.LOG_LEVEL }
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
