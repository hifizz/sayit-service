import { randomUUID } from 'node:crypto';
import type { JsonLlm } from '../providers/llm.js';
import type { Storage } from '../storage/types.js';
import type { CorrectionRecord, FeedbackAnalysis } from '../types.js';
import { FEEDBACK_SYSTEM_PROMPT } from '../prompts.js';
import { feedbackSchema } from './schemas.js';
import { defaultStyleProfile, mergeStyleSignals } from './personalization.js';

const NEVER_LEARN = new Set(['CONTENT_ADDITION', 'CONTENT_REMOVAL', 'MEANING_CHANGE', 'UNKNOWN']);
const LEXICAL = new Set(['TERM_CORRECTION', 'ASR_CORRECTION', 'SPELLING']);

function canLearnCorrection(correction: FeedbackAnalysis['corrections'][number]): boolean {
  if (!correction.learn || correction.confidence < 0.85) return false;
  if (NEVER_LEARN.has(correction.type)) return false;

  if (LEXICAL.has(correction.type)) {
    if (!correction.before.trim() || !correction.after.trim()) return false;
    if (correction.before.length > 80 || correction.after.length > 80) return false;
    if (correction.before.includes('\n') || correction.after.includes('\n')) return false;
  }

  return true;
}

export class FeedbackService {
  constructor(
    private readonly llm: JsonLlm,
    private readonly storage: Storage
  ) {}

  async submit(dictationId: string, finalText: string): Promise<{
    learnedVocabulary: string[];
    corrections: CorrectionRecord[];
  }> {
    const dictation = await this.storage.getDictation(dictationId);
    if (!dictation) throw new Error('Dictation not found');

    await this.storage.setFinalUserText(dictationId, finalText);
    if (dictation.outputText.trim() === finalText.trim()) {
      return { learnedVocabulary: [], corrections: [] };
    }

    const analysis = await this.llm.generateJson<FeedbackAnalysis & { style_signals: FeedbackAnalysis['styleSignals'] }>({
      system: FEEDBACK_SYSTEM_PROMPT,
      user: [
        'RAW TRANSCRIPT:',
        dictation.rawTranscript,
        '',
        'GENERATED:',
        dictation.outputText,
        '',
        'FINAL USER TEXT:',
        finalText,
        '',
        'CONTEXT:',
        JSON.stringify(dictation.context || { type: 'other' })
      ].join('\n'),
      schemaName: 'sayit_feedback_analysis',
      schema: feedbackSchema as unknown as Record<string, unknown>,
      temperature: 0
    });

    const now = new Date().toISOString();
    const records: CorrectionRecord[] = analysis.corrections.map((item) => ({
      id: randomUUID(),
      userId: dictation.userId,
      dictationId,
      before: item.before,
      after: item.after,
      type: item.type,
      confidence: item.confidence,
      learn: canLearnCorrection(item),
      reason: item.reason,
      createdAt: now
    }));

    await this.storage.addCorrections(records);

    const learnedVocabulary: string[] = [];
    for (const record of records) {
      if (!record.learn || !LEXICAL.has(record.type)) continue;
      if (record.confidence < 0.9) continue;
      const entry = await this.storage.upsertVocabulary({
        userId: dictation.userId,
        canonical: record.after.trim(),
        aliases: [record.before.trim()],
        source: 'auto',
        confidence: record.confidence
      });
      learnedVocabulary.push(entry.canonical);
    }

    const styleSignals = (analysis as any).style_signals || {};
    if (Object.keys(styleSignals).length > 0) {
      const current = await this.storage.getStyleProfile(dictation.userId)
        || defaultStyleProfile(dictation.userId);
      await this.storage.saveStyleProfile(mergeStyleSignals(current, styleSignals));
    }

    return { learnedVocabulary: [...new Set(learnedVocabulary)], corrections: records };
  }
}
