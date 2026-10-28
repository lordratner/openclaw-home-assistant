# Shared architecture, protocol, and lifecycle contract

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: proposed v1 contract for owner review. Revision: 1, 2026-10-27.
This document specifies future behavior; none of the operation names below are existing OC APIs or implemented endpoints.

## 1. Architecture and product boundaries

### 1.1 OpenClaw plugin

Owns the voice profile, capability resolution, provider access through OC, selected-agent dispatch, session binding, sentence scheduling, speech jobs, authorization checks, cancellation ownership, and diagnostics.

It is an extension of OC, not a replacement model runtime. It must call supported public plugin/runtime APIs. It must not import hashed distribution bundles, patch installed files, bypass permission checks, or maintain its own OpenAI/ElevenLabs client stack to get an initial demo working.

### 1.2 Home Assistant integration

Owns configuration/pairing UX, the shared OC client connection, three native entities, automation actions, HA conversation-mode selection, HA-side lifecycle and error presentation, and conversion to native HA audio/ChatLog contracts.

It is not a second agent, a provider configuration editor, an OC session browser, or a direct HA-control tool server.

### 1.3 Existing framework responsibilities

- OC continues to own agent prompts, memory, tools, runtime selection, provider auth, approvals, session history, and normal provider fallback rules.
- HA continues to own microphone capture, wake words, its pipeline, satellite selection, audio playback and native follow-up mechanics.
- Configured providers continue to own their actual inference and transport capabilities.
- Neither module promises full duplex, speaker identity, zero latency, provider uptime, unlimited quota, or API access conferred by an unrelated subscription.

### 1.4 Logical data flow

~~~mermaid
flowchart LR
    A[HA microphone or satellite] --> B[HA STT entity]
    B --> C[OC plugin STT job]
    C --> D[OC configured transcription capability]
    D --> C
    C --> E[HA transcript]
    E --> F[HA conversation entity]
    F --> G[OC plugin conversation binding]
    G --> H[Selected OC agent and session]
    H --> I[Speakable text deltas or final text]
    I --> J[HA ChatLog and TTS input]
    J --> K[HA TTS entity]
    K --> L[OC plugin sentence scheduler]
    L --> M[OC configured synthesis capability]
    M --> N[Progressive or buffered audio]
    N --> O[HA playback]
~~~

STT/TTS are independent service jobs. They do not need an agent turn or arbitrary session history. Conversation is the only stage that must select a session. A text-only action can skip STT. A plain announcement can use TTS without an agent. No extra LLM call is inserted merely to ask a tool to transcribe or synthesize.

## 2. Minimum shared contract

The protocol must support:

1. Capability and health discovery.
2. Conversation creation/resolution under an authorized mode.
3. Agent turn submission and real incremental/final results.
4. Streaming input STT and bounded batch STT fallback.
5. Streaming-input TTS orchestration with progressive/sentence/buffered output modes.
6. Cancellation, status lookup, completion and error signaling.
7. Recoverable transport reconnection without duplicate agent execution.
8. Explicit context, job and profile ownership.
9. Version and feature negotiation.
10. HA lifecycle binding for automation overrides, without transporting control in model prompts.

Exact public namespaces and package names are selected during repository bootstrap. For this draft, operation names use the provisional namespace ocvoice.

## 3. Transport decision and mandatory proof

### 3.1 Preferred candidate

Use the authenticated OC Gateway connection and plugin-owned RPC registration plus connection-targeted events. Reuse one HA client identity and connection for concurrent STT, conversation, and TTS work where practical.

Reasons:

- Avoid another daemon, port, provider secret store, and duplicated connection setup.
- Reuse OC identity/revocation and connection lifecycle.
- Keep the HA integration a normal client of a reusable backend.
- Permit other future clients to use the same generic voice contract.

### 3.2 Do not assume feasibility from names

G01/G04/G05 must verify the minimum supported public API can:

- Admit the selected agent turn with the effective profile controls.
- Stream actual speakable deltas rather than only completed blocks.
- Deliver events only to authorized subscribing clients.
- Cancel or accurately report uncancelled owned work.
- Send bounded audio chunks with backpressure.
- Register appropriate method scopes without requiring an owner-wide shared secret.

If the Gateway plugin surface cannot carry a required behavior cleanly, record the exact missing API. Consider a narrowly scoped SDK/transport PR or a plugin-owned authenticated streaming route. A separate listener is not an unreviewed default.

Installing a custom plugin is an OC deployment change even when it avoids a core fork. No such installation is authorized in the planning phase.

### 3.3 Wire encoding proposal

Use JSON control frames and base64 audio chunk payloads initially if that fits the supported Gateway contract. Audio chunks must be small and bounded. Raw binary transport is an optimization, not an excuse to create a second incompatible v1 protocol.

Benchmark overhead before release; audio byte rate is usually small compared with unbounded buffering or slow synthesis. Do not claim a selected transport is faster without measurement.

## 4. Identifiers and trust

Every request has:

- protocol_major and protocol_minor.
- request_id: caller-generated idempotency identifier for one logical operation.
- job_id: server-generated identifier for admitted STT/TTS/turn work.
- conversation_handle where conversation state is involved.
- profile_revision: server-admitted settings revision.
- sequence for ordered stream chunks/events.
- optional diagnostic correlation fields, never used as authorization by themselves.

Server-derived identity:

- The OC authenticated client principal is authoritative.
- Client-supplied client IDs, HA user IDs, device IDs, area names, and satellite IDs are routing/diagnostic metadata, not proof of a human identity.
- Agent and actual OC session target are resolved from server-side profile/binding policy.
- An opaque handle must be checked against the authenticated principal, allowed profile/agent and live job ownership.
- Arbitrary client-supplied session keys, provider credentials, model names or tool permission overrides are not accepted in v1 voice requests.

Distinguish logical OC session reference, physical session ID/lifecycle revision, HA conversation ID, transport connection ID, agent run ID, request ID and speech job ID. They cannot be substituted for each other.

## 5. Capability discovery

Proposed operation: ocvoice.capabilities.

Safe response content:

- Server plugin version, protocol versions and tested host API capability revision.
- Profile availability and revision; display-safe selected-agent identity.
- Whether a persistent target is explicitly bound, lazily creatable, missing or inaccessible.
- Allowed session modes.
- STT modes: streaming_audio, final_transcript, partial_transcript when actually available, and batch.
- TTS input/output modes: incremental_text, sentence_batches, progressive_audio, buffered_response.
- Input/output audio formats, sample rates, sample widths and channel counts.
- Supported language/voice descriptors needed by HA entities.
- Effective model control support and safe configuration status, without provider secrets.
- Bounded limits: chunk bytes, concurrent jobs, queue windows, timeouts and spool limits.
- Whether exact cancellation, job reconnection/status recovery and targeted events are supported.

Do not infer execution success from a capability advertisement. Health/configuration readiness and a completed live synthesis/transcription are separate observations.

Do not expose complete OC session catalogs, provider keys, auth.json, sensitive config, hidden reasoning, host paths or arbitrary account inventories.

## 6. OC profile and configuration

Recommended v1 conceptual structure:

    profile:
      agent: selected configured agent
      persistent_session: optional explicit logical target
      conversation:
        model: selected model or explicit inheritance
        thinking: selected valid OC preference or inheritance
        fast: selected valid OC preference or inheritance
      stt:
        provider/model: selected or inherited OC capability
        language: optional supported hint
      tts:
        provider/model: selected or inherited OC capability
        voice: supported provider voice

These are proposed product fields, not a ready-to-apply openclaw.json snippet.

- One profile is enough for v1. Preserve namespaces and protocol profile_revision for future multiple profiles.
- The plugin instance is Gateway-scoped; agentId is an explicit profile-owned routing setting, not an installation sandbox. Resolve every session, provider-auth/model lookup and agent run with that agent context. Namespace plugin state by profile and agent. Do not silently choose main when multiple agents exist.
- Resolve provider access through OC's existing profile/account/SecretRef mechanisms.
- Do not introduce another plaintext API-key field as a shortcut.
- Unknown provider-specific options must not be forwarded blindly from HA.
- Conversation model/thinking/fast remain separate from STT/TTS model choices.
- Model capability menus must reflect OC-supported runtime/account/model facts.
- Fast is a provider/runtime preference; it is not a guarantee of lower latency or a universal free speed boost.
- When using inheritance, expose the resolved effective selection. Do not make hidden session defaults an accidental competing authority.

## 7. Conversation and session binding

### 7.1 Proposed open/resolve operation

ocvoice.conversation.open takes:

- mode: persistent or per_conversation.
- ha_conversation_id or a stable caller conversation identifier.
- optional origin metadata such as satellite_id and language.
- request_id.

It does not take an arbitrary OC session target.

It returns:

- conversation_handle.
- effective mode and profile_revision.
- display-safe selected-agent identity.
- whether a persistent binding was existing or created.
- status and supported recovery behavior.
- an opaque binding revision for later compare-and-set checks if required.

The plugin may retain internal OC identifiers, but HA should not need them to use the conversation.

### 7.2 Persistent binding state machine

States:

    UNCONFIGURED
        -> CREATING, on first persistent request when lazy creation is enabled
        -> BOUND, after atomic durable commit
    EXPLICIT_TARGET
        -> VALIDATING
        -> BOUND or REBIND_REQUIRED
    BOUND
        -> BOUND after ordinary reconnect/restart validation
        -> REBIND_REQUIRED if logical target disappears or authority/ownership changes

Rules:

1. Serialize competing first-use requests per profile and commit exactly one target.
2. After a crash between session creation and binding commit, reconcile through a recorded creation receipt; do not create unbounded orphan sessions.
3. Persist binding state through the supported plugin state mechanism, with schema version and profile/agent ownership.
4. Display the created target in settings/status. If the UI requires a config reference, use a normal supported config update with conflict checks; do not rewrite OC config from every request.
5. Treat ordinary OC physical session rollover/reset separately from deletion/reassignment of the logical target.
6. A previously bound missing target is not equivalent to initially unconfigured.
7. Uninstall/cleanup must not delete an explicitly selected user session.

### 7.3 Per-conversation mapping

Map the tuple of authenticated HA installation/client identity, admitted profile/agent and HA conversation identity to exactly one OC session.

- New HA conversation identity -> new session.
- Follow-up turn -> same mapping.
- Lost acknowledgment retry -> same mapping/request identity.
- Another HA client/conversation -> different mapping unless persistent mode explicitly shares the configured target.
- Transport reconnect -> do not create a new session merely because a socket changed.
- Expired mapping -> explicit conversation-expired outcome and controlled new-conversation behavior, never silent cross-context continuation.
- Store bounded necessary mapping state to avoid loss on normal restart; use OC's own durable turn receipts where possible.
- Do not promise deletion or anonymity. Retention and agent memory remain OC behavior.

### 7.4 Voice profile versus session settings

The voice profile is authoritative for voice inference.

Preferred route: supported run-scoped model/thinking/fast application, with no shared session preference mutation.

Evidence currently establishes separate public controls, not a verified unified path: session create/patch exposes all three; chat.send exposes thinking/fast while agent requests expose model/thinking. G01 must prove the chosen plugin dispatch path honors the entire effective profile.

Forbidden workaround: patch a shared session, execute voice work, then restore settings. Concurrent requests or crashes make that unsafe and nondeterministic.

Changing the configured agent is a boundary change: do not reuse old-agent bindings/handles against the new agent or migrate history. Already admitted work may complete under its captured agent while authorized; new conversation admissions and affected follow-ups must be explicitly ended/rebound. A selected dedicated voice agent is supported but never created automatically by the product.

If public APIs do not permit the required scoped controls, propose a small generic upstream extension, or obtain an explicit owner decision for a different persistent-session ownership model. Do not silently let session preferences override the profile.

## 8. Agent turn operation

Proposed operation: ocvoice.turn.submit.

Inputs:

- conversation_handle.
- finalized user text.
- request_id and optional expected binding/profile revision.
- safe language/origin metadata.

Outputs/events:

- accepted with job_id and run_id when available.
- phase changes.
- text_delta with stable ordering and speakable channel classification.
- text_final or completion metadata, including continue_conversation where supported.
- terminal completed, cancelled, failed or partial_failure.
- structured usage/timing metadata only when OC supplies it.

Only finalized STT text starts an agent turn in v1. No speculative tool-bearing execution on partial recognition. The same OC agent/session tool chain runs as a normal permitted turn.

HA must not replay its entire ChatLog into a persistent OC session. OC owns history. HA ChatLog is a display/streaming projection and native conversation container.

One accepted request must not dispatch a second agent turn because TTS failed or the caller lost a WebSocket response.

## 9. Independent STT jobs

Proposed operations:

- ocvoice.stt.begin with language/audio metadata and request_id.
- ocvoice.stt.audio with job_id, sequence and audio chunk.
- ocvoice.stt.end to commit final input.
- ocvoice.job.cancel / status.

Recommended baseline input: 16 kHz, 16-bit, mono PCM, matching standard HA satellite input. Negotiate additional supported formats; do not claim metadata-only conversion.

Streaming path:

- Validate format and limits at admission.
- Forward audio as it arrives to an eligible OC realtime transcription capability.
- Emit partial results only where supported; final result is authoritative.
- HA may still consume only the final result in its native pipeline.

Batch fallback:

- Buffer/spool one bounded utterance under OC-managed temporary ownership.
- Invoke OC's normal configured batch transcription interface, not an LLM agent.
- Return final text, including an explicit empty/no-speech result where appropriate.
- Clean temporary audio on success, failure, timeout, cancellation and expiry.

No session, satellite identity or conversation handle is required merely to transcribe. Optional correlation metadata is best-effort, not a hidden dependence.

## 10. Independent TTS jobs

Proposed operations:

- ocvoice.tts.begin with language, negotiated output preference, and request_id.
- ocvoice.tts.text with sequence and text delta, or a finite message.
- ocvoice.tts.end to flush remaining text.
- ocvoice.job.cancel / status.

The HA streaming TTS entity passes message chunks as they arrive. The OC plugin owns sentence/batch scheduling so behavior is consistent across future clients.

### 10.1 Scheduler requirements

- Accumulate enough context for stable sentence boundaries.
- Handle abbreviations, decimal numbers, numbered lists, Unicode punctuation, Markdown, URLs, code and unfinished final sentences.
- Do not synthesize hidden reasoning/tool/control events.
- Preserve original display text separately from any documented speech rendering.
- Synthesize the first ready sentence promptly; batch later ready text where useful for voice consistency and request overhead.
- Do not wait for the entire agent response unless that stage/provider actually requires it.
- Never drop the final fragment merely because it lacks punctuation.
- Keep queue memory and synthesis concurrency bounded; preserve output order.

### 10.2 Output modes

Prefer in this order, subject to actual provider support and configured OC policy:

1. Progressive audio from sentence/phrase synthesis while later text arrives.
2. Buffered audio per sentence/batch while later response text arrives.
3. Completed response synthesis when incremental input is unavailable or ineffective.

A buffered conversation model can still feed progressive audio after its final text; report the axes honestly rather than labeling the entire pipeline either universally streaming or universally non-streaming.

### 10.3 Format continuity

- Audio-start metadata precedes bytes and fixes the format for that stream.
- Subsequent chunks carry monotonic sequence numbers.
- Normalize multiple synthesis requests into one valid playback stream.
- Do not concatenate complete WAV files including repeated headers.
- Resampling/encoding must not secretly collect the full response first.
- Any midstream fallback must preserve format and not replay already emitted audio.
- If continuity cannot be guaranteed after a failure, terminate as partial_failure rather than fabricate a clean completion.

## 11. Event lifecycle

Canonical lifecycle:

    requested -> admitted -> active -> terminal

Terminal outcomes:

- completed: this job's declared work completed.
- cancelled: cancellation was confirmed for this job's owned work.
- failed: no successful completion; include safe code/phase/retryability.
- partial_failure: text/audio or work was already delivered/accepted and completion cannot be claimed.

Event fields include job_id, event sequence, profile_revision, phase, timestamps from the same clock domain, and safe metadata.

Do not conflate:

- RPC acknowledgment with agent start.
- Agent completion with synthesis completion.
- Final audio byte sent with audio playback complete.
- Local playback stop with remote agent cancellation.
- Advertised capability with executed streaming.
- Connection closure with provider cleanup acknowledgment.

Playback-complete acknowledgment, if available, is a separate client event. If unavailable, report delivery status as unknown rather than infer audibility from a duration estimate.

## 12. Cancellation, reconnect and retry

- Cancel STT before dispatch: terminate input work; no agent turn should exist.
- Cancel a TTS job: stop its synthesis/queue; do not cancel unrelated agent work.
- Cancel a linked voice turn explicitly: stop owned audio and request cancellation of the exact owned agent run.
- Do not cancel another caller's work merely because it shares a persistent session.
- On disconnect, fence outgoing delivery immediately and follow a bounded owned-job cleanup policy.
- Recover job status from durable receipts where possible; do not automatically replay agent submissions.
- Resume audio only if exact ownership, sequence and a supported recovery boundary are known.
- Otherwise return an interrupted outcome and require a new user/action request.
- Cancelled queued text/audio must not be spoken after the next wake.
- Runtime/provider cancellation limitations must be reported, not hidden.

Capability fallback is not the same as recovering a failed network/provider request. OC's own allowed fallback policy remains controlling. Never obtain extra providers/credentials or duplicate tool execution to preserve a streaming badge.

## 13. Automation overrides and native HA context

### 13.1 Prompt-and-reply

A service call carries prompt, mode override when supplied, optional conversation handle for a legitimate follow-up, and optional spoken-output target.

The integration establishes/resolves the binding explicitly, submits the agent request once, and optionally routes output through its normal TTS path. Where possible, spoken output begins during generation. Final response and delivery statuses remain distinct.

### 13.2 Interactive start

A service call carries target satellite, optional start message, and mode override. Its mode must bind to the intended newly initiated HA conversation and all its follow-ups.

G02 is mandatory because native callbacks do not all expose the same context:

- ConversationInput includes conversation and satellite/device context.
- STT metadata and TTSAudioRequest may not carry those fields.
- Native satellite start_conversation creates its own HA conversation and stores state internally.
- A standard service does not necessarily let an integration inject a conversation ID or arbitrary trusted metadata.

Resolve through supported HA context/lifecycle interfaces and verified propagation. Do not:

- Temporarily change a satellite's global assistant/default integration mode.
- Use one global next-request override.
- Consume an unrelated user's next wake as the automation's conversation.
- Put session-control directives in model-visible prompts.
- Depend on arbitrary writes to another integration's private conversation fields.

If the public HA API cannot establish a correct binding, document the specific gap and seek an explicit extension/architecture decision before implementation. Do not quietly omit the interactive override requirement.

## 14. Resource and privacy boundaries

Negotiate and enforce finite limits. Starting values are engineering proposals to validate, not owner-approved service guarantees:

- Input utterance: up to 120 seconds and 8 MiB decoded input.
- Audio frame: up to 64 KiB, with smaller normal capture chunks.
- Input queue: approximately two seconds of audio before flow control.
- Output queue: approximately ten seconds, bounded additionally by bytes.
- Buffered fallback spool: bounded temporary storage, starting experiment cap 64 MiB.
- Per-client concurrent jobs: starting experiment cap four, separately bound per stage.
- Agent deadline: align with configured OC policy and HA run timeout; do not equate network wait timeout with agent cancellation.

Tune through measurements before release. Publish actual defaults and errors. No unbounded response queues, mapping stores or retained recordings.

Do not log raw audio, full prompts/responses, provider keys, access tokens, session contents or signed URLs by default. Use bounded IDs, modes, provider-safe error codes, byte counts and durations. Any diagnostic content capture is a separate explicit operator option with retention/cleanup documentation, not a v1 convenience default.

## 15. Versioning and contract ownership across two repositories

- Keep a canonical protocol specification and language-neutral fixtures in the plugin repository.
- Mirror a version-pinned copy or consume an accessible released artifact in the HA repository.
- CI compares contract revision and fixture compatibility.
- Independent package versions are allowed; a compatibility matrix must identify valid pairs.
- Major protocol mismatch fails before audio capture/agent dispatch.
- Optional minor features are negotiated; unknown fields do not imply new authority.
- Breaking event meanings require a major revision, not only a package patch bump.
- Add schema/capability version fields now, but do not build speculative profile features in v1.

## 16. Error taxonomy proposal

Use safe, stable codes with stage and retryability:

- authentication_required / revoked / forbidden.
- protocol_incompatible / capability_unavailable.
- profile_unavailable / invalid_model_control / provider_unconfigured.
- persistent_target_missing / target_owner_mismatch / rebind_required.
- conversation_expired / request_conflict / already_accepted.
- invalid_audio / input_limit / queue_limit / output_limit.
- transcription_failed / agent_failed / synthesis_failed.
- provider_quota / provider_billing / provider_unavailable, only where OC can classify.
- interrupted / cancellation_unconfirmed / partial_delivery.
- unsupported_satellite / conversation_binding_unavailable.

Capability_unavailable for a preferred streaming mode normally triggers an allowed degraded path. It becomes a terminal error only if no usable configured path exists or the request itself cannot be honored.

Technical error details stay in redacted diagnostics. User-facing speech/text should identify the failed stage and actionable category without reading stack traces, keys or internal endpoints aloud.
