# Structured logging and diagnostic contract

Bridge dev.9 + HA integration dev.5. This document describes source behavior;
local/native fixture evidence is not proof of installation or physical playback.

## What is covered

Both projects emit versioned `voice_event` records through their native loggers
and retain bounded operational/failure rings. The full review covers all source
modules: setup/config/options/reauth, policy/auth/pairing, metadata persistence,
binding creation/reuse/rotation, request validation/admission/idempotency, STT
selection/input/finalization, model dispatch/projection, native tools and listening
intent, synthesis/fallback/normalization, action/playback requests, recovery,
cancellation/expiry and shutdown. Pure schema/hash/constant helpers are covered
by their owning operation span rather than dumping their arguments.

One model is used across JS/Python; the paired `diagnostic-codes.json` and
`diagnostic-schema.json` catalogs are identical. No new credentials, permissions,
network listener or provider retry policy is introduced.

## Record fields and correlation

- `schema=1`, `side=oc|ha`, opaque `instance_id`, process-local sequence and wall
  clock `at_ms`; component/operation/phase are static code labels.
- Random `trace_id`, `span_id`, `parent_span_id` connect nested operations. Opaque
  `request_id`, `job_id` and `call_id` link HA and OC wire/tool activity. These IDs
  are correlation keys, never authority. Native session/principal IDs are omitted.
- Phases and elapsed times are local monotonic measurements. Never subtract
  monotonic clocks across hosts, or equate first audio bytes with audible sound.
- Counters describe their operation: STT input bytes/frames, decoded/provider
  segments, replay-journal frames/serialized bytes, or received stream frames.
  They are not a claim of delivery or physical actuation.
- `admitted`, `partial_output`, `continuing`, `tool_result_error`, `error_reply`
  and `confirmed` distinguish important outcomes. Local cancellation/shutdown
  does not assert that remote providers/actions stopped; confirmation stays false
  without an explicit confirmation source. A completed conversation can contain
  a native error reply, which is marked separately without logging its text.

There is no global “next wake” association. Individual STT/conversation/TTS
requests have exact wire IDs; unrelated native pipeline stages are not guessed
to belong together across rooms. Use HA's own pipeline trace and timestamps when
the platform does not supply a common public operation context.

## Failure information

Job receipts persist a sanitized `failure`, also exposed by job status and owner
diagnostics. The existing outward `code` remains compatible; `failure.reason`
can identify a more specific underlying boundary (for example decoder ENOENT).

Safe fields include:

- last/owned failure `stage`, fixed `reason` and operational `category`;
- provider identifier (known IDs, otherwise `other`), known provider error code,
  valid HTTP status or available numeric WebSocket close code;
- allowlisted system/TLS code, decoder exit/signal/container and exception type;
- bounded nested causes, failure count and explicit truncation;
- `classification_source`: structured metadata, fixed known message token,
  system code, exception type or unknown. Token classification is not claimed as
  a provider-supplied structured code;
- `detail_present` and a keyed `error_fingerprint` for grouping unclassified
  errors. The fingerprint is a salted HMAC, not retained message text; its key
  is ephemeral to the process/module lifetime and is not persisted.

Raw errors/stacks, messages, URLs, headers, credentials, prompts/transcripts,
audio, entity states and tool arguments/results are not general log fields.
Unknown upstream causes remain explicitly unknown; no timeout/provider cause is
invented from timing alone. Old receipts that never retained a cause cannot be
retroactively explained.

Primary provider/operation errors survive cleanup failures. Best-effort cleanup
keeps its original nonfatal behavior but emits a separate safe failure event.
Storage failures remain visible in the in-memory/native logger even when a job
failure receipt itself cannot be written.

## Retention, levels and volume

- Per observer: recent128 events and32 failure events; ceilings512/64. Success
  volume does not immediately evict the separate failure ring.
- At most48 distinct phase marks per span. No per-token or per-PCM-frame log I/O;
  streams update counters and first/terminal markers.
- Native log output is capped at8 identical component/operation/phase/reason
  records per minute, followed by a suppression marker. The ring still records
  bounded recent events. Rate keys are capped256.
- Stats explicitly report recent/failure eviction, native suppression and
  observer failures. These logs/rings are bounded, not an infinite forensic log.
- Sanitized persisted failure summaries are capped1024 bytes; up to3 causes per
  level,2 levels. Truncation is explicit. Existing job-receipt retention remains
  bounded by the job store (normally24h); result/audio retention is unchanged.
- INFO covers significant phases/lifecycle and important completed operations;
  WARN covers failures/failed cleanup; DEBUG adds internal storage/control spans.
  Platform log level and rotation still apply. In-memory rings reset on runtime
  replacement/restart; native logs and persisted job summaries provide continuity.

Logging sink errors never retry work or replace its outcome; failed attachment
or sink writes are counted. HA async-generator tracing does not hold ContextVar
tokens across yields, so native consumers can close streams from another task.

## Reading diagnostics

OC owner/admin:

```sh
openclaw gateway call openclaw_home_assistant.diagnostics --params '{"limit":20}' --json
```

Inspect job `code`/`failure`/timings and `observability.recent`, `.failures`, `.stats`.
Diagnostics remain available when service startup fails. If metadata-backed
sections fail, `partial` and `unavailable_sections` identify the missing sections
while the operation ring remains readable. Other owner actions retain their
normal unavailable/auth behavior; admin scope has not changed.

HA: download the OpenClaw integration's diagnostics. Its integration-provided
data contains `local_timings`, runtime `observability`, and global/setup
`setup_observability`. Setup history is included even when no runtime loaded.
Native HA logger records use the same `voice_event` schema.

For an incident:

1. Start with request/job IDs and the relevant instance/time window.
2. Follow parent spans, last phase, safe reason/status/system code and fingerprint.
3. Distinguish pre-admission rejection, admitted work, partial output, recovered
   result and unconfirmed cancellation before deciding what can safely be retried.
4. Check suppression/eviction/observer-failure counters and partial diagnostic
   sections. Do not assume absence from a bounded ring means nothing happened.
5. Playback submitted/provider complete are not physical speaker confirmation.

Gateway/HA authorization denials before the plugin callback, module-import
failures, platform log persistence, provider-internal details not exposed by SDKs
and hardware acoustics remain platform/provider boundaries. Do not patch core,
change credentials, re-pair or replay device actions merely to obtain more logs.

## Verification

The logging audit has per-module coverage/evidence in the paired workspace's
`implementation/LOGGING-AUDIT-2026-10-29.json`. Tests inject auth/quota/timeouts,
bad metadata/protocol, storage/receipt failures, startup unavailability, decoder
failure races, provider/cleanup errors, replay/cancellation and native action
correlation. Redaction canaries, bounded retention, rate/phase/chunk-volume and
cross-task/concurrent trace tests accompany native HA and paired-runtime checks.
Use the final verification receipt for actual executed counts and artifacts.

Native speech calls also record the actual returned provider and safe failed
attempt summaries when native fallback ultimately succeeds. This observes native
policy; it does not trigger another attempt or expose the audio/text/result.
