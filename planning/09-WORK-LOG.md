# Planning work log and decision notes

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

This log records planning evidence and corrections. Current requirements are in document 01; a historical note here does not override them.
Date: 2026-10-27 local.

## 1. Discovery and architecture trajectory

The discussion began with the distinction between text streaming and actual early speech in HA. Research found native HA streaming contracts and supported TTS implementations, while some conversation adapters and speech providers buffered complete responses.

The product direction evolved toward OC providing STT, real agent conversation and TTS, with HA retaining its normal pipeline/hardware transport. A custom OC plugin plus HA integration became the recommended shape, subject to proving public API and lifecycle support.

A Wyoming bridge was evaluated as an alternative client protocol. It can preserve streaming but does not inherently add OC backend capabilities or reduce credentials. The current plan favors native HA entities plus an OC-hosted backend, without committing to private APIs.

## 2. Product-neutrality correction

The owner explicitly rejected a persona-specific or installation-specific product. The plans therefore:

- Select a configured agent rather than hard-code a personal assistant.
- Use OC's provider/model/auth capabilities.
- Do not use private billing/provider/device observations as product defaults.
- Do not require a second agent, Gateway or firmware stack.
- Treat a dedicated HA agent as a supported deployment rather than a mandatory universal architecture.

## 3. Session and inference ownership

The owner moved actual persistent-session selection into the OC plugin. HA chooses only whether to use that configured target or start fresh per conversation.

Model/thinking/fast settings also belong in the plugin so both modes have the same voice policy. A persistent session is history/context, not an independent accidental settings authority.

The owner clarified isolated conversation means fresh history, with normal agent knowledge, memory, tools and capabilities unchanged.

The recommended auto-create-on-first-persistent-use behavior is recorded as an engineering proposal; an explicit existing session remains supported. It must atomically bind and persist, and a missing previously bound target must not silently become new history.

## 4. Automation actions

The owner accepted both:

1. Submit a text prompt, obtain a result and optionally speak it.
2. Start an interactive satellite conversation.

Both need invocation-level mode overrides that remain bound to that conversation and do not modify integration defaults. The HA native API propagation path remains G02, explicitly identified rather than hand-waved.

## 5. Streaming correction — controlling decision

An earlier proposal treated missing streaming as a provider incompatibility. The owner corrected that.

Final direction:

- Prefer every progressive capability available.
- Sentence-by-sentence synthesis is valid early-speech behavior.
- Automatically fall back through sentence/batch to fully buffered operation.
- Provider-neutrality requires continued functionality, not brand-specific assumptions.
- Report the actual path and reason honestly.
- Do not automatically rerun agent/tool work or switch to new credentials to recover speech.

This correction has been propagated to requirements, shared protocol, both module plans, tests and risk records. Older research documents may contain the superseded strict policy.

## 6. Existing options and reuse findings

Broader repository/catalog searches found substantial overlap:

- sprite-core: streamed speech proxy traffic, currently provider-specific/avatar-oriented.
- voice-chat: speech bracketing real OC agent turns, with private auth/deployment/cancellation caveats.
- JadCham HA integration: native ChatLog delta forwarding.
- techartdev and ddrayne: agent/session routing and other useful HA/Gateway patterns.
- Other realtime/firmware/bridge projects solve adjacent but different architectures.

Actual LICENSE files were reviewed: MIT for the first four named MIT candidates in document 06; Apache-2.0 terms in ddrayne's LICENSE despite GitHub's automatic NOASSERTION classification.

No complete tested pair meeting this product contract was established. This is a bounded research conclusion, not a claim of global absence. Selective reuse should save effort only where it fits the current contract.

## 7. Technical risks made explicit

The plan identifies:

- Different OC APIs expose different subsets of run/session model controls.
- Shared persistent sessions cannot safely be temporarily patched/restored.
- Native HA interactive conversation context cannot be assumed to propagate an arbitrary mode override.
- STT/TTS native callbacks may have no satellite/session fields.
- A streaming speech runtime is not automatically an externally callable streaming RPC.
- Audio must remain valid across multiple sentence requests.
- Synthesis profile changes can interact with HA caches.
- Job delivery/cancellation and actual playback are separate facts.
- Shared Gateway bearer credentials are not narrow voice credentials.

These are engineering proof gates, not reasons to make unapproved product compromises.

## 8. Additional owner steering during plan drafting: agent selection

The owner requested explicit selection of the OC agent the plugin applies to and noted a dedicated HA agent will be used in the owner's eventual deployment.

Official OC documentation confirms Gateway-level plugin loading/configuration and separate per-agent workspaces/auth/session context. Existing Voice Call plugin documentation provides an explicit agentId precedent for multi-agent deployments.

Added:

- R56–R58.
- T41–T42.
- Plugin-versus-agent scope explanation.
- Explicit selected-agent propagation to dispatch, session/model/auth lookup and state ownership.
- Dedicated-agent deployment validation.
- Agent-change handling that does not reinterpret/migrate old history.
- No implicit multi-agent main fallback.

No agent was created/configured. This steering supplements, rather than replaces, the task to finish the entire detailed planning package.

## 9. Planning deliverables

Ten documents provide:

- Package index and approval boundary.
- Requirements and accepted/proposed decisions.
- Shared architecture/protocol/lifecycle.
- Independent OC plugin development plan.
- Independent HA integration development plan.
- Acceptance and evidence matrix.
- Source/reuse/license review.
- Risks and compatibility gates.
- Execution/handoff checklist.
- This work log.

All implementation milestones and product tests are not started/not run. Documentation checks and packaging are not application development or live validation.

## 10. Final planning audit

The documentation audit found ten planning documents, 58 consecutively numbered requirements, 42 consecutively numbered planned acceptance cases and 11 ordered milestones in each module plan. Internal relative links resolved, requirement rows had acceptance references, and no unknown acceptance IDs or accidental private-installation/credential patterns were found by the bounded scan. Content review checked ownership, fallback, agent-selection, profile-change and approval-boundary consistency.

These are documentation checks, not evidence that any product feature works. All application tests and engineering gates remain unexecuted. A documentation-only ZIP was created and integrity-checked; it contains the ten planning documents, root reading index and audit manifest, and is refreshed after final status edits. The owner checkpoint remains before coding or repository creation.


## 11. Development authorized and checkpoint 1 implemented

Owner message 20256 authorized development. Two independent local source repositories and isolated test environments were created. See [the current execution ledger](../implementation/STATUS.md) for exact implemented units, 63 passing automated checks, native paired framework evidence, failed-attempt notes, limitations and ordered next actions. No live runtime or actual provider/satellite was changed. The immutable review ZIP is not regenerated into an implementation artifact.


## 12. Private repository bootstrap

Created the two requested GitHub repositories under lordratner as private development repositories and pushed the verified initial source checkpoints. OC source a394b2f6ddfbaaa9c86dcfbeca4b5966e2f9d031; HA source 2fe4f2e31181724513a938052763c4737bd5000d. No public release or live installation occurred.


## 13. Home Assistant plugin naming correction

Owner message 20272 requires the plugin name to identify Home Assistant rather than generic voice functionality. Adopted product name OpenClaw Home Assistant, repository lordratner/openclaw-home-assistant, package @lordratner/openclaw-home-assistant, and local checkout modules/openclaw-home-assistant. The existing GitHub repository was renamed, preserving history and privacy. The companion integration repository/domain and protocol identifiers are unchanged. Historical review archives and dated log entries retain their original names. No behavior or live configuration changed.
