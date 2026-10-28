# OpenClaw Home Assistant plugin — detailed development plan

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: DRAFT FOR OWNER REVIEW. Planning complete does not mean implementation authorized.
Revision: 1, 2026-10-27.

## 1. Mission and handoff

Build one reusable OC plugin that exposes OC-owned transcription, real agent conversation, and synthesis to HA and future voice clients. It owns all voice inference/session policy and uses OC's provider/runtime/auth facilities. It does not become a second assistant implementation.

Read alongside:

- [Requirements](01-REQUIREMENTS-AND-DECISIONS.md).
- [Shared contract](02-SHARED-ARCHITECTURE-AND-PROTOCOL.md).
- [HA counterpart plan](04-HOME-ASSISTANT-DEVELOPMENT-PLAN.md).
- [Acceptance matrix](05-ACCEPTANCE-AND-TEST-MATRIX.md).
- [Reuse evidence](06-RESEARCH-REUSE-AND-LICENSE-REVIEW.md).
- [Risk gates](07-RISKS-AND-COMPATIBILITY-GATES.md).
- [Execution ledger](08-EXECUTION-CHECKLIST-AND-HANDOFF.md).

Future repository: separate new plugin repository; final name/package ID not selected.
Primary requirements: R01–R27, R34–R58. Shared interfaces also cover R28–R33.

## 2. Success criteria

A neutral configured OC agent can be used through both persistent and new-conversation sessions with profile-selected model/thinking/fast controls. Speech providers come from OC, not plugin-specific copies. HA can consume all three services through one authenticated client. Streaming is selected where available and useful degraded operation remains available otherwise.

Release proof includes:

- T02 end-to-end three-stage host-backed flow.
- T06/T07 exact session and inference behavior.
- T08–T14 progressive/buffered speech behavior and format integrity.
- T15/T16/T19 cancellation, concurrency and lifecycle.
- T25/T26 atomic persistent binding and explicit missing-target behavior.
- T29/T30 authority and credential containment.
- T41/T42 explicit agent selection, dedicated-agent deployment and agent-switch boundaries.
- T32/T33 supported host API and paired-version compatibility.

The plugin is not complete if only TTS/STT works with direct provider keys or if conversation is a bare model call without the selected agent's tools and context.

## 3. Non-goals and forbidden shortcuts

- No hard-coded provider, model, agent, host, person, region or satellite.
- No second OpenAI/ElevenLabs client library stack merely because upstream examples used one.
- No changes to a configured agent's global model/prompt/memory/tool policy.
- No private dist-bundle imports, installed-package patches, direct internal session DB edits, or privileged shell execution as a speech API.
- No speculative tool-bearing agent run from unstable partial transcripts.
- No complete project fork with avatar/CLI/local-daemon assumptions.
- No full-duplex guarantee where client/HA/provider hardware cannot provide it.
- No silently unsupported or misleading streaming status.
- No provider rejection solely for missing streaming.
- No automatic provider account switching beyond OC's configured policies.
- No publication, live installation or restart under this planning authorization.

## 4. Proposed repository layout

Planning targets, not files created in this phase:

    README.md
    LICENSE
    THIRD_PARTY_NOTICES.md
    openclaw.plugin.json
    package.json
    src/
      plugin.ts
      config/
        schema.ts
        resolve-profile.ts
        validate-profile.ts
      host/
        capabilities.ts
        agent-dispatch.ts
        sessions.ts
        transcription.ts
        synthesis.ts
        auth-context.ts
      protocol/
        operations.ts
        events.ts
        validation.ts
        errors.ts
      state/
        persistent-binding.ts
        conversation-mappings.ts
        request-receipts.ts
        migrations.ts
      jobs/
        registry.ts
        cancellation.ts
        cleanup.ts
        admission.ts
      audio/
        formats.ts
        streaming-output.ts
        buffered-spool.ts
      speech/
        sentence-scheduler.ts
        speech-projection.ts
      diagnostics/
        metrics.ts
        redaction.ts
    tests/
      unit/
      host-contract/
      integration/
      protocol-fixtures/
    docs/
      DEVELOPMENT-PLAN.md
      protocol-v1.md
      configuration.md
      compatibility.md
      troubleshooting.md
      release-and-rollback.md

Use the host's recommended plugin build/package conventions and supported runtime entrypoints. Do not create a generic framework abstraction beyond the small host adapters needed for testing/version compatibility.

## 5. Configuration design

### 5.1 One v1 profile

The plugin settings need:

- Agent reference.
- Explicit agentId selection against the configured/permitted agent roster; Gateway plugin installation is not per-agent routing by itself. No implicit main fallback for a multi-agent fleet.
- Optional explicit persistent-session reference.
- Conversation model selection or intentional inheritance.
- Thinking selection or intentional inheritance.
- Fast selection or intentional inheritance.
- STT provider/model selection with inheritance and optional language.
- TTS provider/model selection with inheritance and provider voice.
- Necessary operational limits, kept out of the basic settings flow where possible.

Provider credentials remain in normal OC auth/profile/secret configuration. A profile may reference supported OC auth/account selectors if required by public APIs; it must not introduce a parallel secret store.

Future profiles can reuse the same configuration shape; v1 need not expose a profile matrix.

### 5.2 Validation

Validate before admitting new work:

- Agent exists and is available to the authorized use case.
- Persistent target, if supplied, belongs to the intended agent and is authorized.
- Model exists under OC's configured catalog/permissions and supported runtime.
- Thinking/fast options are accepted or intentionally inherited with visible effective behavior.
- Speech provider/model/voice/language selections resolve through OC.
- At least one usable path exists for each required requested stage.
- Missing streaming capability selects a degraded path; missing all usable paths reports unavailable.
- Output metadata and limits are valid.
- Profile revision changes are recorded and reflected in capability discovery.

Do not hard-code a universal list of effort levels or reinterpret fast as a generic low-latency switch. Use OC's own mappings and report effective values where they differ.

### 5.3 User interface

Prefer the supported OC plugin settings/schema surface. A validated session/model reference field is acceptable if dynamic pickers are not supported, provided users can see the resolved target/model and actionable validation errors. Do not build a custom dashboard or portal merely to add a selector without reviewing necessity.

HA must not require full session/model/provider catalog access to configure its client.

## 6. Milestones and detailed steps

All milestones below are NOT STARTED. Each lists work to perform only after owner approval.

### P00 — Approval, repository and provenance bootstrap

Goal: establish a clean, bounded project before code.

1. Obtain explicit approval for this product plan and record scope in the execution ledger.
2. Select repository/package/plugin IDs and verify collisions against OC/npm and relevant existing projects.
3. Confirm repository ownership, visibility and selected project license before any public creation.
4. Create only the approved plugin repository; do not create or edit the HA repository under backend-only scope.
5. Copy the approved module/shared planning documents into the repository with contract revision references.
6. Set host-version/build tooling constraints from the chosen public SDK release, not from a developer's installed machine.
7. Record third-party candidates, exact commits, licenses and intended reusable files.
8. Establish a small contribution/check workflow, test/evidence directories and changelog policy.

Deliverables: repository skeleton, license/provenance record, approved plan snapshot.
Exit: no unresolved ownership/license ambiguity; T34/T40 planning checks satisfied.
Dependency: no source copying or live plugin installation before this exit.

### P01 — Public OC capability and inference proof

Goal: validate the critical host integration before implementing a large service.

1. Select candidate supported released OC versions; record source/tag and API evidence.
2. Prove public access to transcription capabilities: realtime input and batch finalized-utterance paths.
3. Prove public access to synthesis: progressive audio and completed-buffer output, including cleanup ownership.
4. Prove selected-agent dispatch executes a normal agent turn with memory/tools/permissions and emits real speakable deltas.
5. Prove model/thinking/fast application for a new session.
6. Prove the same controls for an existing persistent session without temporary patch/restore races.
7. Inspect permission requirements for the dispatch and session calls; ensure proposed client scope does not turn into general operator authority.
8. Prove targeted event delivery, disconnect cleanup, and cancellation or accurate cancellation-unconfirmed reporting.
9. Distinguish source/API availability from executed proof. Use a controlled test agent/profile and synthetic inputs only when authorized.
10. If a required public API is absent, write an upstream-gap report with a smallest generic proposed change, affected versions, alternatives and test requirements.
11. Do not edit OC core or open a PR without the additional project/publication authority required for that action.
12. Document accepted host adapters and declare a provisional compatibility floor based on evidence.

Deliverables: G01/G03/G04/G05 evidence, API inventory, public-versus-private boundary record.
Exit: viable supported path or an owner-reviewed upstream dependency. No pretending a fallback bare LLM call satisfies selected-agent behavior.
Acceptance: T02, T07, T12, T29, T32.

### P02 — Versioned protocol and host-adapter contracts

Goal: backend/client developers work against one stable contract.

1. Finalize operation/event names after namespace review.
2. Define closed required fields, optional extension fields, identifiers and safe error enums.
3. Define audio-start/chunk/end metadata and sequencing, control/text sequencing and terminal semantics.
4. Define capability discovery modes independently for STT, agent text, TTS input and TTS output.
5. Define request conflict/dedup behavior and caller-bound job status.
6. Define persistent/per-conversation mode fields without exposing arbitrary target-session control.
7. Define profile revision consistency and binding revision validation.
8. Agree fixtures with the HA owner: progressive, sentence-buffered, fully buffered, interrupted, missing target, provider unavailable, concurrent rooms.
9. Define transport and output-format limits through bounded experiments; record proposals versus chosen release values.
10. Publish language-neutral contract fixtures in the plugin repository; ensure the HA plan references the same revision.

Deliverables: approved protocol-v1 specification and fixtures.
Exit: both teams review compatibility and no required lifecycle is unspecified.
Acceptance: T14, T18, T31, T33.

### P03 — Plugin registration, configuration and capability resolution

Goal: load a configurable provider-neutral plugin without side effects.

1. Register manifest/schema/UI hints and safe configuration validation.
2. Implement profile resolution through OC runtime/provider/model capabilities.
3. Preserve normal credential resolution; use test fakes to prove no provider key reaches clients.
4. Register bounded plugin RPCs/services using the verified scope mechanism.
5. Implement capability/status projection without raw config/session/provider-secret exposure.
6. Support selected-agent and model/thinking/fast settings, with inheritance explicitly represented.
7. Validate voice/language selections without a provider-specific dependency tree.
8. Make invalid configuration fail new admission with actionable diagnostics; retain already admitted jobs' consistent state where authorized.
9. Implement configuration reload/unload hooks and profile revision changes.
10. Ensure loading the plugin does not create sessions, call paid providers, alter default models, or activate audio capture.

Deliverables: loadable plugin/config/status layer with faked host capabilities.
Exit: deterministic safe startup, config validation and status; no inference side effects.
Acceptance: T01, T03, T04, T12, T27, T36.

### P04 — Session bindings and conversation policy

Goal: implement the accepted history semantics.

1. Implement explicit persistent-target validation against canonical agent/session ownership.
2. Implement the UNCONFIGURED/CREATING/BOUND/REBIND_REQUIRED state machine.
3. Use a durable atomic creation receipt and compare-and-set binding to handle concurrent first use.
4. Reconcile crash-after-create-before-bind without creating repeated orphan sessions.
5. Expose the generated/resolved target safely in settings/status.
6. Store fresh conversation mappings by authenticated client/profile/HA conversation identity.
7. Reuse mappings for follow-ups, reconnects and retry receipts.
8. Bound mapping lifetime/storage; distinguish an expired handle from a new conversation.
9. Respect OC lifecycle/reset policies without treating physical session ID rollover as a new unrelated target.
10. Do not silently repair a deleted/reassigned binding with a substitute session.
11. Ensure profile changes and session-agent mismatches are detected before turn admission.
12. Do not delete canonical OC histories in mapping cleanup or plugin uninstall.

Deliverables: versioned plugin-owned state and migration policy.
Exit: concurrency/crash/restart tests preserve exactly the intended context.
Acceptance: T06, T20, T21, T24, T25, T26, T36.

### P05 — Selected-agent conversation dispatch

Goal: make voice a client of the real agent.

1. Build the supported dispatch adapter chosen in P01.
2. Apply profile controls to each admitted voice turn without altering unrelated agent/session defaults.
3. Preserve the selected agent's normal prompt, workspace, memory and tools.
   Resolve provider credentials/model catalogs and session stores in that selected agent context too; plugin-global installation must not fall back to a different agent's auth or history outside normal OC inheritance policy.
4. Forward finalized input once; never dispatch unstable STT partials in v1.
5. Emit speakable text deltas and a consistent final result with run/job identity.
6. Handle tool activity as status, not raw speech or a second external tool broker.
7. Preserve continuation/follow-up facts supplied by OC/HA without guessing that every response ending implies an action.
8. Keep the same request identity for lost acknowledgments; status recovery must not rerun tools.
9. Support ordinary non-streaming model output as a buffered stage rather than incompatibility.
10. Maintain session-ordering rules under concurrent clients and persistent mode.
11. Test normal tool use with harmless fixtures, approval-required fixtures, errors and long-running fixture work.
12. Ensure silent text-only use does not synthesize or deliver audio automatically.

Deliverables: agent-backed conversation service and streaming/status events.
Exit: normal agent identity/capability/history behavior demonstrated; no bare model stand-in.
Acceptance: T02, T06, T07, T13, T19, T35, T37.

### P06 — STT lifecycle and fallback

Goal: turn streamed input into authoritative final transcripts through OC.

1. Admit declared supported audio metadata and reject malformed/oversized frames.
2. Implement bounded streaming upload to a compatible host realtime transcription capability.
3. Surface partials only as provisional recognition; final text controls agent submission.
4. Implement finalized-utterance/batch fallback through the host's media understanding API.
5. Use managed bounded temporary spooling only when required; own cleanup on every exit.
6. Treat no-speech and empty successful transcription distinctly from provider/network errors.
7. Preserve language hints and input budget constraints.
8. Follow OC provider/auth fallback policy; do not introduce a second automatic cloud fallback chain.
9. Test cancellation before final transcript, stream close/drain, provider refusal, billing/quota errors, bad audio and maximum input boundaries.
10. Prove STT can be used independently without an agent/session or unavailable HA satellite fields.

Deliverables: independent STT service, mode/status reporting, temporary-audio lifecycle.
Exit: streaming-capable and batch-only configured fixtures both yield correct final results.
Acceptance: T02, T08, T11, T18, T30, T36.

### P07 — TTS scheduler, synthesis and audio continuity

Goal: speak early when possible and remain useful when not.

1. Accept finite text and text deltas under a stable profile/output-format revision.
2. Implement or selectively reuse a well-tested sentence detector/scheduler.
3. Cover abbreviations, decimals, lists, Markdown, Unicode, code-heavy output, URLs and a final fragment without punctuation.
4. Synthesize speakable content only; never pass hidden reasoning or tool payloads to TTS.
5. Use host progressive synthesis where provider capabilities support it.
6. Use buffered sentence/batch synthesis where progressive output is unavailable.
7. Use completed-response synthesis when incremental text/speech is unavailable.
8. Preserve the same configured provider/account policy unless OC authorizes fallback.
9. Normalize output into one valid negotiated stream; do not concatenate full container headers.
10. Use bounded prefetch/concurrency; a later sentence cannot overtake an earlier sentence.
11. Flush all final text and final audio exactly once.
12. Distinguish capacity/capability degradation from midstream failure; do not replay emitted audio.
13. Avoid OC automatic-reply summarization/truncation pathways unless deliberately part of the requested product behavior; speech conversion must not silently shorten the agent answer.
14. Test cleanup of provider streams, subprocess encoders if used, spooled outputs and queued text.

Deliverables: independent progressive/buffered TTS service and mode telemetry.
Exit: early-speech fixtures pass; buffered fixtures still produce complete valid audio.
Acceptance: T09, T10, T11, T13, T14, T15, T36.

### P08 — End-to-end lifecycle, authority and resilience

Goal: production behavior does not mix rooms, replay work or leak authority.

1. Bind every job to its authenticated caller and admitted profile/binding revision.
2. Implement exact cancellation scopes: speech-only versus linked owned turn.
3. Fence late events and queued audio after cancellation/disconnect.
4. Distinguish local output cancellation from confirmed agent/provider cancellation.
5. Enforce per-stage concurrency, queue windows and spool budgets.
6. Permit parallel fresh conversations; respect OC serialization for the same persistent session.
7. Handle reconnect/status lookup without full-session history exposure or automatic turn replay.
8. Support revocation/unload while jobs are active, with bounded cleanup and safe terminal events.
9. Ensure failures contain safe stage/code details rather than raw credentials/prompts/provider URLs.
10. Revalidate target authority after asynchronous preparation where host APIs require it.
11. Make uncertain cancellation/completion a visible partial/interrupted outcome, not success.
12. Prove one client cannot cancel, subscribe to, retrieve or reuse another client's jobs/handles.

Deliverables: resilient owned job system and authority tests.
Exit: controlled failures do not produce cross-client output or duplicate agent actions.
Acceptance: T15, T16, T18, T19, T29, T30, T35, T37.

### P09 — HA integration contract milestone

Goal: prove the product pair, not just backend unit behavior.

1. Run the agreed shared fixtures against the HA team's client implementation.
2. Verify capability/voice/language metadata fits native HA STT/TTS contracts.
3. Verify a typed conversation, spoken conversation, announcement, action query and interactive action.
4. Confirm persistent target never arrives from HA request bodies.
5. Confirm per-action overrides bind to one conversation only.
6. Exercise mixed modes/providers and provider unavailability.
7. Validate exact origins under simultaneous satellites/clients.
8. Record end-to-end first-audible measurements and full-answer completion evidence.
9. Publish backend/client/host/HA version matrix and unresolved limitations.

Deliverables: paired integration evidence.
Exit: all blocking pair acceptance cases pass on declared versions.
Acceptance: T17–T24, T31–T33.

### P10 — Packaging, documentation and release candidate

Goal: a third party can install without private chat knowledge.

1. Finalize package metadata, manifest, license and notices.
2. Document configuration, supported capabilities, inheritance and profile/session precedence.
3. Document automatic session creation, generated binding visibility, missing-target recovery and uninstall retention.
4. Explain provider/account access and separate billing without claiming subscriptions include arbitrary speech APIs.
5. Document connection trust/revocation and why a general Gateway password is not the normal client credential.
6. Provide neutral example configurations and a generic troubleshooting flow.
7. Include compatibility/migration/rollback instructions that preserve sessions and unrelated settings.
8. Ensure build artifacts contain no development secrets, recordings or private fixtures.
9. Run the appropriate static/build/unit/contract/integration checks once for the candidate and repeat only after material changes/failures.
10. Do not publish, install live or restart a service without the corresponding explicit release/deployment authority.

Deliverables: reviewable release candidate and evidence index.
Exit: T33/T34/T38/T39 complete; owner approves release separately.

## 7. Backend data model

Use supported host/plugin storage, not direct HA/OC internal files.

Records should minimally represent:

- Profile revision and effective nonsecret configuration facts.
- Persistent binding: profile/agent, logical target, creation receipt, validation state and timestamps.
- Fresh mapping: client identity, HA conversation identity, opaque handle, OC target, profile revision and expiry.
- Request receipt: caller/conversation/request identity, admitted operation, run/job identity and terminal/unknown state.
- Job state: owner, stage, sequence, resource ownership, cancellation state and bounded diagnostics.
- Migration version and retention metadata.

Never retain provider credentials, raw audio or full prompt text in diagnostic/idempotency stores merely for convenience. Normal OC transcripts remain canonical agent history. Temporary speech data needs explicit cleanup ownership and TTL.

## 8. Internal host-adapter interfaces to prove

Keep a small typed boundary around:

- Capability lookup and safe provider/model/voice projection.
- Profile validation and auth resolution.
- Session creation/lookup/binding validation.
- Agent dispatch with per-run controls and incremental response projection.
- Realtime and batch transcription.
- Progressive and buffered synthesis.
- Cancellation/cleanup and connection ownership.
- Supported plugin state migration.

Host API differences belong in this boundary, with version checks and contract tests. Do not duplicate a provider registry.

## 9. Observability and benchmarks

Record safe timings for:

- Request received/admitted.
- First/last input audio.
- STT first provisional/final transcript where available.
- Agent admitted/first speakable text/final text.
- First synthesis request/first audio/last audio.
- Client delivery and playback acknowledgment if available.
- Cleanup/cancel request and acknowledgment.

Use same-clock durations where possible. Mark cross-machine timing as approximate unless synchronized. Do not subtract unrelated wall-clock timestamps and call it a precise latency measure.

Primary streaming proof is first audio before final agent text for a controlled delayed-answer fixture. Real provider latency is measured and reported, not promised from a README benchmark.

## 10. Readiness and definition of done

Plugin implementation is done only when:

- All applicable R requirements are traceable to code and tests.
- Blocking G gates are resolved with evidence.
- Both session modes and all profile controls work together.
- Streaming-capable and buffered-only provider paths both work.
- Real agent behavior and safe cancellation are verified.
- HA pair acceptance passes.
- A stranger can configure/use/upgrade/remove the plugin from the repository docs.
- License/provenance notices are correct.
- No core/private dependency is hidden behind a successful local demo.
- Publication/deployment remains a separate reviewed action.

Keep the milestone state, evidence paths, exact revisions, next action and unresolved gates in document 08 or its repository successor after every meaningful work unit.
