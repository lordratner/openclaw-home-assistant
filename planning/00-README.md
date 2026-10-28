# OpenClaw Home Assistant: paired-product development planning package

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

**Status: development baseline; local implementation authorized by owner message 20256.**
**Created: 2026-10-27. Live deployment remains separate from development authorization.**

## 1. What is being built

Two reusable, independently packaged products:

1. An OpenClaw plugin that makes the existing OpenClaw agent and speech capabilities available to voice clients, owns inference/session policy, and retains provider credentials inside OpenClaw.
2. A Home Assistant custom integration that exposes normal STT, conversation, and TTS entities and two automation actions, using the plugin as its backend.

These are not a new assistant persona, a second agent implementation, a provider-specific speech gateway, a firmware replacement, or a second OpenClaw deployment. Any permitted configured agent may be selected. The selected agent retains its normal knowledge, memory, skills, tools, and permissions.

The intended processing path is:

    Microphone / HA satellite
        -> HA STT entity -> OC speech backend -> transcript
        -> HA conversation entity -> selected OC agent/session -> response text
        -> HA TTS entity -> OC speech backend -> audio
        -> HA playback / satellite

The three native HA entities are separately callable. STT and TTS jobs must not require a conversation session merely to convert audio/text. They can share one authenticated client connection without pretending all native callbacks carry the same contextual fields.

## 2. Authoritative reading order

An unfamiliar team must read these documents before designing or coding:

1. [Requirements and decisions](01-REQUIREMENTS-AND-DECISIONS.md): confirmed owner requirements, precedence, explicit corrections, and proposed engineering defaults.
2. [Shared architecture and protocol](02-SHARED-ARCHITECTURE-AND-PROTOCOL.md): component ownership, proposed wire contract, lifecycle, session routing, credential boundaries, and fallback rules.
3. [OpenClaw plugin development plan](03-OPENCLAW-PLUGIN-DEVELOPMENT-PLAN.md): independent backend scope, implementation milestones, deliverables, and evidence requirements.
4. [Home Assistant integration development plan](04-HOME-ASSISTANT-DEVELOPMENT-PLAN.md): native HA surface, automation semantics, frontend/config flows, and compatibility proof.
5. [Acceptance and test matrix](05-ACCEPTANCE-AND-TEST-MATRIX.md): shared acceptance IDs referenced by requirements and both module plans.
6. [Research, reuse, and licenses](06-RESEARCH-REUSE-AND-LICENSE-REVIEW.md): evidence, candidate code, licensing, and limitations.
7. [Risks and compatibility gates](07-RISKS-AND-COMPATIBILITY-GATES.md): open technical questions that must be resolved with evidence, not assumptions.
8. [Execution checklist and handoff](08-EXECUTION-CHECKLIST-AND-HANDOFF.md): compaction-safe work tracking, evidence layout, stop/resume rules, and repository handoff.
9. [Work log](09-WORK-LOG.md): historical decisions and planning notes. This is not a replacement for current requirements.

Each module plan is intended to be the principal plan in its eventual GitHub repository. The shared documents must accompany both, at the same contract revision, or be linked through an accessible version-pinned public location. A private chat transcript is not an acceptable required dependency.

## 3. Precedence and outdated research

Current owner decisions in document 01 supersede earlier research recommendations.

In particular:

- Streaming is preferred, NOT a condition for provider compatibility.
- Automatic degradation must reach a functionally buffered solution if necessary.
- Sentence-by-sentence synthesis is legitimate early-speech streaming.
- HA does NOT select the actual persistent session.
- The OC plugin owns persistent-session selection and model/thinking/fast controls.
- A fresh session means fresh conversation history, NOT a new agent or disabled durable memory.
- OpenAI and ElevenLabs are initial validation priorities, NOT an architectural provider allowlist.
- The product is agent/persona/hardware/deployment neutral.
- Existing code is material for selective reuse, not an obligation to inherit its design.

Historical documents under projects/home-assistant/research contain useful evidence but also superseded proposals. Do not import their former strict-streaming rejection rule or installation-specific assumptions into these products.

## 4. Approval boundary

The owner has authorized creating this planning package only. Not authorized now:

- Creating the two GitHub repositories or publishing files.
- Implementing modules, schemas, test code, prototypes, or installers.
- Installing dependencies, plugins, integrations, or services.
- Changing an OC/HA configuration, credential, agent, model, session, pipeline, or satellite.
- Restarting a service, flashing firmware, or initiating live provider calls/playback.
- Opening an upstream PR or modifying another project.

The next owner checkpoint is review of the end-product specification and development plans. Implementation starts only after explicit authorization. Existing research/test installations are not product defaults or validation of these products.

## 5. Product v1 in one page

OC plugin:

- One voice profile initially, with a selected agent.
- Explicit OC-side agent selection, independent of Gateway-level plugin installation; dedicated HA-agent deployments supported, no implicit multi-agent main fallback.
- OC-side selection of an existing persistent session; recommended alternative is atomic create-on-first-persistent-use and durable binding when none is configured.
- Conversation model, thinking level, and fast preference owned by that profile.
- STT/TTS selections resolved through OC capabilities, provider configuration, auth profiles, and secret mechanisms.
- Streaming-capable, buffered-capable speech service and selected-agent conversation dispatch.
- Capability discovery, explicit job lifecycle, cancellation, observable degradation, bounded resource use.
- One revocable client identity per HA connection/installation as appropriate; no provider credentials sent to HA.

HA integration:

- Standard STT, conversation, and TTS entities.
- Connection/pairing and a default persistent-versus-per-conversation mode.
- No model/provider credential UI or persistent-session picker.
- A prompt-and-reply action and an interactive satellite-conversation action.
- An invocation-level session-mode override, isolated from the saved integration default.
- Native pipeline and playback compatibility, follow-up handling, reconnect/error behavior, and diagnostics.

## 6. First engineering proofs after implementation is authorized

Before committing to a transport or copying a large codebase, resolve:

- G01: a supported public OC path for real agent streaming with the requested model/thinking/fast controls and safe persistent-session semantics.
- G02: a supported HA mechanism to bind an automation's mode override to the intended interactive conversation without mutating global defaults or consuming an unrelated wake.
- G03: actual OC speech interfaces and provider capabilities, including useful buffered fallbacks.
- G04/G05: cancellation ownership, scoped client authorization, and targeted event delivery.
- G06/G07: license provenance and audio format continuity.

An unresolved gate is not permission to use private internals, disable device authentication, temporarily patch shared settings, or abandon a requirement.

## 7. Repository and naming disposition

There will be two new GitHub repositories: one plugin repository and one HA integration repository. Final repository names, package IDs, HA domain, owner/organization, publication visibility, and licensing choice are not fixed by this draft. Choose collision-free names during the authorized repository-bootstrap milestone and record them in both plans.

Do not reuse an existing HA domain just because copied code used it. Existing integrations named openclaw can conflict; both installation coexistence and migration must be considered.

## 8. Definition of planning completion

- Both module plans have ordered development steps and explicit milestone exits.
- Every confirmed requirement has an implementation owner and acceptance coverage.
- Shared session, inference, fallback, auth, and audio semantics are written once and referenced consistently.
- Assumptions are identified as proposals or technical gates.
- Research claims distinguish documentation/source inspection from executed proof.
- Reuse candidates have source/version/license records and explicit exclusions.
- A fresh team can resume from document 08 without recalling this chat.
- The package has been checked for broken internal links, missing test IDs, contradictory requirements, accidental secrets, and implied implementation authorization.

## 9. Review requested from the owner

Review the product responsibilities, session/inference precedence, automation behavior, fallback policy, v1 boundaries, and proposed engineering defaults. Administrative choices can be finalized with repository bootstrap later; no implementation is needed to review this specification.
