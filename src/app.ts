import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import type { JsonLlm } from './providers/llm.js';
import type { SttProvider } from './providers/stt.js';
import type { Storage } from './storage/types.js';
import { DictationService } from './domain/dictation-service.js';
import { FeedbackService } from './domain/feedback-service.js';

export interface AppDependencies {
  storage: Storage;
  stt: SttProvider;
  llm: JsonLlm;
  semanticGuardEnabled: boolean;
  enableDebugRoutes: boolean;
  maxAudioBytes: number;
  logger?: boolean | Record<string, unknown>;
}

const contextSchema = z.object({
  type: z.enum(['ai_prompt', 'message', 'email', 'document', 'other']).optional(),
  app: z.string().optional(),
  projectId: z.string().optional(),
  surroundingText: z.string().max(20000).optional(),
  selectedText: z.string().max(20000).optional()
}).optional();

const jsonDictationSchema = z.object({
  user_id: z.string().min(1),
  audio_url: z.string().url(),
  language: z.string().optional(),
  context: contextSchema,
  key_terms: z.array(z.string()).max(100).optional()
});

function parseJsonField<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

export function buildApp(deps: AppDependencies) {
  const app = Fastify({ logger: deps.logger ?? false });
  const dictations = new DictationService(
    deps.stt,
    deps.llm,
    deps.storage,
    { semanticGuardEnabled: deps.semanticGuardEnabled }
  );
  const feedback = new FeedbackService(deps.llm, deps.storage);

  app.register(multipart, {
    limits: {
      fileSize: deps.maxAudioBytes,
      files: 1,
      fields: 20
    }
  });

  app.get('/health', async () => ({
    ok: true,
    storage: deps.storage.constructor.name
  }));

  app.post('/v1/dictations', async (request, reply) => {
    let input: {
      userId: string;
      audio?: Buffer;
      audioUrl?: string;
      filename?: string;
      mimeType?: string;
      language?: string;
      context?: any;
      extraKeyTerms?: string[];
    };

    if (request.isMultipart()) {
      const fields: Record<string, string[]> = {};
      let audio: Buffer | undefined;
      let filename: string | undefined;
      let mimeType: string | undefined;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename;
          mimeType = part.mimetype;
        } else {
          const value = String(part.value);
          fields[part.fieldname] = [...(fields[part.fieldname] || []), value];
        }
      }

      const userId = fields.user_id?.[0];
      if (!userId) return reply.code(400).send({ error: 'user_id is required' });
      if (!audio) return reply.code(400).send({ error: 'audio file is required' });

      let context: any;
      let keyTerms: string[] = [];
      try {
        context = contextSchema.parse(parseJsonField(fields.context?.[0], undefined));
        keyTerms = fields.key_terms
          ? fields.key_terms.flatMap((value) => {
              try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
              } catch {
                return [value];
              }
            })
          : [];
      } catch (error) {
        return reply.code(400).send({ error: 'invalid context or key_terms', detail: String(error) });
      }

      input = {
        userId,
        audio,
        filename,
        mimeType,
        language: fields.language?.[0],
        context,
        extraKeyTerms: keyTerms
      };
    } else {
      const body = jsonDictationSchema.parse(request.body);
      input = {
        userId: body.user_id,
        audioUrl: body.audio_url,
        language: body.language,
        context: body.context,
        extraKeyTerms: body.key_terms
      };
    }

    const record = await dictations.create(input);
    return reply.code(201).send({
      id: record.id,
      text: record.outputText,
      raw_transcript: record.rawTranscript,
      meta: {
        language: record.language,
        duration: record.duration,
        terms_applied: record.appliedTerms,
        guard_status: record.guardStatus
      }
    });
  });

  app.post('/v1/dictations/:id/feedback', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ final_text: z.string() }).parse(request.body);
    try {
      const result = await feedback.submit(params.id, body.final_text);
      return {
        ok: true,
        learned_vocabulary: result.learnedVocabulary,
        corrections: result.corrections.map((item) => ({
          type: item.type,
          before: item.before,
          after: item.after,
          confidence: item.confidence,
          learned: item.learn
        }))
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Dictation not found') {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/vocabulary', async (request) => {
    const query = z.object({ user_id: z.string().min(1) }).parse(request.query);
    const items = await deps.storage.listVocabulary(query.user_id);
    return { items };
  });

  app.post('/v1/vocabulary', async (request, reply) => {
    const body = z.object({
      user_id: z.string().min(1),
      canonical: z.string().min(1).max(50),
      aliases: z.array(z.string().min(1).max(80)).max(20).optional()
    }).parse(request.body);

    const item = await deps.storage.upsertVocabulary({
      userId: body.user_id,
      canonical: body.canonical,
      aliases: body.aliases,
      source: 'manual',
      confidence: 1
    });
    return reply.code(201).send(item);
  });

  app.delete('/v1/vocabulary/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({ user_id: z.string().min(1) }).parse(request.query);
    const deleted = await deps.storage.deleteVocabulary(query.user_id, params.id);
    if (!deleted) return reply.code(404).send({ error: 'Vocabulary entry not found' });
    return reply.code(204).send();
  });

  if (deps.enableDebugRoutes) {
    app.post('/v1/debug/rewrite', async (request) => {
      const body = z.object({
        user_id: z.string().min(1),
        raw_transcript: z.string().min(1),
        context: contextSchema
      }).parse(request.body);
      return dictations.rewriteText({
        userId: body.user_id,
        rawTranscript: body.raw_transcript,
        context: body.context
      });
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_request', issues: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  });

  app.addHook('onClose', async () => {
    await deps.storage.close?.();
  });

  return app;
}
