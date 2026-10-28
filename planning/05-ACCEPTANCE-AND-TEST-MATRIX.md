# Acceptance, test matrix, and evidence contract

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: future validation plan only. No test code or live provider tests have been implemented or run for these products.
Revision: 1, 2026-10-27.

## 1. Test philosophy

Tests must establish behavior the products promise, not mirror private implementation details.

Use four distinct evidence levels:

1. Source/document review: establishes an API/capability claim, not executed compatibility.
2. Unit and contract fixtures: establish deterministic component behavior.
3. Controlled pair integration: actual plugin plus actual HA integration under supported host versions.
4. Authorized provider/hardware canary: actual provider access, timing and physical playback observations.

Passing one level does not imply the others. A mocked progressive stream does not prove a cloud model streams. A provider stream does not prove a satellite played early. A playback entity saying playing is not physical audibility proof.

## 2. Required acceptance cases

All T identifiers below are stable references used by requirements and module plans. Blocking means required for the feature/version claimed at release; an owner-approved scope change must be recorded if a feature is removed.

### T01 — Neutral agent and deployment selection

Setup: at least two synthetic configured agents with distinct identity/memory/tool fixtures; no personal names or installation paths.

Procedure: select each through the OC profile, exercise conversation, inspect prompts/runtime facts and public examples.

Pass: correct configured agent runs; no hard-coded assistant, host, household, provider, room or firmware requirement. A new session does not create a new agent.

### T02 — Three OC-owned stages and independent speech jobs

Exercise standalone transcription, standalone synthesis/announcement, text-only agent conversation and complete speech conversation.

Pass: all inference uses the OC host capability interfaces; STT/TTS do not require an agent/session; the selected real agent runs exactly once for each admitted conversation turn. HA contains no provider implementation.

### T03 — Credential reuse and stage-local readiness

Configure different normal OC credential/profile sources and a missing credential for one stage.

Pass: provider credentials stay in OC; HA sees only its client credential/status. A failed transcription credential does not disable otherwise functioning synthesis. Setup/idle health checks do not consume model quota.

### T04 — Capability-driven provider neutrality

Use host fixtures with OpenAI, ElevenLabs and a deliberately unfamiliar provider ID, each advertising different stage/mode support.

Pass: behavior depends on capability contracts, not provider-name branches. Unsupported language/model/control choices are validated. Missing streaming selects an available lower mode rather than a provider-name rejection.

### T05 — Initial real-provider validation

After authorization, run bounded synthetic canaries using OC-configured OpenAI first and ElevenLabs second. Record exact provider/model/runtime/auth class, stage capabilities, package/host revisions and observed results without secrets.

Pass: every claimed provider/stage combination has evidence. Unsupported streaming is a recorded degraded mode, not failure of otherwise usable service. An unavailable account cannot be marked passed. Additional providers remain architecturally eligible; compatibility statements distinguish tested from untested.

### T06 — Same agent, different history

Seed synthetic fact A in a persistent session, create a fresh HA conversation, and expose synthetic durable agent memory B.

Pass: persistent mode sees its earlier transcript; fresh mode starts without that transcript being replayed or selected as its session history. Both retain normal agent capabilities and permitted durable memory B. Normal OC memory/context engines may still retrieve earlier permitted facts, so assess transcript routing rather than requiring the model to forget fact A. No incognito or memory isolation is implied.

### T07 — Model, thinking and fast precedence

Configure profile controls, conflict them with historical session settings, create new and reused sessions, and run a concurrent nonvoice client.

Pass: admitted voice work uses the intended effective profile, with requested/effective controls recorded. Nonvoice defaults are not altered by patch/restore. In-flight jobs retain their admitted revision; newly admitted conversations use the new revision. Unsupported public dispatch controls must block the implementation gate, not be faked with prompts.

### T08 — Streaming microphone input

Feed audio in timed chunks while holding end-of-input open. Use streaming and batch host fixtures.

Pass: eligible streaming backend receives chunks before final input. Final transcript is authoritative; partials never start a tool-bearing turn. Batch mode is bounded and correctly reported. Empty successful transcription is distinguishable from failure.

### T09 — Decisive early-speech proof

Use a controlled agent that emits one complete, sufficiently long sentence, then waits for a test-controller signal before emitting the ending. Make the opening longer than any relevant HA short-answer threshold; do not make the product depend on one release's 60-character constant.

Pass for an eligible early-speech path: first audio reaches the client while final agent text is still deliberately withheld. In an authorized physical canary, the opening is audible before the controller releases the ending. Record both facts separately. Complete the response and verify the final sentence is spoken once.

### T10 — Automatic degradation and honest mode reporting

Exercise combinations of:

- Streaming STT, agent text and provider audio.
- Batch STT with streaming agent/TTS.
- Streaming agent plus buffered sentence TTS.
- Buffered agent plus progressive output for its completed response.
- Whole-response buffered synthesis.
- A preferred streaming feature missing while a lower usable mode exists.

Pass: the best supported configured path is used automatically; all modes function; actual stage mode and degradation reason are observable. No new provider/account is substituted outside OC policy. Runtime failures are not relabeled as capability fallback.

### T11 — Fully buffered functional compatibility

Use final-only recognition, final-only agent output and completed-audio synthesis.

Pass: a complete correct answer is delivered through native HA; no requirement rejects the provider for lacking streaming. Memory/spool limits and timeouts apply. No fake claim of early speech is made.

### T12 — Model/control validation and effective settings

Test valid and invalid models, thinking levels and fast modes across different host capability fixtures.

Pass: valid settings resolve through OC; invalid settings produce actionable configuration errors or explicitly documented OC effective mappings. Fast does not promise a guaranteed speed or universally available tier. No independent static model catalog is maintained by HA.

### T13 — Speakable projection and final-fragment fidelity

Feed assistant speech, hidden reasoning, tool payloads, status/control metadata, Markdown, URLs, code, abbreviations, Unicode and a final sentence without punctuation.

Pass: only intended speakable assistant content reaches synthesis; display text remains faithful. No hidden reasoning, raw tool arguments or protocol directives are read aloud. Final text is neither lost nor duplicated. Any deliberate speech rendering is documented.

### T14 — Audio format integrity and backpressure

Decode progressive, sentence-concatenated and buffered results. Vary provider sample rate/format and force slow consumers.

Pass: one valid negotiated audio stream; no repeated container headers, clicks due to invalid framing, unbounded queues or format drift. Flow control bounds memory. Conversion itself does not introduce avoidable whole-response buffering. Native playback/preannounce occurs once per intended interaction.

### T15 — Cancellation and partial failures

Cancel before admission, during STT, during agent work, before first audio, midway through audio and after final text. Fail synthesis after some bytes.

Pass: only owned work is affected. Late output is fenced. Audio-only cancellation does not cancel unrelated agent work. Exact run cancellation is acknowledged or reported unconfirmed. No replayed first sentence or duplicate tool run. Partial delivery is not success.

### T16 — Disconnect, restart and unload

Disconnect HA, unload its entry, reload the plugin, revoke the client and interrupt provider transport at each stage.

Pass: bounded cleanup; no zombie streams/tasks/temp files; no stale audio after reconnect. Accepted agent work is not replayed automatically. Status recovery reports known/unknown completion honestly.

### T17 — Native HA product flows

Use actual entities for typed Assist, microphone Assist, normal TTS announcement, standalone STT, query action and interactive action.

Pass: correct native provider contracts and final results; ordinary HA UI/pipeline selection works. No firmware changes, private satellite monkey-patches or secondary agent runtime are needed for the supported baseline.

### T18 — Context-free speech and exact origin routing

Run simultaneous standalone STT/TTS jobs and conversations from multiple origins, including callbacks with no satellite/conversation fields.

Pass: independent speech jobs work and output reaches only their request consumer. Optional origin metadata is not required or trusted as authorization. No global current-room/session variable.

### T19 — Concurrency and shared persistent ordering

Run parallel fresh conversations, two users/clients deliberately sharing a persistent target and overlapping speech jobs.

Pass: fresh histories do not mix; the same persistent session obeys OC ordering; settings revisions and delivery routes remain correct. Resource limits return bounded useful errors rather than silently dropping work.

### T20 — Configuration authority split

Inspect HA forms, action schemas and request payloads.

Pass: HA has connection/default-mode controls only; no model/thinking/fast/provider-key/session picker. OC owns persistent target and profile. HA cannot inject an arbitrary OC target or change server profile through a mode override.

### T21 — New session per HA conversation

Create conversation A with multiple turns, reconnect it, then create conversation B.

Pass: A uses one OC session throughout; B uses another. A wake, speech job or reconnect is not by itself a new conversation. Expired mappings produce explicit behavior rather than hidden cross-context continuation.

### T22 — Prompt-and-reply action

Exercise omitted/explicit modes, optional spoken target, text-only output, bounded wait timeout and authorized follow-up handle.

Pass: one request and structured result; optional speech uses the native synthesis route, early where supported. Mode override does not change integration defaults. Completion and playback statuses are separate. Contradictory follow-up mode/handle use is not silently accepted.

### T23 — Interactive automation override

Start an isolated interaction while default mode is persistent; overlap another automation and an unrelated wake.

Pass: exactly the intended generated HA conversation and its follow-ups use fresh history; ordinary conversations retain their default. No global next-turn slot, assistant setting change, private state write or model-prompt control marker. A missing public binding mechanism is a failed G02 gate, not a waived requirement.

### T24 — Follow-ups and lifecycle

Exercise a normal clarification/follow-up, explicit conversation end, action-started conversation, mode default changes and fresh history with normal agent memory.

Pass: HA and OC keep the correct conversation association. A clarification can continue when the native APIs support it. Mode remains bound to the interaction. No promise of endless listening or incognito. New HA conversation lifecycle creates fresh state only under per-conversation mode.

### T25 — Atomic lazy persistent binding

Send concurrent first persistent requests; crash after create and before commit; restart and retry.

Pass: one intended durable binding, with a recoverable creation receipt and no repeated orphan sessions. The resolved reference is visible in plugin settings/status and survives restart. Loading an unused plugin does not create a session or call a provider.

### T26 — Missing or changed persistent target

Delete, reassign or revoke access to an already bound logical target. Also exercise ordinary OC physical rollover.

Pass: missing/reassigned target yields rebind-required; no silent replacement history. Legitimate core rollover follows OC lifecycle. Fresh mode and independent speech can remain available where otherwise configured.

### T27 — HA setup, options, entity IDs and synthesis cache

Set up, change default mode, change OC voice/model/profile revision, reload and reauthenticate.

Pass: stable IDs, safe migration, no default pipeline/entity-exposure changes. Same text under a new synthesis profile does not reuse old cached voice audio. Do not clear unrelated provider caches globally.

### T28 — Supported clients and local intents

Test a supported standard satellite, a supported non-satellite/text client and native local-intent configurations.

Pass: declared client support is real. Documentation explains that HA local-intent shortcuts may bypass OC intentionally; an all-OC test disables that bypass explicitly. Integration does not globally alter user pipeline behavior.

### T29 — Scoped client authorization

Try a valid paired voice client, revoked client, insufficient scope, unauthorized agent target, another caller's handle and another caller's cancellation.

Pass: required work is allowed with documented minimum authority; forbidden work fails before dispatch/disclosure. No owner-password shortcut, arbitrary host files, general OC admin access or client-controlled permission expansion.

### T30 — Redaction and credential containment

Inspect logs, diagnostics, fixtures, request bodies, release ZIP/tarballs and error speech.

Pass: no provider keys, OAuth data, private URLs/tokens, raw audio or full prompt payloads in default diagnostic artifacts. HA holds only its approved client credential. Public samples are synthetic. Sensitive technical error details are not spoken.

### T31 — Timing and honest status

Compare accepted, agent-start, first text, final text, first audio, final audio and physical playback observations.

Pass: phase/mode counters match actual work; no acknowledgment reported as completion, network delivery as audibility, or output stop as remote cancellation. Cross-machine timestamps are labeled appropriately.

### T32 — Public SDK and host-version compatibility

Run contract/API probes on every declared OC and HA floor/current target.

Pass: no private hashed imports, copied internal stores or unversioned method guessing. Unsupported framework versions fail setup with explanation. The public dispatch path honors all required controls and automation binding.

### T33 — Paired protocol and independent versions

Pair supported and unsupported plugin/integration versions, optional-feature combinations and schema fixtures.

Pass: compatibility matrix is accurate; major mismatch rejects safely before capture/dispatch; optional minor differences degrade only as specified. Both repos consume the same contract revision/fixtures.

### T34 — License and provenance

For each copied substantial portion, record upstream repo, commit, path, license, notices, changes and dependencies.

Pass: required MIT/Apache notices and modification/NOTICE obligations are preserved. Attribution alone is not substituted for license compliance. No code is imported solely because a repository is public.

### T35 — Normal agent authority

Use tool-capable fixtures, approval-required fixtures, hostile content claiming another identity and an unauthorized action.

Pass: normal OC tool/approval rules remain; the adapter does not grant new authority from speech text, HA metadata, session handles or provider responses. No separate HA action executor is introduced.

### T36 — Bounded resources, retention and migrations

Test large utterances/answers, queue pressure, excess concurrent jobs, slow consumers, profile reloads, storage migrations and temporary-file expiry.

Pass: documented finite limits, deterministic errors and cleanup. In-flight profile consistency is preserved; revocation is respected. State migration does not delete canonical agent sessions or unrelated state.

### T37 — Idempotent retry and ambiguous work

Lose acknowledgments before/after admission, after a harmless tool execution and after partial speech. Retry identical and conflicting content under the same request identity.

Pass: same retained request receipt does not cause another tool-bearing turn; conflicting retries fail. Unknown completion remains unknown rather than automatically rerun. Guarantees are scoped to retained identities/receipts, not advertised as universal exactly-once execution.

### T38 — Upgrade, downgrade, uninstall and rollback

Install candidate artifacts in a controlled environment, upgrade within supported migrations, restore the previous pair and uninstall one side.

Pass: documented rollback, preserved intended config/IDs/bindings and clear incompatibility behavior. No deletion of user-selected OC history/provider credentials or broad HA restore to undo one integration.

### T39 — Unfamiliar-team installation and public examples

Give only repository docs/artifacts to a developer not involved in this discussion.

Pass: they can identify scope, configure, validate, diagnose and remove the products without private transcript knowledge. No personalized assumptions or unreviewed copied auth instructions.

### T40 — Planning, scope and compaction handoff

Audit requirements, decisions, milestone status, evidence, open gates and source scope.

Pass: no development begins before approval; subsequent work is recorded with exact revision/next action; both plans remain aligned; unfinished tests/gates are not marked passed. Live deployment/publication/core changes are separately authorized when needed.

### T41 — Agent selection and dedicated-agent deployment

Configure a Gateway with at least two synthetic agents and select a nondefault dedicated voice agent in the plugin. Give the agents distinct synthetic histories, model permissions, auth-profile fixtures and tools. Exercise fresh/persistent conversations and independent speech jobs.

Pass: all agent-sensitive resolution uses the selected agent, not an implicit main/default. Persistent target ownership is validated. Normal OC credential inheritance is respected without copying profiles between agents. The Gateway-scoped plugin service does not imply all-agent access or create another agent.

### T42 — Agent switch and plugin-state boundaries

Switch the plugin profile's agent while a job is active, then attempt old follow-up handles, stale bindings and new requests. Reload/restart the plugin afterward.

Pass: already admitted work follows captured authority or explicit cancellation/revocation; old history/handles are not reinterpreted under the new agent. New admissions use the new agent; mismatched persistent targets require rebind. State is agent/profile namespaced. No history migration, unrelated auth change or silent cross-agent fallback.

## 3. Deterministic fixture families

Define language-neutral fixtures in the canonical shared contract, not provider-specific mocks duplicated differently in two repositories.

Required families:

- S-STREAM: progressive STT, text and synthesis.
- S-SENTENCE: progressive text, buffered-per-sentence synthesis.
- S-BUFFERED: final transcript/text/audio only.
- S-MIXED: batch STT plus streaming agent; buffered agent plus progressive audio.
- S-NO-SPEECH: completed empty transcription, no agent turn.
- S-FAIL: quota/billing/auth/format errors by stage.
- S-PARTIAL: partial text/audio then failure.
- S-REORDER: delayed/duplicated/stale chunks and terminal events.
- S-CANCEL: cancellation at every phase.
- S-CONCURRENT: fresh versus deliberately shared persistent conversations.
- S-PROFILE: model/voice/revision changes, effective control mappings.
- S-RETRY: request receipts and connection-generation changes.

Fixtures contain synthetic content and dummy identifiers only. Do not capture real household conversation/audio to build a fixture library.

## 4. Provider-neutral compatibility matrix

For each tested host/provider/model combination record:

| Dimension | Required recorded fact |
| --- | --- |
| Host/plugin/client/HA revisions | Exact versions and artifact hashes |
| Stage | STT, selected-agent conversation, TTS |
| Authentication | Credential class and configured-profile reference, never secret value |
| Input capability | Streamed audio/text accepted, or finite input |
| Output capability | Partials/deltas/audio chunks, or final-only |
| Chosen mode | Actual executed path and degradation reason |
| Correctness | Transcript/answer completeness and valid decoded audio |
| Cancellation | Local fence, remote acknowledgment and known limitations |
| Timing | Same-clock measured intervals and physical-audio observation where available |
| Limits | Tested input/output/queue boundaries |
| Result | Passed, failed, blocked or not run; no ambiguous green status |

OpenAI first and ElevenLabs second are validation order, not a global allowlist. A provider may pass one stage and not implement another. Publishing support must reflect the actual tested/advertised capability contract.

## 5. Evidence layout for future development

Suggested per-run directory:

    evidence/<milestone>/<revision>/<test-id>/
      README.md
      environment.json
      result.json
      redacted-events.jsonl
      measurements.csv
      notes.md

Do not create result files claiming tests were run when they were only planned. In this planning package, all product implementation/canary cases remain NOT RUN.

Environment records must omit real tokens, private addresses when destined for public repos, and credential-bearing URLs. Provider/hardware details needed for reproducibility may be redacted or kept in separately authorized private evidence with a public-safe summary.

## 6. Release acceptance

A release candidate needs:

- All deterministic unit/contract cases for its claimed features passing.
- Actual paired product integration on declared framework versions.
- Authorized real-provider coverage for claimed initial provider/stage support.
- At least one real standard satellite playback/early-speech canary and normal fallback proof.
- Both automation action types with per-action session override proved.
- Cancellation/retry/concurrency/authority boundaries exercised.
- License, docs, installation and rollback checks complete.
- An explicit owner decision on any blocked release requirement.

Do not broaden or repeat a passed suite without a material change, unresolved concern or failure. Spend the next effort on the next milestone, not redundant testing for appearance.
