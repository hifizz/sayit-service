import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryStorage } from '../src/storage/memory.js';
import { PostgresStorage } from '../src/storage/postgres.js';
import type { Storage } from '../src/storage/types.js';
import { DictationService } from '../src/domain/dictation-service.js';
import { OpenAiCompatibleLlm } from '../src/providers/llm.js';
import { FakeLlm, FakeStt, makeApp, headers } from './helpers.js';

async function expirationCase(storage: Storage, user: string) {
  try {
    const old = await new DictationService(new FakeStt(), new FakeLlm(), new MemoryStorage(), { semanticGuardEnabled: true }).create({ userId: user, rawTranscript: 'old', requestKey: 'expired-key-001' });
    old.createdAt = new Date(Date.now() - 200 * 3600000).toISOString();
    await storage.transaction(user, tx => tx.createDictation(old));
    const fresh = await storage.transaction(user, tx => new DictationService(new FakeStt(), new FakeLlm(), tx, { semanticGuardEnabled: true }).create({ userId: user, rawTranscript: 'new', requestKey: 'expired-key-001' }));
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.outputText).toBe('new');
    expect(await storage.getDictation(user, old.id)).toBeNull();
  } finally {
    await storage.transaction(user, tx => tx.deleteUserData(user));
    await storage.close();
  }
}
async function restoreCase(storage: Storage, user: string) {
  try {
    const old = await storage.transaction(user, tx => tx.upsertVocabulary({ userId: user, canonical: 'ThreadChat', aliases: ['wrong-alias'], source: 'manual' }));
    await storage.transaction(user, tx => tx.deleteVocabulary(user, old.id));
    const restored = await storage.transaction(user, tx => tx.upsertVocabulary({ userId: user, canonical: 'ThreadChat', aliases: ['thread chat'], source: 'manual' }));
    expect(restored.id).toBe(old.id);
    expect(restored.status).toBe('active');
    expect(restored.aliases).toEqual(['thread chat']);
  } finally {
    await storage.transaction(user, tx => tx.deleteUserData(user));
    await storage.close();
  }
}
describe('retention and vocabulary repair', () => {
  it('reuses an expired idempotency key without waiting for purge (memory)', () => expirationCase(new MemoryStorage(), 'u'));
  it('manual restore removes obsolete aliases (memory)', () => restoreCase(new MemoryStorage(), 'u'));
  it.skipIf(!process.env.TEST_DATABASE_URL)('reuses expired idempotency keys (PostgreSQL)', () => expirationCase(new PostgresStorage(process.env.TEST_DATABASE_URL!), 'expiry_' + randomUUID()));
  it.skipIf(!process.env.TEST_DATABASE_URL)('manual restore removes obsolete aliases (PostgreSQL)', () => restoreCase(new PostgresStorage(process.env.TEST_DATABASE_URL!), 'restore_' + randomUUID()));
});
describe('provider boundaries', () => {
  it('reports invalid model feedback as 502 and permits a safe retry', async () => {
    const llm = new FakeLlm(); const { app, storage } = makeApp({ llm });
    try {
      const d = (await app.inject({ method: 'POST', url: '/v1/dictations/text', headers: headers(), payload: { raw_transcript: '用 foo。' } })).json();
      llm.handler = () => ({ invalid: true });
      const response = await app.inject({ method: 'POST', url: `/v1/dictations/${d.id}/feedback`, headers: headers(), payload: { event_id: randomUUID(), output_sha256: d.output_sha256, final_text: '用 Foo。', attribution: 'dictation_span' } });
      expect(response.statusCode).toBe(502);
      expect(response.json().error).toBe('invalid_feedback_response');
      expect((await storage.getDictation('user_a', d.id))!.feedback).toBeUndefined();
      expect(await storage.listVocabulary('user_a')).toEqual([]);
    } finally { await app.close(); }
  });
  it.each([
    ['https://api.x.ai/v1', 'grok-4.6', 'low'],
    ['https://provider.test/v1', 'generic-model', undefined]
  ])('uses only supported reasoning controls for %s / %s', async (baseUrl, model, effort) => {
    let body: Record<string, unknown> = {};
    const llm = new OpenAiCompatibleLlm({ apiKey: 'fixture', baseUrl: baseUrl!, model: model!, fetchImpl: (async (_url, init) => { body = JSON.parse(init!.body as string); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }); }) as typeof fetch });
    await llm.generateJson({ system: 'test', user: '{}', schemaName: 'fixture', schema: { type: 'object' } });
    expect(body.reasoning_effort).toBe(effort);
  });
});
