import type { CorrectionRecord, StyleProfile, VocabularyEntry } from '../types.js';

function tokens(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}_+#.-]+/gu, ' ').trim();
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function selectKeyTerms(vocabulary: VocabularyEntry[], extra: string[] = []): string[] {
  const ranked = vocabulary
    .filter((entry) => entry.canonical.length <= 50)
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === 'manual' ? -1 : 1;
      return (b.frequency - a.frequency) || (b.confidence - a.confidence);
    })
    .map((entry) => entry.canonical);

  return [...new Set([...extra, ...ranked].map((v) => v.trim()).filter((v) => v && v.length <= 50))].slice(0, 100);
}

export function relevantCorrections(transcript: string, corrections: CorrectionRecord[], limit = 5): CorrectionRecord[] {
  const target = tokens(transcript);
  return corrections
    .filter((item) => item.learn && !['CONTENT_ADDITION', 'CONTENT_REMOVAL', 'MEANING_CHANGE'].includes(item.type))
    .map((item) => ({
      item,
      score: Math.max(jaccard(target, tokens(item.before)), jaccard(target, tokens(item.after)))
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.item);
}

export function formatPersonalization(input: {
  vocabulary: VocabularyEntry[];
  corrections: CorrectionRecord[];
  style: StyleProfile | null;
}): string {
  const vocabulary = input.vocabulary.slice(0, 40).map((entry) => {
    const aliases = entry.aliases.length ? ' aliases=[' + entry.aliases.join(', ') + ']' : '';
    return '- ' + entry.canonical + aliases;
  });

  const corrections = input.corrections.map((item) =>
    '- [' + item.type + '] ' + JSON.stringify(item.before) + ' -> ' + JSON.stringify(item.after)
  );

  const style = input.style
    ? JSON.stringify({
        directness: input.style.directness,
        verbosity: input.style.verbosity,
        formality: input.style.formality,
        bulletPreference: input.style.bulletPreference,
        hedging: input.style.hedging,
        technicalTerms: input.style.technicalTerms,
        observations: input.style.observations
      })
    : 'No stable style profile yet. Do not guess one.';

  return [
    'PERSONAL VOCABULARY:',
    vocabulary.length ? vocabulary.join('\n') : '(none)',
    '',
    'RELEVANT PAST CORRECTIONS:',
    corrections.length ? corrections.join('\n') : '(none)',
    '',
    'ABSTRACT STYLE PROFILE:',
    style
  ].join('\n');
}

export function defaultStyleProfile(userId: string): StyleProfile {
  return {
    userId,
    directness: 0.5,
    verbosity: 0.5,
    formality: 0.5,
    bulletPreference: 0.5,
    hedging: 0.5,
    technicalTerms: 'preserve',
    observations: 0,
    updatedAt: new Date().toISOString()
  };
}

export function mergeStyleSignals(profile: StyleProfile, signals: Partial<StyleProfile>): StyleProfile {
  const alpha = profile.observations < 5 ? 0.35 : 0.15;
  const blend = (current: number, next: unknown) =>
    typeof next === 'number' && Number.isFinite(next)
      ? Math.max(0, Math.min(1, current * (1 - alpha) + next * alpha))
      : current;

  return {
    ...profile,
    directness: blend(profile.directness, signals.directness),
    verbosity: blend(profile.verbosity, signals.verbosity),
    formality: blend(profile.formality, signals.formality),
    bulletPreference: blend(profile.bulletPreference, signals.bulletPreference),
    hedging: blend(profile.hedging, signals.hedging),
    observations: profile.observations + 1,
    updatedAt: new Date().toISOString()
  };
}
