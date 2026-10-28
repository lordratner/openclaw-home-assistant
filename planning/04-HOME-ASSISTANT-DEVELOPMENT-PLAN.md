# Home Assistant OpenClaw voice integration — detailed development plan

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: DRAFT FOR OWNER REVIEW. No implementation authorized.
Revision: 1, 2026-10-27.

## 1. Mission and handoff

Build one generic native HA integration that exposes OC-backed STT, selected-agent conversation, and TTS plus two automation actions. OC remains the provider/agent/session-policy authority. HA provides its ordinary Assist client and playback experience.

Read with:

- [Requirements](01-REQUIREMENTS-AND-DECISIONS.md).
- [Shared contract](02-SHARED-ARCHITECTURE-AND-PROTOCOL.md).
- [OC counterpart plan](03-OPENCLAW-PLUGIN-DEVELOPMENT-PLAN.md).
- [Acceptance matrix](05-ACCEPTANCE-AND-TEST-MATRIX.md).
- [Reuse review](06-RESEARCH-REUSE-AND-LICENSE-REVIEW.md).
- [Risk gates](07-RISKS-AND-COMPATIBILITY-GATES.md).
- [Execution ledger](08-EXECUTION-CHECKLIST-AND-HANDOFF.md).

Future repository: separate new HA integration repository. Final domain/name not selected.
Primary requirements: R01–R03, R06, R08–R22, R28–R33, R35–R58.

## 2. Success criteria

A new HA user can pair the integration to the OC plugin, select its native entities in a pipeline, choose persistent or new-conversation mode, and use standard compatible satellites without firmware replacement.

The integration:

- Does not ask for OpenAI/ElevenLabs provider keys.
- Does not present OC model/thinking/fast controls or an OC session picker.
- Exposes the plugin's current capability/readiness rather than inventing support.
- Streams when supported and works through automatic buffered fallback.
- Supports action-specific mode overrides without changing global defaults.
- Preserves exact follow-up and originating-target context.
- Works when its three native provider entities are used independently.
- Distinguishes provider-stage failures, transport errors and playback outcomes.

## 3. Non-goals and exclusions

No provider SDK stack, OC administration console, second agent/persona, alternative satellite firmware, speaker recognition, new home-control tool broker, global pipeline migration, or general-purpose client-selected session/model interface.

No quiet takeover of existing integrations/entities. A colliding existing domain must be avoided, not overwritten. No hidden global overrides, direct writes to HA internal storage, or monkey-patching another integration's private satellite state.

The integration must not require an HA long-lived access token for OC to control HA merely to provide voice I/O. The configured OC agent uses its existing tools and authority.

## 4. Proposed repository layout

    README.md
    LICENSE
    THIRD_PARTY_NOTICES.md
    hacs.json
    custom_components/<final_domain>/
      manifest.json
      __init__.py
      config_flow.py
      const.py
      coordinator.py
      client.py
      protocol.py
      errors.py
      stt.py
      conversation.py
      tts.py
      services.py
      services.yaml
      diagnostics.py
      strings.json
      translations/en.json
      conversation_bindings.py
      action_context.py
      audio.py
    tests/
      fixtures/
      test_config_flow.py
      test_client_lifecycle.py
      test_stt.py
      test_conversation.py
      test_tts.py
      test_services_query.py
      test_services_start_conversation.py
      test_mode_isolation.py
      test_diagnostics.py
    docs/
      DEVELOPMENT-PLAN.md
      protocol-v1.md
      automation-actions.md
      compatibility.md
      installation.md
      troubleshooting.md
      release-and-rollback.md

This is a planning layout. Avoid over-fragmenting small modules during implementation. Follow current HA integration conventions and relevant upstream docs.

## 5. Configuration and native surfaces

### 5.1 Config flow

Minimal fields:

- OC endpoint/location.
- Supported pairing/authorization flow.
- User-facing integration name.
- Default mode: persistent or per_conversation.

Discover and display the backend's safe selected-agent/profile status, speech capabilities and readiness. Do not ask users to configure provider model IDs or copy provider credentials into HA.

Do not collect the Gateway owner password as the normal permanent client credential. If a bootstrap process requires operator approval, document that one-time flow and retain only the approved scoped client identity afterward.

### 5.2 Options and reauthentication

- Permit changing the default mode.
- Support endpoint repair/reauthentication through normal HA flows.
- Preserve IDs and entities during ordinary reconnection/reconfiguration.
- Do not lose an admitted conversation's mode merely because the default changes.
- Retire old connection-bound work safely when endpoint/identity changes.
- Do not silently keep an old authenticated session when the operator thinks it was revoked.

### 5.3 Three native entities

1. STT entity: audio stream to recognized text.
2. Conversation entity: finalized input to the configured OC agent with ChatLog deltas.
3. TTS entity: message/deltas to valid HA-compatible audio.

Stable unique IDs must be based on the integration/backend identity, not transient connection IDs or a selected model that might change. Display names must be neutral and user-editable under HA conventions.

Stage availability is independent. A failed STT credential must not make an otherwise functional TTS entity appear broken. A timestamp of last use or unknown state is not a readiness probe.

The backend plugin is installed at Gateway scope but targets an explicitly configured agent. HA displays that safe selected-agent identity; it does not choose a different agent or assume the Gateway default. If the backend agent changes, do not reuse old conversation handles against the new agent. Support a deployment with a dedicated HA agent without automatically provisioning one.

### 5.4 Language and voice ownership

HA requires provider language/format metadata. Advertise safe effective backend capabilities, not a model/provider settings panel.

The active OC voice/model remains authoritative. Native voice choice should expose only the effective permitted profile choice, or use the supported no-override path. Do not let a pipeline's arbitrary voice field become an unreviewed OC configuration override.

G03 must prove metadata/default-option behavior and cache correctness, including a changed OC voice/model/profile revision. Old cached audio must not be returned under a new profile. Use supported cache-key/default-option or cache policy mechanisms; do not globally clear unrelated providers' caches as a shortcut.

## 6. Shared client behavior

One integration client should multiplex independent stage jobs over the approved connection where possible.

Responsibilities:

- Connect, pair, negotiate protocol/features and read safe capabilities.
- Dispatch request IDs and track server job/turn identities.
- Route each event to its exact requesting coroutine/stream.
- Maintain bounded audio/text queues and apply flow control.
- Track connection generation so stale events from an old connection cannot satisfy a new job.
- Cancel only owned work.
- Distinguish retryable transport setup from accepted or partially delivered agent work.
- Provide health/readiness to entities without excessive inference probes or polling.
- Redact credentials/URLs/content in logs and diagnostics.

Do not use a coordinator polling loop that invokes agent tools or model calls for a health check. An idle integration must not consume speech/model quota.

## 7. Milestones and detailed steps

All implementation milestones are NOT STARTED.

### H00 — Approval and repository bootstrap

1. Confirm approved plan and this module's scope.
2. Select collision-free HA domain/repository name independently of existing copied projects.
3. Confirm repository owner/visibility/license before public creation.
4. Establish HA packaging, lint/type/test tooling and supported Python/HA constraints.
5. Copy the approved module plan and shared contract/fixtures at the same revision as the OC plan.
6. Record third-party file-level provenance before source copying.
7. Establish evidence, changelog, compatibility and release documentation.
8. Do not install the integration or modify a live HA instance under bootstrap scope alone.

Deliverables: clean repository skeleton and plan/provenance baseline.
Exit: no namespace/ownership/license ambiguity.
Acceptance: T34, T39, T40.

### H01 — Native HA capability and automation-context proof

Goal: prove the framework constraints before building a full UI/client.

1. Select candidate released HA versions based on required public APIs, not one user's instance.
2. Verify native STT, ConversationEntity/ChatLog and streaming TTS contracts.
3. Verify that independently invoked STT/TTS callbacks do not require missing satellite/conversation metadata.
4. Establish how the plugin conversation mode is bound to an HA conversation.
5. Prove a prompt action can submit one request, receive structured results, and optionally use native HA speech playback.
6. Prove the interactive-start action's mode override reaches the intended generated HA conversation and all follow-ups.
7. Check supported context propagation and conversation lifecycle APIs; test concurrent same-satellite/unrelated wakes.
8. Do not rely on global next-turn state, private satellite attributes or model-prompt directives.
9. If public HA APIs lack the necessary binding, document the exact extension/architecture needed and obtain the appropriate owner decision before implementing outside this project.
10. Verify synthesis configuration/cache-key behavior for backend profile changes.
11. Define supported text/interactive playback targets and fail unsupported targets clearly.
12. Produce a compatibility-gate report and revise shared protocol before implementation assumptions harden.

Deliverables: G02/G03/G07/G08 evidence and chosen public HA integration approach.
Exit: both action types are implementable without global-setting races; no requirements quietly dropped.
Acceptance: T17, T18, T22, T23, T24, T32.

### H02 — Client protocol and conformance harness

1. Implement the shared versioned request/event schema and fixtures.
2. Create a deterministic fake backend covering all negotiated capability combinations.
3. Multiplex simultaneous STT, conversation and TTS requests by job ID.
4. Validate audio sequence/order/format metadata and reject malformed events.
5. Implement timeouts, bounded queues and explicit terminal state.
6. Bind handles/jobs to the active connection identity and generation.
7. Support reconnect plus status reconciliation without automatic accepted-turn replay.
8. Agree protocol fixture updates with the OC module before changing event meanings.
9. Include exact completion, partial failure and cancellation-unconfirmed cases.
10. Keep fake-backend tests distinguishable from real OC/provider proof.

Deliverables: client library and shared fixture coverage.
Exit: the client satisfies the backend contract without an HA UI.
Acceptance: T14–T16, T18, T31, T33, T37.

### H03 — Config entry, pairing and lifecycle

1. Implement the minimal config flow and safe connection validation.
2. Use HA's normal config-entry credential storage/reauth paths for the scoped client credential.
3. Never collect provider API keys or OC-wide catalogs in the HA form.
4. Register stable entities and the integration runtime container.
5. Start/stop one owned client; unload services/listeners/tasks cleanly.
6. Register reconnect behavior and availability projection without inference polling.
7. Implement options flow for default mode and endpoint/identity repair.
8. Preserve existing conversation mode bindings across an ordinary default change.
9. Handle revoked/expired credentials visibly and stop stale authorized work.
10. Avoid automatic creation or assignment of default pipelines, assistants or entity exposure.
11. Verify multiple config entries do not collide or share state accidentally.
12. Confirm installation performs no provider call or paid test without explicit user action.

Deliverables: HA integration setup/lifecycle and three discoverable entities.
Exit: clean setup/unload/reload/reauth tests.
Acceptance: T03, T20, T27, T29, T30, T36.

### H04 — Native STT entity

1. Implement supported language/format/codec/sample-rate/channel properties from safe backend metadata.
2. Accept standard satellite input and stream chunks promptly.
3. Use HA voice activity/end-of-stream semantics; do not create an independent conflicting endpointing engine.
4. Consume final backend transcript and expose native success/error/no-speech results.
5. Treat backend partial transcripts as provisional; use progress APIs only where declared supported.
6. Handle the backend's batch fallback without marking it a failed integration.
7. Cancel/release input jobs if HA cancels capture or disconnects.
8. Bound any local buffering and avoid persistent recordings by default.
9. Provide stage-local errors for permission, billing, quota, invalid audio and provider failures.
10. Prove standalone STT works without an OC conversation or satellite identity.

Deliverables: native STT provider.
Exit: streamed and batch-only fixtures work in the native HA pipeline.
Acceptance: T02, T08, T11, T18.

### H05 — Native conversation entity and mode policy

1. Advertise streaming only through the supported HA conversation mechanism.
2. Resolve effective mode from an existing admitted conversation binding, explicit action override, or integration default.
3. Ask the plugin to resolve/create the binding; never send arbitrary OC session keys.
4. Preserve HA conversation ID and context for follow-ups.
5. Submit only the latest finalized user turn; do not replay full HA history into an OC persistent session.
6. Forward speakable deltas immediately to ChatLog using supported APIs.
7. Support a fully buffered agent response as a usable fallback.
8. Build the final ConversationResult from the completed chat log and normal continuation facts.
9. Distinguish provider/tool/status events from user-facing speech.
10. Handle request conflict, session expiry, missing persistent target and partial response errors.
11. Preserve OC's normal agent authority and approvals; do not execute HA service calls from model-generated JSON.
12. Document local-intent shortcuts: users can deliberately enable them, but a pipeline intended to route every request through OC must not bypass the agent. Do not alter existing settings automatically.

Deliverables: normal selectable OC conversation agent.
Exit: history/mode/delta/follow-up tests pass without model or session controls in HA.
Acceptance: T06, T07, T17, T20, T21, T24, T28, T35.

### H06 — Native TTS entity and playback compatibility

1. Implement finite-message synthesis and incremental-message synthesis interfaces.
2. Negotiate output preferences with backend capabilities.
3. Advertise incremental-text input only when the backend actually accepts/usefully schedules it; do not derive it merely from a class method's existence.
4. Forward native message_gen chunks and final flush to the backend.
5. Yield backend audio chunks promptly without collecting all bytes first.
6. Handle sentence-buffered and fully buffered output modes correctly.
7. Verify output containers/codecs/sample formats and HA/satellite conversion behavior.
8. Avoid per-sentence announce/play_media calls that reset playback or repeat a preannounce sound.
9. Preserve the configured OC voice, validate incoming option conflicts, and solve profile-revision cache behavior.
10. Close audio generators and cancel owned synthesis on HA consumer cancellation.
11. Ensure a normal tts.speak announcement can use the entity without an agent/session.
12. Expose safe actual mode/phase diagnostics; do not report playback completion based only on network delivery.

Deliverables: native TTS provider and native announcement compatibility.
Exit: valid complete audio, early speech when available, and honest fallback.
Acceptance: T02, T09–T16, T27, T31.

### H07 — Prompt-and-reply action

Provisional public action name: <domain>.query. Final name after naming review.

Conceptual fields:

- prompt: required text.
- session_mode: optional default/persistent/per_conversation.
- conversation_handle: optional authorized follow-up context.
- optional spoken-output target.
- request identity and bounded wait behavior as needed by the native HA action API.

Steps:

1. Validate request and target through HA's normal service/permission context.
2. Resolve mode without modifying config-entry options or other conversations.
3. Open/reuse a backend binding and submit one agent request.
4. Return structured text, status and a conversation/interaction handle.
5. When spoken output is requested, use the same native TTS path and start early where the validated HA API permits it.
6. Keep final agent result distinct from queued/started/unknown/completed playback.
7. Preserve one request identity through timeouts/status lookup; a service timeout does not authorize another agent run.
8. If a follow-up handle and a contradictory new mode are supplied, reject or require a new interaction explicitly; do not silently switch history.
9. Provide neutral UI selectors, documented response fields and automation examples.
10. Test default versus explicit modes in parallel calls and text-only calls.

Deliverables: documented query action with response schema.
Exit: useful structured automation output and no global-mode mutation.
Acceptance: T22, T24, T30, T37.

### H08 — Interactive satellite-conversation action

Provisional public action name: <domain>.start_conversation.

Conceptual fields:

- Compatible assist_satellite target.
- Optional starting spoken message.
- Optional session_mode override.
- Optional native announcement controls only where supported without expanding v1 unnecessarily.

Steps:

1. Validate target feature support, selected pipeline and integration association.
2. Admit an owned interaction ID and mode before starting the satellite flow.
3. Use the G02-proven public HA binding mechanism to associate the generated HA conversation with that mode.
4. Do not treat the next arbitrary wake from the target as proof it belongs to this action.
5. Preserve the mode through follow-up listening and transcript turns.
6. Handle busy targets, simultaneous starts, cancellation, microphone errors and a user who never answers.
7. Return accepted/started status and an interaction handle, not a false completed-conversation result.
8. Reconcile an action timeout or cancellation with backend mapping/job state.
9. Preserve standard satellite behavior and existing default assistant selection.
10. Do not inject trusted session-control strings into model-visible extra system prompts.
11. Test the action on a supported real satellite only under separate authorized validation.
12. Document unsupported-target behavior and recovery without claiming arbitrary media players can capture replies.

Deliverables: interactive action with bounded native lifecycle.
Exit: action-mode overrides reach exactly the intended conversation under concurrency.
Acceptance: T18, T19, T23, T24, T28.

### H09 — Diagnostics, failure UX and interoperability

1. Provide redacted config-entry diagnostics with plugin/protocol/HA versions and safe stage readiness.
2. Expose actual STT/agent/TTS modes and degradation reasons.
3. Present user errors by failed stage, not only a generic red LED or stack trace.
4. Distinguish no-speech, denied auth, missing persistent binding, billing/quota and transport interruption.
5. Keep normal core HA trace behavior documented: the integration cannot claim core Assist never stores transcripts.
6. Avoid full audio/text logs in integration-specific diagnostics by default.
7. Run the shared conformance suite against the actual OC plugin candidate.
8. Test latest supported HA release and every declared lower-bound compatibility target.
9. Exercise normal voice, text query, announcement, automation query and interactive action.
10. Verify cross-room routing and one bad stage not poisoning independently usable entities.
11. Record first-audible, completion and cancellation observations without inferring audibility from entity state.
12. Confirm the native UI does not contain provider credentials/model controls or arbitrary session selection.

Deliverables: diagnostic UX and pair evidence.
Exit: blocking backend/client acceptance cases pass.
Acceptance: T17–T24, T29–T33.

### H10 — HACS packaging, docs, upgrade and rollback

1. Finalize manifest/domain/translation metadata and HACS packaging.
2. Document OC plugin requirement, pairing, three-entity pipeline setup and mode options.
3. Provide both automation action examples, response fields and follow-up/session semantics.
4. Explain streaming degradation as supported compatibility behavior.
5. Document fresh-history versus agent-memory behavior and deliberate persistent sharing.
6. Document local-intent shortcut effects and endpointing/client limitations.
7. Document settings/profile changes, synthesis cache correctness and reconnect behavior.
8. Provide upgrade/migration paths preserving config entries, entity IDs and action references.
9. Provide rollback/removal steps without deleting OC sessions or changing unrelated HA integrations.
10. Include license/notices and safe public examples.
11. Build/test the release artifact; inspect ZIP layout and absence of secrets/recordings/private paths.
12. Do not create a public release, HACS submission, install live or restart HA without the corresponding explicit authority.

Deliverables: third-party-installable release candidate and documentation.
Exit: T33/T34/T38/T39 complete; owner release approval remains separate.

## 8. Context and ownership pitfalls developers must preserve

### Independent native callbacks

STT and TTS methods may lack conversation/satellite metadata. They must work as independent client-owned jobs. Do not depend on a module-global current_satellite/current_session variable.

### Interactive action binding

Native satellite services can create their own HA conversation. Reading or writing private conversation fields is not a supported contract. The correct binding mechanism is an explicit compatibility gate, not an implementation detail to hand-wave away.

### Changing defaults mid-conversation

An admitted conversation retains its mode. A settings edit affects new conversations. A per-action override never modifies saved defaults.

### Retry after partial delivery

A timeout is not proof the agent did nothing. Query status/receipt; do not rerun a request that may already have controlled devices.

### Playback authority

Backend audio belongs to the requesting HA job. Media URLs, if required by the public HA playback API, must be bounded, expiring and protected through HA's normal mechanism. Do not expose arbitrary OC host file paths to a speaker.

### Core trace and speech caching

Native HA may retain transcript/trace information and cache completed synthesis. Document that accurately. Prevent stale synthesis after an OC voice/model change without clearing unrelated providers' caches globally.

## 9. Definition of done

The integration is done when:

- A new user can configure it without private chat knowledge or provider-key duplication.
- Three native providers and both actions work against the actual plugin.
- Persistent/fresh semantics and per-action isolation are proved.
- Streaming-capable and buffered-only cases both work.
- Failures are diagnosable and do not mix clients or duplicate actions.
- Public API/compatibility gates are resolved.
- Setup/unload/reauth/upgrade/rollback are tested.
- Documentation and licensing are complete.
- No unrelated pipeline, entity, service, credential or firmware changed as an installation side effect.
- The owner separately approves release/deployment.

Keep exact revision, active milestone, evidence paths, failed cases and next action in the execution ledger after every meaningful work unit.
