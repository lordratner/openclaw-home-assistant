# OpenClaw Voice — development checkpoint 1

Updated: 2026-10-27. This is the authoritative current ledger, not a release-readiness certificate.

## Authorization and scope

Owner Talk message 20256 explicitly authorized development of the paired products. The approved requirements remain R01–R58, with streaming-first automatic functional fallback, explicit OC-side agent selection and model/thinking/fast controls, OC-owned persistent target, fresh history per HA conversation, native HA entities and two automation actions. No new product decision supersedes those requirements.

Local original source, isolated development dependencies and disposable framework processes have been created. No installed OpenClaw source/plugin bundle, live Gateway/HA configuration, real provider credential, satellite, default pipeline or production service has been changed. No real provider account has been called. Earlier planning-only restrictions are superseded by 20256 for development, not for live deployment or unrelated core projects.

## Repositories / publication

- `modules/openclaw-voice-plugin`: independent local main git repository; original MIT code. Package identity `@lordratner/openclaw-voice-plugin` is provisional until release.
- `modules/home-assistant-openclaw-voice`: independent local main git repository; original MIT code. HA domain `openclaw_voice` is provisional until registration/packaging.
- Neither product is installable yet. The only registered plugin is a clearly named isolated test fixture; production plugin entry/manifest and HA manifest/config-entry registration remain unfinished.
- GitHub identity `lordratner` and proposed repository-name availability were checked read-only. No GitHub remote repositories have yet been created or pushed.
- Both modules contain the full planning baseline, module README and provenance/license notices. No community application source has been copied into these products.

## Implemented source

OC module:

1. Exact run/agent/session inference controls using one-turn thinking/fast options and a run-filtered `before_model_resolve` hook, with owned abort/release leases.
2. Durable atomic plugin-metadata file, serialized within one owner; failed transactions do not poison later work; corruption is not silently overwritten. Exclusive ownership is an adapter precondition, not cross-process locking.
3. Session-binding engine: persistent auto-binding exactly once, fresh per-HA-conversation histories with follow-up reuse, caller-bound opaque handles, revision/agent namespace separation, bounded idle mappings, missing/reset-target rejection, no history deletion or session-default patch/restore. Host session create/inspect adapter remains to be wired.
4. One-use expiring pairing and revocable voice-client identities; only token hashes persisted, fixed voice scopes, bounded clients/pairings, namespace tied to selected agent/profile. Production owner/admin method registration, rate limiting and in-flight revocation propagation remain to be wired.
5. Bounded UTF-8 NDJSON speech framing, closed start/text/end shapes, profile/request binding, sequence validation, output drain backpressure and base64 audio chunks.
6. Provider-neutral sentence synthesis scheduler: native progressive audio where available, explicit unsupported-capability fallback to buffered sentences, bounded text/audio/chunks, abort and release handling, no replay after provider failure/partial output, stable format check. Native incremental-text synthesis and general codec normalization remain adapter work.

HA module:

1. Bounded task-local native satellite action-to-conversation binding, following public chat-log creation events; concurrent targets cannot consume each other's mode override. Includes idle expiry, same-target busy admission, shutdown fencing and rollback.
2. Credential-minimal streaming HTTP speech client. No provider/agent/model/session-target parameters; no redirects; strict request/profile/job/sequence/audio checks; UTF-8 chunking handles buffered whole-answer input without loss.
3. Real HA `TextToSpeechEntity` implementation accepting unfinished text via `async_stream_tts_audio`, plus buffered announcement API compatibility. Not yet registered through a config entry. Multi-segment MP3 is the exercised path; other containers require normalization before release.

## Executed verification

- OC automated suite: **36 passed**, `npm test`.
- HA automated suite: **27 passed**, `.venv/bin/python -m pytest -q`.
- Total automated checks: **63 passed**. These are not the full 42 planned acceptance scenarios and must not be equated with all requirements passing.
- Separate native paired framework proof: **passed**, `npm run test:native-pair` with the companion HA development environment present.
- Evidence: `evidence/native-framework-proof.json`; final proof stderr is empty. Full synthetic request diagnostics remain in disposable test directories, not in published source.

Actual framework proof, not just mocks:

- OpenClaw **2026.10.3**, Node **24.18.1**; Home Assistant **2026.10.4**, Python **3.14.10**.
- Disposable loopback OC Gateway ran a selected non-default fixture agent through normal inbound dispatch with workspace context and an actual registered tool. No tool-free completion substitute.
- Three real host model requests used the configured per-run model and low thinking. Fresh and existing shared-session turns passed; the existing session was deliberately seeded with different saved model/high thinking/fast=true, and those preferences remained unchanged.
- An opening text snapshot reached the caller before the fake model supplied its delayed ending. This is actual native OC incremental output.
- Public native OC speech APIs reached bundled OpenAI transcription/buffered TTS and bundled ElevenLabs progressive TTS against synthetic local HTTP providers. ElevenLabs preserved multiple audio chunks. OpenAI's adapter in this tested release explicitly reports unsupported streaming-output; sentence-buffer fallback is therefore required for early speech through that adapter. This is a host adapter limitation, not a claim about every OpenAI API or later OC release.
- Native HA ServiceRegistry + AssistSatelliteEntity conversation creation + public chat-log subscription passed concurrent/unrelated/empty-start correlation tests. Hardware and synthesis were fixtures; no satellite was driven.
- Real HA TTS entity → aiohttp unfinished-text upload → OC plugin-authenticated route → OC speech API → response audio passed. First received audio released the deliberately withheld ending, proving no whole-text upload buffer in this path.
- The two MP3 sentence buffers arrived exactly once and FFmpeg decoded both synthetic tones (~0.86 s combined). Timing is a controlled fixture result, not a real-provider latency benchmark or audible playback proof.
- HA used a separately paired voice credential, not the fixture Gateway owner token. The voice credential could not access the owner-only fixture control route. Revocation rejected subsequent speech requests.

## Gate / milestone state

- P00/H00: local source/bootstrap/provenance complete; remote repository/publication bootstrap still pending.
- P01/H01: central normal-agent/run-control/text-stream/speech/native-HA-action/paired-TTS feasibility demonstrated. Full session-lock/runtime matrix, cancellation and metadata capability projection remain unfinished.
- P02/H02: experimental speech subprotocol and executable paired client implemented. Complete versioned conversation/STT/job/reconnect protocol not frozen.
- P03/P04/P07 and H06/H08: core library work in progress, not complete product milestones.
- G02: native correlation proof passed on the tested HA release. Release still needs registered entity/service end-to-end and real hardware.
- G01/G03/G04/G05/G07/G08: partial evidence, not blanket passes. G06 original-code provenance documented; no copied units to attribute yet.

## Important source findings / constraints

- OC public plugin events are scope-wide broadcasts. Never put private voice text/audio in those broadcasts. Same-Gateway plugin-authenticated streaming HTTP routes are the tested fallback, with no second listener and no owner token in HA.
- Non-bundled `before_model_resolve` registration needs the owner's documented `plugins.entries.<id>.hooks.allowConversationAccess=true` grant. The disposable fixture grants it only in its own temporary config. Future installation instructions must explain it; do not edit the live config implicitly.
- Native `onModelSelected` reports pre-hook selection in the tested host, and a hook model override may produce an `isFallbackNotice` diagnostic. Do not expose that callback as authoritative effective-model telemetry or read a diagnostic notice aloud. Use owned actual-model observations and typed notice filtering in the production dispatch adapter.
- Hard-locked session/runtime behavior must be detected honestly; never silently ignore explicit voice settings, unlock a user session, or patch/restore shared defaults.
- Speech cancellation can stop forwarding and release owned streaming transports. Public buffered STT/TTS calls do not universally accept abort signals; do not claim that remote inference stopped when it may still finish. Full job status/cancel semantics remain to be implemented.
- The metadata file implementation is single-owner only. Gateway reload/process-owner serialization or a host transactional-store adapter must be proved before production registration; do not allow two writers to race.
- MP3 fixture stitching decoded correctly. This does not establish arbitrary MP3 sample-rate compatibility, other codec continuity or physical playback. Non-MP3 multi-segment audio is deliberately not presented as solved.
- Sentence segmentation is a provisional bounded heuristic. Abbreviation/decimal/multilingual quality, sentence limits and provider input constraints need expanded acceptance coverage.

## Exact next development actions (already authorized; no new product question)

1. Freeze complete protocol v1, including capabilities, conversation open/turn, bounded STT, owned jobs/cancellation/status, durable request idempotency and ambiguous-work recovery. Keep speech contract fixtures synchronized.
2. Implement the production selected-agent dispatch/session host adapter. Preserve native prompts/tools/permissions, binding physical lifecycle and model-lock checks. Extend the isolated Gateway proof to multiple rooms, failures, queueing, cancellation, session reset/reload races and multi-message output reconciliation.
3. Register production plugin manifest/service/profile schema and owner-only pairing/revocation controls, with bounded rate limits, active authority rechecks and exact job delivery ownership. Do not copy fixture control routes into production.
4. Implement HA config/options flow and lifecycle, capabilities discovery, native STT/conversation entity registration, TTS registration and both automation actions. HA chooses mode only; OC owns actual target/agent/model policy.
5. Normalize/validate audio formats and complete provider/retention/cache/error diagnostics matrix; run actual pair acceptance. Then prepare a separate controlled live install/provider/satellite validation proposal with rollback.
6. Create/sync the two remote repositories within the requested repository workflow once bootstrap/publication choices are concrete. Never publish private test state, credentials, local caches or installed-source snapshots.

## Development environment and hygiene

HA pinned test environment is recorded in `requirements-test.lock` in the HA module. The local managed Python/uv environments and caches are ignored by the parent project. The OC test SDK is a development-only ignored symlink to the installed read-only host artifact; replace with the exact matching public package when reproducing elsewhere. No source imports hashed private OC bundles.

Native proof harness creates its own state/config/workspace/ports, strips ambient provider credentials, disables channel startup/heartbeat/cron, uses synthetic keys and local provider endpoints, and terminates only its own test process group. Final proof logging is isolated inside its temporary directory. Earlier proof iterations used the host's default temporary log-file destination; no production configuration/service was changed.

## Failed attempts retained as engineering notes

- First native HA pytest invocation lacked module-root import path; using python -m pytest and explicit pytest pythonpath fixed the local runner, not HA.
- Disposable OC config initially used obsolete agents.list, messages.tts and per-capability media model fields; updated fixture to the actual tested schema (agents.entries, top-level tts, capability-tagged tools.media.models). No live migration was run.
- Fixture plugin needed startup activation, tool contract declaration and non-bundled conversation-hook grant. Added only to test fixture/config; otherwise the host correctly refused those registrations.
- Fake model initially called a deferred tool directly; corrected fixture to use native tool_call when the normal tool-search surface defers it.
- Synthetic loopback STT endpoint initially hit the host SSRF guard. Added allowPrivateNetwork only to the disposable configured OpenAI provider request, not globally or in production.
- No failed attempt was resolved by editing installed runtime bundles, weakening live authentication, using real provider credentials or changing another project.
