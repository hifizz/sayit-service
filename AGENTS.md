# SayIt agent instructions

Read `openspec/project.md`, both `openspec/specs/*/spec.md`, and `docs/evaluation.md` before changing behavior. These files persist the product decisions from the design conversation; do not rely on chat memory.

Server-first. Typeless's observable output is the reference, not its private architecture. ThreadChat is the first integration. No native client work, model fine-tuning, or agent tools are required for v0.1.

Hard invariants: represent rather than answer the speaker; no invented content; preserve negation, numeric facts, uncertainty, conditions and scope. A revision cue alone is not enough to discard earlier text. Uncertain correction must abstain. A failed semantic auditor must never allow an unchecked rewrite.

All account access is scoped by the authenticated trusted-backend user. Never read identity from an ordinary body field. Never expose service/provider keys to the browser or logs. Never fetch arbitrary audio URLs.

Feedback requires exact dictation-span attribution, output SHA256 and finalization idempotency. Never learn added requirements or number/modality changes as lexical rules. Do not count retries or unchanged outputs as new learning evidence. Terms deleted by the user stay blocked until manually restored. Style must not reduce epistemic hedging.

Keep synthetic tests, real audio evaluations and Typeless comparison distinct. A scripted/mocked response does not validate the intelligence of a real model. No claims of parity without same-audio blinded human evaluation. Report failed/fallback/unrated cases and dataset/model/prompt/commit fingerprints.

Before completing changes: `npm run typecheck`, `npm test`, `npm run build`, `npm run eval -- --mode mock`. Run PostgreSQL tests against an isolated database, never production. Update specs and tests with any policy change. Do not commit `.env`, real recordings, private transcripts, reports with personal content, or credentials.
