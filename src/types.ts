export type ContextType = 'ai_prompt' | 'message' | 'email' | 'document' | 'other';

export interface DictationContext {
  type?: ContextType;
  app?: string;
  projectId?: string;
  surroundingText?: string;
  selectedText?: string;
}

export interface SttWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface SttResult {
  text: string;
  language?: string;
  duration?: number;
  words?: SttWord[];
}

export interface VocabularyEntry {
  id: string;
  userId: string;
  canonical: string;
  aliases: string[];
  confidence: number;
  frequency: number;
  source: 'manual' | 'auto';
  createdAt: string;
  updatedAt: string;
}

export type CorrectionType =
  | 'TERM_CORRECTION'
  | 'ASR_CORRECTION'
  | 'SPELLING'
  | 'GRAMMAR'
  | 'PUNCTUATION'
  | 'FORMAT'
  | 'STYLE'
  | 'SELF_CORRECTION_FIX'
  | 'CONTENT_ADDITION'
  | 'CONTENT_REMOVAL'
  | 'MEANING_CHANGE'
  | 'UNKNOWN';

export interface CorrectionRecord {
  id: string;
  userId: string;
  dictationId: string;
  before: string;
  after: string;
  type: CorrectionType;
  confidence: number;
  learn: boolean;
  reason?: string;
  createdAt: string;
}

export interface StyleProfile {
  userId: string;
  directness: number;
  verbosity: number;
  formality: number;
  bulletPreference: number;
  hedging: number;
  technicalTerms: 'preserve' | 'normalize';
  observations: number;
  updatedAt: string;
}

export interface DictationRecord {
  id: string;
  userId: string;
  rawTranscript: string;
  outputText: string;
  language?: string;
  duration?: number;
  context?: DictationContext;
  appliedTerms: string[];
  guardStatus: 'safe' | 'repaired' | 'fallback' | 'disabled';
  finalUserText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RewriteResult {
  text: string;
  appliedTerms: string[];
  transformations: string[];
}

export interface GuardResult {
  safe: boolean;
  answeredUser: boolean;
  addedFacts: boolean;
  droppedEssentialMeaning: boolean;
  modalStrengthened: boolean;
  reason: string;
}

export interface FeedbackAnalysis {
  corrections: Array<{
    before: string;
    after: string;
    type: CorrectionType;
    confidence: number;
    learn: boolean;
    reason: string;
  }>;
  styleSignals: Partial<Pick<StyleProfile, 'directness' | 'verbosity' | 'formality' | 'bulletPreference' | 'hedging'>>;
}
