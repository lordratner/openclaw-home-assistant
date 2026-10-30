# Current product candidate — 2026-10-29

OCdev10 / HAdev6, protocol1.2: independent stage readiness, optional OC speech,
explicit native batch fallback, stable service identity/deduplication, v2 HA
migration and reconfigure/reauth, translations, mixed native HA speech and
bounded stale-audio cleanup. Source-only; no installation/reload/restart in this
workstream. Full module checks138OC+90HA passed. A disposable native source pair passed;
source-matched archive qualification is recorded separately in the paired
implementation evidence. Official public CI/provider/hardware gates stay open. Current deployment remains the
earlier accepted pair. See docs/PRODUCT.md, COMPATIBILITY.md and QUALITY.md.

## Historical checkpoints below

# Admission diagnostics correction — 0.0.1-dev.2

Live dev.1 tests found the public Jobs.admit wrapper omitted inference/timing
arguments when forwarding to private admission. Execution snapshots still reached
the host closure, but receipt settings and HTTP-level timestamps were absent.
The two-line forwarding fix is implemented; the HTTP regression failed on dev.1
then passed with the fix. All 81 OC tests and the native proof pass, explicitly
asserting receipt revisions and request_received timestamps. HA needs no change.
This correction is not yet installed live.

# Current development checkpoint — 2026-10-28

This supersedes checkpoint-1's implementation status, not its historical evidence.
Local development and the two private-repository workflow were already authorized.
Live deployment, service restarts, real-provider/audio canaries, public publication
and unrelated upstream/core edits remain separate scopes.

## Next-turn settings and timing candidate — 0.0.1-dev.1

Owner-approved local implementation (Talk 20471/20481); not installed live.
Adds owner-only inference.get/update with durable stale-safe overrides, pinned
per-turn settings, unchanged conversation handles and native session preferences.
Adds bounded content-free backend timing/diagnostics and HA receive timing;
stream responses request no proxy buffering. Bootstrap config edits retain their
normal replacement semantics. See README, docs/PROTOCOL.md and docs/TIMING.md.

Verification: 81 OC + 41 HA unit tests passed. Extended disposable native pair
passed: owner update while an old turn is running, old controls retained, next
model/thinking observed on the same handle, old retry not redispatched, timing
redaction, eight admin RPC denials, early decoded audio, policy/lock and unload
checks. No live latency improvement or audible test is claimed for this candidate.

## Current implementation

Production OC plugin manifest/entry/service, explicit selected-agent profile,
owner-only pairing/revoke/rebind RPC, scoped streaming HTTP, native host adapter,
atomic namespaced bindings, durable idempotent jobs/recovery, native batch STT,
progressive/sentence-fallback TTS and continuous provider-neutral WAV normalization
are implemented. HA has config/options/reauth, native STT/conversation/TTS entities,
both automation actions, reload-stable mode bindings, task-local speech ownership,
bounded pending playback, same-conversation overlap rejection and redacted diagnostics.

Provider-first-byte normalization no longer waits for WAV EOF. Header parsing is
bounded and uses declared PCM/float metadata, never provider-name guesses. A single
canonical PCM16/24 kHz mono WAV crosses sentence/container boundaries. HA defaults
to WAV, while native device preferences still take precedence.

## Verification

74 OC automated tests + 40 HA automated tests = 114 automated tests passed.
Separate native production-plugin/HA pipeline proof passed, including native
registered tool denial, lock rejection, five admin-method denials without cached
owner-device auth, explicit speech overrides, early playback bytes, all entities,
both actions, follow-up mode and unload. [Acceptance](../docs/ACCEPTANCE.md) records
which of the 42 planned scenarios are partial or require a controlled canary.

Tested pair: OC2026.10.3, Node24.18.1, HA2026.10.4, Python3.14.10, FFmpeg7.1.5.
Tests use synthetic local providers/devices; no real provider/hardware acceptance
or audible playback is claimed. Dependency deprecation/AppKey warnings remain.

## Packaging and operations

[Protocol](../docs/PROTOCOL.md), [installation/upgrade/rollback](../docs/INSTALL.md)
and [SDK gap](../docs/SDK-GAPS.md) are current. READMEs describe implemented behavior
rather than obsolete scaffold status. Package source allowlisting excludes fixture
runtimes, development dependencies and credentials. Artifacts are development
review packages, not a published release.

## Next gate

Review and authorize a narrowly bounded live canary only after choosing target
versions, existing agent policy and one test speaker/pipeline. Prove real account
STT/TTS, effective model/thinking/fast, native approval UI, client/local intents,
concurrent rooms, cancellation and physical follow-up listening, then upgrade and
rollback. Keep defaults and unrelated pipelines unchanged. Record actual audible
behavior separately from HTTP/HA status. Broader runtime/version compatibility
and full release acceptance remain open; no product requirement is silently waived.

Realtime STT remains a documented native SDK finalization gap with reliable batch
fallback. Any upstream SDK implementation is a separate assignment, not permission
to edit installed bundles. Do not restart/reconfigure live OC or HA to finish a
local test. Existing protocol/schema version is1; unknown storage versions fail
closed and no unsupported data migration should be attempted.

## Native Assist candidate — 2026-10-28

Paired dev.3 packages are locally implemented and byte-verified. See `docs/NATIVE-ASSIST.md`. OC: 87 regression checks; HA: 45 regression checks; real paired runtimes + synthetic-model proof passed. Native HA exposure controls actual effects; wrapper is not MCP/SSH. Live installation/restarts and Jarvis native-tool grant/API selection remain pending owner approval. Do not report this as active.
