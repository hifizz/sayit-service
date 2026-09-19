export const rewriteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    final_text: { type: 'string' },
    applied_terms: { type: 'array', items: { type: 'string' } },
    transformations: { type: 'array', items: { type: 'string' } }
  },
  required: ['final_text', 'applied_terms', 'transformations']
} as const;

export const guardSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    safe: { type: 'boolean' },
    answered_user: { type: 'boolean' },
    added_facts: { type: 'boolean' },
    dropped_essential_meaning: { type: 'boolean' },
    modal_strengthened: { type: 'boolean' },
    reason: { type: 'string' }
  },
  required: [
    'safe',
    'answered_user',
    'added_facts',
    'dropped_essential_meaning',
    'modal_strengthened',
    'reason'
  ]
} as const;

const correctionTypes = [
  'TERM_CORRECTION', 'ASR_CORRECTION', 'SPELLING', 'GRAMMAR', 'PUNCTUATION',
  'FORMAT', 'STYLE', 'SELF_CORRECTION_FIX', 'CONTENT_ADDITION', 'CONTENT_REMOVAL',
  'MEANING_CHANGE', 'UNKNOWN'
] as const;

export const feedbackSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          before: { type: 'string' },
          after: { type: 'string' },
          type: { type: 'string', enum: correctionTypes },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          learn: { type: 'boolean' },
          reason: { type: 'string' }
        },
        required: ['before', 'after', 'type', 'confidence', 'learn', 'reason']
      }
    },
    style_signals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        directness: { type: 'number', minimum: 0, maximum: 1 },
        verbosity: { type: 'number', minimum: 0, maximum: 1 },
        formality: { type: 'number', minimum: 0, maximum: 1 },
        bulletPreference: { type: 'number', minimum: 0, maximum: 1 },
        hedging: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: []
    }
  },
  required: ['corrections', 'style_signals']
} as const;
