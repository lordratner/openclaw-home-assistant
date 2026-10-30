# Paired voice protocol v1

Implemented contract: protocol major 1, minor 2. OC candidate 0.0.1-dev.10 keeps the existing HA wire contract. This is a development candidate, not a claim of live acceptance.

## Ownership and transport

OpenClaw selects one existing agent, inference controls, speech policy and the
persistent target. HA selects connection, conversation mode and playback target.
No client field can choose an arbitrary OC agent, session key, provider or model.
The plugin registers `/plugins/openclaw-home-assistant/v1` on the existing
Gateway listener; it does not open another port. Use HTTPS across untrusted
networks. HTTP is supported for controlled loopback/trusted-network development.
Redirects are never followed by the HA client.

Responses and error bodies use `Cache-Control: no-store`. Control endpoints use
JSON. Job responses and microphone/text uploads use UTF-8 newline-delimited
JSON, one object per line, maximum 65,536 bytes per line. Audio chunks use base64.
A response is not successful merely because its HTTP status is 200: it must end
with a valid terminal event. No data may follow the terminal frame.

## Pairing and administration

Owner Gateway RPC methods require `operator.admin`:

| Method | Parameters |
| --- | --- |
| `openclaw_home_assistant.status` | `{}` |
| `openclaw_home_assistant.inference.get` | `{}` |
| `openclaw_home_assistant.inference.update` | `expected_revision`, nonempty `patch` with only `model`, `thinking`, `fast`; null resets a field |
| `openclaw_home_assistant.diagnostics` | optional integer `limit` (1–32, default 20) |
| `openclaw_home_assistant.pairing.issue` | optional `label` |
| `openclaw_home_assistant.clients.list` | `{}` |
| `openclaw_home_assistant.clients.revoke` | `client_id` |
| `openclaw_home_assistant.persistent.rebind` | `expected_revision`, `session_key` |

Pairing codes are one-use, expire after five minutes, and are stored as hashes.
`POST /pair` accepts only `pairing_code`; it returns `client_id`, `client_token`,
`agent_id`, and `capabilities`. HA stores the scoped token in its normal config
entry storage. This is a credential: HA backups must remain protected. OC keeps
only its hash. Neither a Gateway owner token nor provider key is copied to HA.
There are at most eight outstanding pairing codes and sixteen clients per
agent/profile namespace. Pairing has a ten-attempt/IP/minute limit. Authenticated
requests have a 120-request/client/minute limit.

Subsequent HTTP requests use `Authorization: Bearer <client_token>`.
`DELETE /pair` revokes that client. Owner revocation also fences active output
and requests cancellation of jobs owned by that client. Changing the selected
agent invalidates old-client access; it never migrates their histories.

## Control endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /capabilities` | Protocol/revision, selected-agent ID, languages, execution modes and limits |
| `POST /conversations` | Open/reuse caller-bound conversation with `protocol_major`, `profile_revision`, `ha_conversation_id`, `mode` |
| `DELETE /conversations/{handle}` | Close caller's mapping, never delete native history |
| `POST /turns` | `protocol_major`, `profile_revision`, UUIDv7 `request_id`, `conversation_handle`, `text`, optional reference `context` |
| `POST /tts` | Incremental text upload and canonical audio response |
| `POST /stt` | Incremental canonical PCM upload and one finalized transcript |
| `GET /jobs/{id}` | Caller-owned execution/result status |
| `GET /jobs/{id}/events?after=N` | Replay/resume the same job, never execute it again |
| `POST /jobs/{id}/cancel` | Request output fencing/cancellation |

Modes are `persistent` and `per_conversation`. A fresh HA conversation in the
latter mode gets one fresh OC session; follow-ups reuse it. Persistent target
selection stays in OC. An unset initial target is created and durably bound on
first use. Missing/replaced targets fail closed. Proven native rollover lineage
may be adopted by a *new* conversation; an old physical-session handle ends.
HA mode overrides survive integration reload, but not arbitrary HA process
restarts; expired/changed handles require a new conversation. Idle bindings are
bounded to 1,024 entries and expire after fifteen minutes. Fresh history is not
incognito and does not disable normal agent memory, tools or permissions.

Profile revisions bind configuration snapshots. New work rejects a stale
revision; an already accepted exact request can still be recovered. Integration
capabilities refresh every thirty seconds. Profile/agent changes cannot silently
retarget an old conversation. Reload stops/fences old owned work; it does not
promise uninterrupted completion across configuration changes.

Owner inference updates are different: their independent inference revision
does not change the profile/binding revision. Preferences are captured before
new job admission and stored on its receipt; already-admitted exact-request
retries use their original work and snapshot even after a preference update.
Updates persist per agent/profile and do not mutate native session defaults.
An update does not terminate active work. Bootstrap config edits retain their
existing replacement semantics. See the README for reset/inherit precedence.

## Job events and recovery

Every event contains `protocol_major`, `profile_revision`, `request_id`, `job_id`,
monotonically contiguous `sequence`, and `type`. Optional response headers
`X-OpenClaw-Job-ID` and `X-OpenClaw-Request-ID` identify accepted work early.

- `phase`: running.
- `model`: observed actual provider/model, not a guessed pre-hook selection.
- `text_delta`: `message_id`, speakable assistant `text`; multiple assistant
  messages are separated by HA without repeating earlier text.
- `transcript`: final text, `final: true`, actual STT mode.
- `audio_start`: canonical segment metadata, actual sentence synthesis mode.
- `audio_chunk`: `segment`, base64 `audio`.
- `audio_end`: segment complete.
- `done`: stage-specific completion metadata; not proof of audible playback.
- `error` / `cancelled`: terminal failure/cancellation; never read raw exceptions aloud.

Durable UUIDv7 receipts bind caller, request ID, kind, profile and canonical
payload fingerprint. Conflicting payload reuse fails. A duplicate turn never
executes again. If execution ownership was lost on process death, report
`interrupted` / `execution_outcome_unknown`; do not infer that tools did nothing.
HA reconnects only to the same job's events/status; it never POSTs the prompt
again to recover a lost reply. Recoverable completed text must match the prefix
already delivered, or recovery fails rather than repeat/change spoken content.
STT/TTS upload duplicates are rejected as already admitted; input is not replayed.

Defaults: 16 active jobs/profile, 4/client, 64 retained in-memory jobs, 2,048
receipts, five-minute job deadline, 1 MiB event window/job, 1 MiB combined retained
result budget, 24-hour request-age window (+ clock-skew allowance), one-hour
completed-result availability. Results/receipts are reclaimed on subsequent
state operations; these are availability bounds, not guaranteed disk-erasure
alarms. Native OC history and HA's own caches have separate retention policies.
The plugin metadata file is capped at 8 MiB and requires a single Gateway owner
process. Same-process reload generations share serialization; cross-process
shared-state writers are unsupported. Unknown state versions fail closed.

Additive `inference` and terminal `timing` fields are available on owned job
status. The owner diagnostics method omits job result text and returns only
bounded operational fields. Timings share the receipt retention/size bounds;
per-job synthesis detail retains the first 16 segments. No new stream event type
is required, so existing v1 clients remain compatible. Streaming HTTP responses
send `X-Accel-Buffering: no`; honoring it remains a proxy responsibility.

Cancellation immediately fences output. Some native buffered provider calls
cannot be aborted; `cancellation_confirmed: false` is intentional and must not be
presented as confirmation that provider computation or tool side effects stopped.

## STT and TTS uploads

Both start with `type: start`, protocol major, profile revision, UUIDv7 request
ID and language. Upload frames thereafter have contiguous sequences beginning
at one; the final frame is `type: end` with the next sequence.

STT additionally declares `encoding: pcm_s16le`, `sample_rate: 16000`, `channels: 1`.
Audio frames contain `type: audio` and base64 `audio`, at most 32,768 decoded bytes
and complete 16-bit samples. Total microphone input is at most 2 MiB (~65.5 s).
OC wraps the finalized input in a private WAV for its native transcription API;
spool files are removed on normal completion/error/cancellation. Crash cleanup
is not yet a verified retention guarantee. Empty input performs no inference.

TTS frames contain `type: text` and `text`, at most 65,536 UTF-8 bytes in total.
Sentence segmentation is bounded (600 UTF-16 units), Unicode-safe and avoids
common title/decimal chunk-boundary errors; it is not a universal linguistic
parser. Native progressive audio is preferred. An explicit unsupported-streaming
capability falls back to buffered sentence synthesis; provider failures do not
trigger replay after partial output. Fully buffered text also works.

Provider containers are decoded to one continuous mono PCM16/24 kHz WAV with a
single header. FFmpeg must be on PATH. Accepted self-describing inputs include
MP3, WAV, FLAC, Ogg/Opus, AAC, M4A, WebM and AIFF; not every codec/device combination
has native acceptance evidence. Raw PCM without declared metadata is rejected.
WAV PCM/float metadata is parsed within a bounded header to avoid FFmpeg's 64 KiB
SPDIF probe; raw decode settings come from that header, never a provider name.
Canonical output is limited to 32 MiB. HA prefers WAV but native device format
requests take precedence. Device-side conversion can add buffering.

## Data and failure boundaries

Plugin state stores client hashes, bindings, receipts and bounded recoverable
completed text/transcripts, not provider credentials or full input prompts.
Streaming audio replay exists only in bounded process memory; STT has temporary
private files. OC/HA/provider logs and caches remain independently governed.
HA diagnostics allowlist operational facts and exclude URLs, identities, tokens,
prompts, replies, audio and arbitrary backend extensions.

Profile change, expired mapping, missing persistent target, revoked credential,
request conflict, replay gap, capacity and provider failure are real errors,
not excuses to silently start another agent turn or change provider policy.

## Native Assist extension (protocol 1.1)

See [native Assist](NATIVE-ASSIST.md#protocol-11-additions) for the optional native bundle, job tool events, one-time claims, result submission and failure/replay boundaries. No raw HA credentials or callback URL is sent to OpenClaw.

## Stale voice-binding recovery (bridge dev.7 + HA dev.4)

A native satellite may keep its HA chat ID after a profile change or idle expiry.
An authenticated current-revision conversation open now rotates that caller's
obsolete/expired transport handle under the same HA ID after validating its
original native target. Mode, caller/agent ownership and native session/history
are preserved. Old handles remain invalid; native target or owner-rebind
mismatches are not silently repaired. Existing admitted jobs keep their receipts
and recovery path even when the transport handle rotates.

HA attempts one capability refresh/reopen only after an explicit pre-admission
profile_changed, conversation_expired or conversation_not_found rejection. It
keeps the same request UUID across safe attempts, and serializes requests for
one native HA ID. Any observed event or known admitted job ID fences retry,
including when same-job replay/status fails before text arrives. Transport
uncertainty, authority/mode/target errors and a second rejection do not redispatch
inference or device actions. Compatible follow-ups retain their mode and normal
continuation behavior. Capability/voice changes do not require clearing Jarvis
history or re-pairing.

Local diagnostics may include allowlisted recovery_reason, failure_reason and
failure_stage, never raw error text, prompts, audio, credentials or identity IDs.
No new protocol fields, privileges or core/native-HA patches are required.

## Safe diagnostic extension (logging candidates)

Error/status/owner-diagnostic records may include a bounded `failure` object:
allowlisted stage, reason/category, provider/status/system/exception metadata,
classification source, ephemeral keyed fingerprint and bounded causes. Existing
outward codes and scope requirements are unchanged; older clients may ignore
these optional fields. The HA client retains safe metadata without logging speech
or raw error bodies. Owner diagnostics additionally expose `observability`; during
startup/storage failures, `ready`, `partial`, `startup_code` and
`unavailable_sections` distinguish missing sections from empty successful results.
See [logging contract](LOGGING.md). No new replay or retry authority is conveyed.

## Additive product capabilities (protocol 1.2)

`service: {instance_id, profile_id}` contains durable non-secret UUIDs, independent
of URL, profile revision and scoped client credentials. Profile identity changes
when the selected agent/profile changes, not when its voice or model changes.
The backend stores identities in its normal metadata v1 document; existing
clients/bindings/receipts are not rewritten or reset. Identity corruption fails
closed rather than silently creating another identity.

`stages.conversation`, `.stt` and `.tts` independently expose `state`, tri-state
`available` and `verified`. `available:false` means a locally known blocker; null
means native provider/account availability has not been established. Configured
is not verified. A successful real operation records `verified_at` and
`verification:last_operation`; it is historical evidence, not an uptime promise.
Failures retain sanitized details and never cause automatic re-execution.

STT/TTS advertise their own languages/default_language, explicitly marked
`languages_source:configured`. They inherit legacy profile declarations unless
overridden. The public host API does not provide universal provider language or
account-access discovery. No paid startup probe is performed.

HA config-entry v2 migrates history preference from data to options. Stable
service identity replaces the credential-derived unique ID when available,
without changing entry/entity IDs, token, selected mode or conversation history.
Duplicate or concurrent pairing flows reject and revoke only the unused newly
issued credential. Reauth/reconfigure reject a different backend/profile/agent.
A legacy entry must establish identity at its original URL before a reauth move;
normal reconfigure tests the current credential against the same backend.
Legacy1.0/1.1 backends remain usable, with legacy URL+agent duplicate checking.

`stt.batch` optionally selects a native batch provider/model. Empty object
inherits native configured batch policy. Without an override, an SDK-identified
batch-only provider/model keeps its explicit primary selection, including native
request/auth options. An absent finite-input runtime uses native batch with that same selection.
An empty `batch` object explicitly selects the inherited native batch policy. No
vendor realtime-to-batch model alias or new provider transport is guessed.
Native configuration determines any downstream provider fallback.

The query action optionally accepts `tts_entity` to speak through an existing
HA TTS engine. HA handles its buffered/streaming contract; OC-specific profile/
action options are never sent to that engine. Satellite interaction uses its
existing selected Assist pipeline. Neither path changes preferred pipelines.

Startup cleans at most512 generated `stt-XXXXXX` directories older than24h under
this profile's private audio root. Recent work, symlinks and unrelated directories
are left alone. This is bounded startup cleanup, not an offline24h deletion SLA.
