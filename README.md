# SayIt Service

**English** · [中文](README.zh-CN.md)

[![CI](https://github.com/hifizz/sayit-service/actions/workflows/ci.yml/badge.svg)](https://github.com/hifizz/sayit-service/actions/workflows/ci.yml)

A server-side speech-to-writing API that turns dictated audio into editable text while preserving the speaker's meaning.

SayIt transcribes audio with xAI Grok Voice Transcribe 2.0, then applies conservative cleanup through a configurable OpenAI-compatible LLM. It supports personal terminology, exact-span feedback, and explicit fallback when a rewrite cannot be trusted.

> **License:** [MIT](LICENSE); see [License](#license).

## What it does

| Capability | Behavior |
| --- | --- |
| Speech transcription | Sends uploaded audio to xAI `grok-voice-transcribe-2.0` |
| Meaning-preserving cleanup | Removes filler and repetition, improves grammar and formatting, and preserves negation, numbers, conditions, scope, and uncertainty |
| Personal vocabulary | Sends active canonical terms as xAI keyterms and uses confirmed aliases during cleanup |
| Feedback learning | Learns only from edits attributed to the exact dictated span, with idempotent finalization |
| Semantic review | Audits rewrites, attempts at most one conservative repair, and falls back to the raw transcript when review fails |
| User isolation | Scopes stored records and personalization to the authenticated trusted-backend user |

```text
audio
  → xAI speech-to-text + keyterms
  → vocabulary-aware rewrite
  → semantic review
  → conservative repair or raw-transcript fallback
  → editable draft
```

SayIt represents what the speaker intended to write. It does not answer the speaker's request or add requirements and facts that were not dictated.

## Quick start

Requirements: Node.js 22+ and pnpm (`corepack enable`).

```bash
git clone https://github.com/hifizz/sayit-service.git
cd sayit-service
pnpm install
pnpm run setup
pnpm run dev
```

The default `mock` mode needs no model key. It exercises the authenticated text pipeline and deliberately returns text without intelligent cleanup or audio transcription.

In another terminal:

```bash
set -a; . ./.env; set +a

curl http://127.0.0.1:8787/v1/dictations/text \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H "X-Sayit-User-Id: local-user" \
  -H "Content-Type: application/json" \
  -d '{"raw_transcript":"Please keep the existing data for now.","context":{"type":"ai_prompt","app":"threadchat"}}'
```

`pnpm run setup` creates a private `.env` only when one does not already exist. Development uses volatile in-memory storage unless `DATABASE_URL` is configured.

### Local demo page (optional)

A minimal web demo built with [ElevenLabs UI](https://ui.elevenlabs.io) components exercises the full text and audio dictation pipeline:

```bash
pnpm demo:install   # one-time: install demo dependencies
pnpm run dev        # terminal 1: the service
pnpm demo           # terminal 2: demo page at http://localhost:5173
```

Paste the `SAYIT_SERVICE_TOKEN` from your `.env` into the connection card; the token stays in browser memory only. The demo verifies pipeline connectivity (record/upload audio, submit raw transcripts, inspect `guard_status` and metadata); it is not a quality or Typeless-parity evaluation.

## Live providers

Audio transcription uses xAI. To enable the live pipeline:

```dotenv
SAYIT_MODE=live
XAI_API_KEY=your-xai-key
```

Cleanup defaults to xAI `grok-4.6`. You can configure a separate OpenAI-compatible provider. For the DeepSeek setup used by this project:

```dotenv
LLM_API_KEY=your-deepseek-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
LLM_JSON_MODE=json_object
```

When the LLM origin differs from the xAI origin, SayIt requires a separate `LLM_API_KEY`; it will not forward the xAI key to another provider.

Semantic review is enabled by default. `SEMANTIC_GUARD_ENABLED=false` skips the independent review and returns `guard_status=disabled`. This lowers model-call latency, but the resulting text has not passed SayIt's semantic audit.

Upload an audio file:

```bash
curl http://127.0.0.1:8787/v1/dictations \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H "X-Sayit-User-Id: local-user" \
  -H "Idempotency-Key: recording-000001" \
  -F 'context={"type":"ai_prompt","app":"threadchat"}' \
  -F 'key_terms=["ThreadChat","E2B"]' \
  -F "file=@./sample.ogg"
```

The response contains the final `text`, `raw_transcript`, `output_sha256`, dictation `id`, and processing metadata. `guard_status=fallback` means the raw transcript was returned; it is an explicit degradation rather than a successful rewrite.

## API

All endpoints except `/health` and `/ready` require:

- `Authorization: Bearer <SAYIT_SERVICE_TOKEN>`
- `X-Sayit-User-Id: <trusted authenticated user id>`

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/dictations` | Transcribe and clean up an uploaded audio file |
| `POST /v1/dictations/text` | Exercise the post-ASR cleanup path with supplied text |
| `GET /v1/dictations/:id` | Read the authenticated user's retained result |
| `DELETE /v1/dictations/:id` | Delete a result and its linked correction evidence |
| `POST /v1/dictations/:id/feedback` | Finalize exact-span edit feedback atomically |
| `GET /v1/vocabulary` | List active and candidate vocabulary entries |
| `POST /v1/vocabulary` | Add a manual canonical term and aliases |
| `DELETE /v1/vocabulary/:id` | Block a term from being learned again automatically |
| `GET/PATCH/DELETE /v1/personalization` | Inspect, toggle, or reset personalization |
| `DELETE /v1/me/data` | Delete all service-side data for the authenticated user |

See [ThreadChat integration](docs/threadchat-integration.md) for request and feedback attribution details.

## Integration model

```text
browser recorder/editor
        ↓ authenticated session
trusted application backend
        ↓ service token + trusted user id
SayIt API
        ↓ provider credentials remain server-side
xAI STT + configured cleanup LLM
```

The browser must never receive `SAYIT_SERVICE_TOKEN` or provider keys. The trusted application backend derives `X-Sayit-User-Id` from its authenticated session rather than accepting an arbitrary user ID from the browser.

SayIt returns an editable draft and does not send the message automatically.

## Safety and privacy

- Rewrites must preserve negation, numeric facts, uncertainty, conditions, and scope.
- A failed semantic auditor cannot approve an unchecked rewrite.
- Arbitrary audio URLs are rejected; the API accepts uploaded audio files only.
- Audio is processed in request memory and is not written to SayIt's database or logs.
- Transcripts, output, necessary context, and feedback receipts are retained for 168 hours by default.
- Vocabulary and abstract style preferences remain until the user resets or deletes them.
- Audio and text are sent to configured model providers; their retention policies must be evaluated separately.
- `.env` files, common audio formats, reports, artifacts, and `evaluation/private/` are ignored by Git. Any other private transcript or credential must also remain outside commits.

Read [deployment, credentials, and data retention](docs/runbook.md) for the complete operating boundary.

## Validation

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run eval --mode mock --out reports/mock
```

CI also runs migrations against an isolated PostgreSQL service, provider contract tests, a compiled HTTP smoke test, and a Docker build.

Mock evaluation verifies the harness only. Real-model quality requires private audio, human reference transcripts, expected final text, and manual semantic review. Typeless comparison requires the same source audio and blinded human evaluation. See the [evaluation protocol](docs/evaluation.md) and [validation record](docs/validation.md).

## Deployment

Production mode requires PostgreSQL.

```bash
pnpm run db:migrate
pnpm run build
pnpm start
```

Docker Compose is available for local deployment:

```bash
docker compose up --build
```

Put the service behind an HTTPS gateway in production. Configure database backups, provider retention, request timeouts, and shared rate limits for your deployment.

## Documentation

- [Architecture and engineering boundaries](docs/architecture.md)
- [Project scope and roadmap](openspec/project.md)
- [ThreadChat integration](docs/threadchat-integration.md)
- [Evaluation protocol](docs/evaluation.md)
- [Deployment, credentials, and data retention](docs/runbook.md)
- [Dictation and correction specification](openspec/specs/dictation/spec.md)
- [Feedback and personalization specification](openspec/specs/feedback/spec.md)
- [External sources and verification boundary](docs/sources.md)

## Current limitations

- Audio transcription uses file-based batch requests; real-time WebSocket transcription is not implemented.
- This repository contains the backend and a server-side integration example, not a native desktop client.
- Semantic review is a probabilistic safeguard rather than proof of semantic equivalence.
- Rate limits and the global concurrency gate are process-local.
- Provider calls are not billing-exactly-once if a process fails after the provider responds but before the database transaction commits.
- No accuracy, latency SLA, personalization lift, or Typeless parity claim is made without the required real-data evaluation.

## License

This project is open source under the [MIT License](LICENSE).
