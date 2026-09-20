CREATE TABLE IF NOT EXISTS dictations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  raw_transcript text NOT NULL,
  output_text text NOT NULL,
  final_user_text text,
  language text,
  duration double precision,
  context jsonb,
  applied_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  guard_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dictations_user_created_idx ON dictations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vocabulary (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  canonical text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence double precision NOT NULL DEFAULT 1,
  frequency integer NOT NULL DEFAULT 1,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, canonical)
);
CREATE INDEX IF NOT EXISTS vocabulary_user_idx ON vocabulary(user_id);

CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  dictation_id uuid NOT NULL REFERENCES dictations(id) ON DELETE CASCADE,
  before_text text NOT NULL,
  after_text text NOT NULL,
  correction_type text NOT NULL,
  confidence double precision NOT NULL,
  learn boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corrections_user_created_idx ON corrections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS style_profiles (
  user_id text PRIMARY KEY,
  directness double precision NOT NULL DEFAULT 0.5,
  verbosity double precision NOT NULL DEFAULT 0.5,
  formality double precision NOT NULL DEFAULT 0.5,
  bullet_preference double precision NOT NULL DEFAULT 0.5,
  hedging double precision NOT NULL DEFAULT 0.5,
  technical_terms text NOT NULL DEFAULT 'preserve',
  observations integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
