import { randomUUID } from 'node:crypto';
import type { JsonLlm } from '../providers/llm.js';
import type { SttProvider } from '../providers/stt.js';
import type { Storage } from '../storage/types.js';
import type {
  DictationContext,
  DictationRecord,
  GuardResult,
  RewriteResult,
  VocabularyEntry
} from '../types.js';
import {
  CONSERVATIVE_REWRITE_SUFFIX,
  GUARD_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT
} from '../prompts.js';
import { guardSchema, rewriteSchema } from './schemas.js';
import {
  formatPersonalization,
  relevantCorrections,
  selectKeyTerms
} from './personalization.js';

interface CreateDictationInput {
  userId: string;
  audio?: Buffer;
  audioUrl?: string;
  filename?: string;
  mimeType?: string;
  language?: string;
  context?: DictationContext;
  extraKeyTerms?: string[];
}

interface ServiceOptions {
  semanticGuardEnabled: boolean;
}

interface RewritePayload {
  final_text: string;
  applied_terms: string[];
  transformations: string[];
}

interface GuardPayload {
  safe: boolean;
  answered_user: boolean;
  added_facts: boolean;
  dropped_essential_meaning: boolean;
  modal_strengthened: boolean;
  reason: string;
}

function fallbackWithVocabulary(raw: string, vocabulary: VocabularyEntry[]): string {
  let text = raw;
  const candidates = vocabulary
    .flatMap((entry) => entry.aliases.map((alias) => ({ alias, canonical: entry.canonical })))
    .filter((pair) => pair.alias && pair.alias !== pair.canonical)
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const pair of candidates) {
    if (pair.alias.length < 2) continue;
    const escaped = pair.alias.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'giu'), pair.canonical);
  }
  return text;
}

function buildRewriteUser(input: {
  raw: string;
  context?: DictationContext;
  personalization: string;
}): string {
  return [
    'RAW TRANSCRIPT:',
    input.raw,
    '',
    'CONTEXT:',
    JSON.stringify(input.context || { type: 'other' }),
    '',
    input.personalization,
    '',
    'Rewrite this transcript into ready-to-send text while obeying all hard invariants.'
  ].join('\n');
}

export class DictationService {
  constructor(
    private readonly stt: SttProvider,
    private readonly llm: JsonLlm,
    private readonly storage: Storage,
    private readonly options: ServiceOptions
  ) {}

  async create(input: CreateDictationInput): Promise<DictationRecord> {
    const vocabulary = await this.storage.listVocabulary(input.userId);
    const keyTerms = selectKeyTerms(vocabulary, input.extraKeyTerms || []);

    const stt = await this.stt.transcribe({
      audio: input.audio,
      audioUrl: input.audioUrl,
      filename: input.filename,
      mimeType: input.mimeType,
      language: input.language,
      keyTerms
    });

    const result = await this.rewriteText({
      userId: input.userId,
      rawTranscript: stt.text,
      context: input.context,
      vocabulary
    });

    const now = new Date().toISOString();
    const record: DictationRecord = {
      id: randomUUID(),
      userId: input.userId,
      rawTranscript: stt.text,
      outputText: result.text,
      language: stt.language || input.language,
      duration: stt.duration,
      context: input.context,
      appliedTerms: result.appliedTerms,
      guardStatus: result.guardStatus,
      createdAt: now,
      updatedAt: now
    };

    await this.storage.createDictation(record);
    return record;
  }

  async rewriteText(input: {
    userId: string;
    rawTranscript: string;
    context?: DictationContext;
    vocabulary?: VocabularyEntry[];
  }): Promise<RewriteResult & { guardStatus: DictationRecord['guardStatus'] }> {
    const vocabulary = input.vocabulary || await this.storage.listVocabulary(input.userId);
    const recent = await this.storage.listRecentCorrections(input.userId, 100);
    const style = await this.storage.getStyleProfile(input.userId);
    const relevant = relevantCorrections(input.rawTranscript, recent, 5);
    const personalization = formatPersonalization({ vocabulary, corrections: relevant, style });
    const userPrompt = buildRewriteUser({
      raw: input.rawTranscript,
      context: input.context,
      personalization
    });

    let first: RewritePayload;
    try {
      first = await this.llm.generateJson<RewritePayload>({
        system: REWRITE_SYSTEM_PROMPT,
        user: userPrompt,
        schemaName: 'sayit_rewrite',
        schema: rewriteSchema as unknown as Record<string, unknown>,
        temperature: 0
      });
    } catch {
      return {
        text: fallbackWithVocabulary(input.rawTranscript, vocabulary),
        appliedTerms: [],
        transformations: ['llm_unavailable_fallback'],
        guardStatus: 'fallback'
      };
    }

    if (!this.options.semanticGuardEnabled) {
      return {
        text: first.final_text.trim(),
        appliedTerms: first.applied_terms || [],
        transformations: first.transformations || [],
        guardStatus: 'disabled'
      };
    }

    const firstGuard = await this.guard(input.rawTranscript, first.final_text);
    if (firstGuard.safe) {
      return {
        text: first.final_text.trim(),
        appliedTerms: first.applied_terms || [],
        transformations: first.transformations || [],
        guardStatus: 'safe'
      };
    }

    try {
      const repaired = await this.llm.generateJson<RewritePayload>({
        system: REWRITE_SYSTEM_PROMPT + CONSERVATIVE_REWRITE_SUFFIX,
        user: [
          userPrompt,
          '',
          'REJECTED REWRITE:',
          first.final_text,
          '',
          'GUARD REASON:',
          firstGuard.reason
        ].join('\n'),
        schemaName: 'sayit_rewrite_repair',
        schema: rewriteSchema as unknown as Record<string, unknown>,
        temperature: 0
      });

      const repairedGuard = await this.guard(input.rawTranscript, repaired.final_text);
      if (repairedGuard.safe) {
        return {
          text: repaired.final_text.trim(),
          appliedTerms: repaired.applied_terms || [],
          transformations: [...(repaired.transformations || []), 'semantic_guard_repair'],
          guardStatus: 'repaired'
        };
      }
    } catch {
      // Fall through to the deterministic conservative fallback below.
    }

    return {
      text: fallbackWithVocabulary(input.rawTranscript, vocabulary),
      appliedTerms: [],
      transformations: ['semantic_guard_fallback'],
      guardStatus: 'fallback'
    };
  }

  private async guard(raw: string, rewritten: string): Promise<GuardResult> {
    if (raw.trim() === rewritten.trim()) {
      return {
        safe: true,
        answeredUser: false,
        addedFacts: false,
        droppedEssentialMeaning: false,
        modalStrengthened: false,
        reason: 'identical'
      };
    }

    try {
      const result = await this.llm.generateJson<GuardPayload>({
        system: GUARD_SYSTEM_PROMPT,
        user: ['RAW:', raw, '', 'REWRITTEN:', rewritten].join('\n'),
        schemaName: 'sayit_semantic_guard',
        schema: guardSchema as unknown as Record<string, unknown>,
        temperature: 0
      });

      const safe =
        result.safe &&
        !result.answered_user &&
        !result.added_facts &&
        !result.dropped_essential_meaning &&
        !result.modal_strengthened;

      return {
        safe,
        answeredUser: result.answered_user,
        addedFacts: result.added_facts,
        droppedEssentialMeaning: result.dropped_essential_meaning,
        modalStrengthened: result.modal_strengthened,
        reason: result.reason
      };
    } catch (error) {
      return {
        safe: false,
        answeredUser: false,
        addedFacts: false,
        droppedEssentialMeaning: false,
        modalStrengthened: false,
        reason: 'guard_error: ' + (error instanceof Error ? error.message : 'unknown')
      };
    }
  }
}
