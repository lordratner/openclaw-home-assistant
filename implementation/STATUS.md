# Current development checkpoint — 2026-10-28

This supersedes checkpoint-1's implementation status, not its historical evidence.
Local development and the two private-repository workflow were already authorized.
Live deployment, service restarts, real-provider/audio canaries, public publication
and unrelated upstream/core edits remain separate scopes.

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
