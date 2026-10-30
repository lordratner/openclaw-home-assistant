# Current product candidate evidence — 2026-10-29

Bridge dev10 / HAdev6, protocol1.2. Full module suites138OC+90HA passed. Added
regressions cover missing optional dependencies, native-policy batch alternatives
and legacy explicit selection, independent stage languages/readiness, duplicate
and concurrent pairing, v1 migration, same-backend URL moves, wrong-backend/agent
reauth guards and native buffered HA TTS with unavailable OC TTS. Offline metadata/
translation/package validators passed. Disposable native source pair passed;
archive-loaded proof and hashes are recorded separately with packaged artifacts.

No new real-provider/device acceptance, installed activation, public CI success or
formal quality tier is claimed. See PRODUCT.md, COMPATIBILITY.md and QUALITY.md.
The dated sections below are historical evidence, not current deployment status.

# Acceptance evidence — 2026-10-28 development candidate

Evidence levels are distinct. Automated checks are not the 42 planned acceptance
cases, and a native synthetic fixture is not a real-provider or physical-speaker
test. No release gate is waived by this document.

## Executed

- Node suite: 74 tests passed, zero failed/cancelled/skipped.
- HA suite: 40 tests passed; dependency/HA deprecation and AppKey warnings remain.
- Production plugin + native HA paired proof: passed on OC 2026.10.3 / Node
  24.18.1 and HA 2026.10.4 / Python 3.14.10, FFmpeg 7.1.5.
- Full native config flow, three registered entities, native batch STT, spoken
  query, interactive start, follow-up mode retention and unload passed.
- Native playback bytes arrived before the model's final text. A separate gated
  normalizer test withheld provider EOF until audio was observed, then checked
  owned transport cancellation/release. Neither proves physical sound.
- PCM/float WAV headers split across provider chunks, 8/16/24/32-bit integer,
  32/64-bit float, stereo-to-mono, resampling, finite-data trailers, malformed
  metadata, truncation and mixed WAV/FLAC sentences have decoder checks.
- Native bundled OpenAI buffered TTS and ElevenLabs progressive audio paths used
  synthetic local HTTP providers. Explicit profile STT/TTS model/voice differed
  from native defaults and the expected overrides reached those providers.
- Normal selected-agent tools/workspace and incremental text passed; saved
  shared-session model/thinking/fast preferences stayed unchanged.
- An explicitly denied, registered fixture tool was attempted through native
  dispatch and did not execute. A registered test-harness-owned locked session
  rejected conflicting model selection before any inference, preserving its lock.
- Five admin RPC methods denied a read-scope client with no cached owner device
  credentials. Production scoped pairing, exact request replay without another
  turn, caller ownership and revocation also have executed evidence.
- HA overlap rejection, task-local speech-feed association, 60-second pending
  playback expiry and diagnostics allowlist/redaction have targeted checks.

## Mapping to planned cases

“Partial” means useful executed evidence exists but the entire acceptance setup
or its real-world variants have not been claimed. Detailed original pass criteria
remain in `planning/05-ACCEPTANCE-AND-TEST-MATRIX.md`.

| Cases | Current evidence / outstanding scope |
| --- | --- |
| T01, T06, T41, T42 | Non-default selected-agent native context and unit-tested agent/profile namespaces; real multi-agent/account deployment matrix pending |
| T02, T18 | Native independent speech, selected-agent turn and exact caller framing exercised; physical multi-room routing pending |
| T03, T04 | Native credential resolver/overrides and capability fallback exercised with synthetic keys; real-account/stage-local failure matrix pending |
| T05 | Not run: requires approved real-provider calls |
| T07, T12 | Run-scoped model/thinking and unchanged preferences, native lock rejection; actual fast-tier/account/runtime support matrix still partial |
| T08 | Native finalized-input batch path proven; realtime finalization SDK gap documented, no speculative turn dispatch |
| T09 | Native early playback-byte delivery and separate gated provider-EOF decode proven; audible timing not run |
| T10, T11 | Unsupported-stream fallback, buffered input, no replay on provider failure exercised |
| T13 | Speakable projection, reasoning/tool/fallback exclusion, multi-message and Unicode contract checks |
| T14 | Decoder continuity/header/limits and queue backpressure checks; actual device/codec matrix partial |
| T15, T16 | Cancellation fencing, decoder transport release, lost owners, recovery/reload/unload checks; live transport/device races pending |
| T17, T22, T23, T24 | Real HA loader/config entries/entities/actions/chat logs, interactive override/follow-up and unload exercised with synthetic satellite |
| T19 | Job admission/backpressure/owner generations and HA overlap isolation checked; real shared-session multi-room load pending |
| T20, T21, T25, T26 | Closed control inputs, fresh-history mappings, atomic initial binding, rebind/reset/rollover contract checks |
| T27 | Native setup/options/reauth source, stable entity IDs and profile-revision cache key; real cache/device behavior partial |
| T28 | Not run on physical clients/local-intent deployment |
| T29, T30 | Scoped credentials, five native admin denials, revocation and allowlisted diagnostics checks; installation logs/backups still operator-owned |
| T31 | Stage-specific status and first-byte timestamps; no audible-completion claim |
| T32, T33 | Public SDK/source and exact tested pair; broader versions are not certified |
| T34 | Original MIT code and provenance documented; no application-source copying |
| T35 | Native tool denial and locked session fail closed; native approval UI/account-specific policies pending canary |
| T36 | Bounded stores/queues/jobs, owner-loss, TTL and schema rejection checks; no cross-version migration or crash-spool cleanup certification |
| T37 | Durable idempotency, request conflict, replay gap and ambiguous work checks; no automatic prompt replay |
| T38, T39 | Review artifacts and installation/rollback procedure prepared; unfamiliar-operator/live upgrade/rollback not run |
| T40 | Planning, source checkpoints, failure notes and continuation ledger maintained |

## What is not claimed

No production service/config/installed bundle, provider account, real user audio,
HA default pipeline or household device was changed. No public release or HACS
publication occurred. This candidate is **not release-certified**: the remaining
real-provider/runtime/approval/client/hardware and installation/rollback gates
must be run in an explicitly approved controlled canary.

## Failed attempts retained

The provider-EOF test initially timed out: FFmpeg's WAV demuxer still probes
64 KiB after an extensible-header rewrite. That rewrite did not solve latency.
The final parser derives raw decode settings from bounded WAV metadata and strips
only that wrapper; gated early-output and cancellation now pass. Bare raw PCM is
still rejected. A first edit attempt used a wrong relative working directory;
it made no source changes before being corrected.

The first native lock fixture tried to patch an ordinary session. OC correctly
rejected that because only a registered harness owner may create/patch locked
sessions. The proof now registers its own explicit-only synthetic harness and
creates only its own locked session through the public API. It does not loosen
ownership, patch core, or alter the production plugin's authority.

## 2026-10-28 next-turn settings/timing checkpoint

Candidate 0.0.1-dev.1: 81 OC + 41 HA tests pass; extended native proof verifies
in-flight settings isolation, next-turn model/thinking switch on the same handle,
retry recovery without redispatch, eight owner-RPC denials, content-free timing,
and continued early decoded audio. This is disposable-runtime proof only. Live
installation, realistic latency benchmarking and acoustic start timing remain
separate acceptance gates. See docs/TIMING.md for measurement boundaries.
# dev.5 clarification continuation gate

The earlier native-control acceptance did not prove automatic satellite
re-listening. dev.4 returned false for every projected reply, including spoken
clarifications. dev.5 adds explicit turn-scoped `voice_conversation` intent and
passes it through the existing terminal/result flag.

Local coverage: default false, true clarification, explicit false/stop,
follow-up reset, empty speech, punctuation not control, malformed arguments,
cross-session/incarnation isolation, cancellation, stale invocation, closed
lease and failed dispatch. The opt-in native-pair runner also invokes the
OC-owned `tests/native_continuation_proof.py` against the unchanged HA checkout:
real model tool execution -> wire flag -> HA ConversationResult, with/without
native Assist, same conversation handle, and identical-request replay.

Activation still requires owner approval for the installed plugin and any safe
restart. Then verify ordinary real-Jarvis clarification and an owner-observed
satellite answer without a second wake word; finish with stop/completed-answer
behavior. Do not equate a synthetic model result with hardware acceptance.

## Stale binding recovery candidate — 2026-10-29

Bridge dev.7 + HA dev.4: scoped regression coverage includes retained-ID profile
change/expiry, same native history/mode, caller/target fences, overlap/cancellation
and known-job no-redispatch even when replay/status fails before text. Native
HA2026.10.4 retains the satellite ID through the legacy null-ID error and then
processes clarification/follow-up with the replacement transport. The isolated
production-plugin/HA paired proof also passes with synthetic model/speech
providers. These are local/disposable proofs, not installation or physical
acceptance of these versions. Live activation and bathroom retesting remain
separate gates.

## Comprehensive logging candidate — 2026-10-29

OCdev.9 + HAdev.5: all36source modules reviewed, shared diagnostic contract and
per-module audit recorded. OC125tests and HA73tests pass. Native paired proof
checks bounded rings, common request/job/span correlation, no private canaries,
normal/hidden-target native controls, continuation/stop/recovery and early audio.
Fault injection covers auth/status, metadata/receipt/storage, timeout, decoder
races, primary-vs-cleanup errors, startup diagnostics and actual action receipt
correlation. This is source/fixture proof, not deployed logging or physical
acceptance. See [logging guide](LOGGING.md).
