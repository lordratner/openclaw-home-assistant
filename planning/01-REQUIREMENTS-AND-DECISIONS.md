# Requirements, accepted decisions, and precedence

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: development baseline; implementation status is tracked separately. Revision: 1, 2026-10-27.

## 1. Vocabulary

- OC: OpenClaw, the host providing agents, model runtimes, speech capabilities, authentication, and session facilities.
- Agent: an existing configured OC agent. It is not a voice persona created by these products.
- Voice profile: the plugin-owned configuration that selects the agent, inference controls, speech settings, and persistent-session target.
- HA conversation: the interaction identified by HA's conversation lifecycle/ID. It may contain multiple user and assistant turns.
- OC session: OC-managed conversation history and runtime context, with logical addressing and physical lifecycle managed by OC.
- Persistent mode: different HA conversations use the configured plugin-side persistent target.
- Per-conversation mode: each new HA conversation gets a new OC session; follow-ups reuse that session.
- Isolated: isolated fresh session history from the HA user's perspective. Normal agent knowledge, durable memory, tools, skills, and authority remain.
- Streaming-first: select the most progressive supported path, but degrade automatically through sentence/batch paths to fully buffered operation.
- Provider-neutral: use OC's provider/capability/configuration/auth interfaces rather than embed a second provider implementation or name allowlist.
- Framework/runtime: the agent execution system; not interchangeable with a model, provider, session, transport, or channel.
- Action override: explicit persistent/per-conversation choice for one automation-created conversation. It is not a global settings change.

## 2. Owner-decision trace

These source message numbers identify statements in the originating Home Assistant discussion. They are provenance references, not required external resources for developers.

| Source | Confirmed direction |
| --- | --- |
| 20221 / 20226 | Consider OC for all three steps; one plugin and one HA integration; assess streaming capabilities rather than assume built-in speech is remotely pluggable. |
| 20223 | Streaming is vital; minimize added credentials; prefer no OC core changes, but a justified PR is acceptable. |
| 20228 | Reusable, persona-neutral; capability-based, not installation-specific; investigate existing customizations; keep v1 flexible enough in structure but minimal in settings. |
| 20232 | Two new repositories; plugin owns model/thinking/fast; session choice belongs in OC; selective credited reuse, no compromises to incorporate code; remain read-only. |
| 20235 | HA default and per-action mode override; OC selects actual persistent session; mandatory target or automatic creation/binding considered; OpenAI/ElevenLabs initial speech compatibility. |
| 20237 | Isolated means fresh history, same agent capabilities; accept both automation action types; provider neutrality is the goal, OpenAI first and ElevenLabs second for initial support. |
| 20239 / 20241 | Clarify streaming levels; automatic fallback all the way to non-streaming is required when necessary; use streaming whenever available. |
| 20245 | Produce extremely detailed separate module plans plus coordinated requirements/steps/milestones/notes; unfamiliar-team handoff and compaction protection; do not start development. |
| Planning-phase agent-selection clarification | OC plugin must explicitly select its target agent; a dedicated Home Assistant agent is a required supported deployment, not a reason to hard-code a default agent. |

Earlier assistant proposals are not owner requirements merely because they appeared in a research note.

## 3. Functional and nonfunctional requirement register

U = explicit owner direction. D = engineering requirement derived to make U achievable. A requirement marked D remains reviewable in this planning draft, but a developer must not silently omit it once the plan is approved.

| ID | Kind | Requirement | Primary owner | Acceptance |
| --- | --- | --- | --- | --- |
| R01 | U | Product is agent/persona-neutral; no hard-coded household, host, hardware, or personal assistant assumptions. | Both | T01, T39 |
| R02 | U | OC supplies transcription, the real selected agent conversation, and synthesis; HA is the native client/coordinator. | Both | T02, T17 |
| R03 | D | Preserve standard HA Assist and satellite transport; do not require firmware replacement or a second assistant brain. | HA | T17, T28 |
| R04 | U | Use an existing configured agent; fresh sessions do not create replacement agents. | OC | T01, T06 |
| R05 | U | Abstract providers through OC, not duplicated provider SDK stacks in either product. | OC | T02, T03 |
| R06 | U | Reuse OC provider credentials/auth profiles; do not copy provider keys into HA. | Both | T03, T30 |
| R07 | U | Prioritize OpenAI, then ElevenLabs for initial provider validation without hard-coded brand restrictions. | OC | T04, T05 |
| R08 | U | Use streaming wherever supported. | Both | T08, T09 |
| R09 | U | Automatically degrade through sentence synthesis to fully buffered operation rather than reject a provider for lacking streaming. | Both | T10, T11 |
| R10 | D | Expose requested, supported, and actual execution modes with reasons; do not mislabel buffered work. | Both | T10, T31 |
| R11 | D | Resolve model/provider feature support using OC capabilities, not a guessed fixed table. | OC | T04, T12 |
| R12 | D | STT accepts streamed microphone input and supports finalized-utterance/batch providers where streaming recognition is unavailable. | Both | T08, T11 |
| R13 | U | Begin speech before the full answer when feasible; progressive audio output is preferred where available. | Both | T09, T10 |
| R14 | D | Synthesize only speakable assistant content, not hidden reasoning, internal control data, or raw tool payloads. | OC | T13 |
| R15 | D | Produce valid negotiated audio with correct resampling/container boundaries and no per-sentence chime/reset. | Both | T14 |
| R16 | D | Cancellation, disconnect, and late results have owned lifecycles; no cross-turn audio or false agent-cancel claims. | Both | T15, T16 |
| R17 | D | Route each result to its exact HA caller/conversation/satellite; concurrent rooms must not mix. | Both | T18, T19 |
| R18 | U | Actual persistent-session selection is configured only in the OC plugin. | OC | T06, T20 |
| R19 | U | HA has a persistent/per-conversation default, not an OC session picker. | HA | T20, T21 |
| R20 | U | Both automation actions support an invocation-level mode override that does not mutate global defaults. | HA | T22, T23 |
| R21 | U | One fresh OC session per new HA conversation, reused for that conversation's follow-ups. | Both | T21, T24 |
| R22 | U | Isolation does not remove normal agent memory, knowledge, skills, or tools. | OC | T06, T24 |
| R23 | U/D | Support explicit persistent target; recommended unset behavior is create once and durably bind, with atomic first-use behavior. | OC | T25 |
| R24 | D | Missing/deleted/reassigned previously bound targets require a visible error/rebind, not silent history substitution. | OC | T26 |
| R25 | U | OC plugin owns conversation model, thinking level, and fast setting for both session modes. | OC | T07, T12 |
| R26 | D | Validate inference choices for selected model/runtime/account; show effective behavior or unsupported controls. | OC | T12 |
| R27 | D | Avoid temporary model/settings patch-and-restore races on persistent sessions shared with other clients. | OC | T07, T19 |
| R28 | U | Provide prompt-and-reply automation action with structured result and optional spoken output. | HA | T22 |
| R29 | U | Provide interactive satellite-conversation action with follow-up listening. | HA | T23 |
| R30 | D | Action responses expose stable handles, status and useful errors without credentials or arbitrary target-session control. | HA | T22, T30 |
| R31 | D | Carry the selected mode across the entire action-created conversation, not only its first message. | Both | T23, T24 |
| R32 | U/D | Register native HA STT, conversation and TTS entities and allow ordinary pipeline selection. | HA | T17, T27 |
| R33 | D | Preserve normal HA conversation IDs, follow-ups, local-intent interactions, and error surfaces without impersonating control roles. | HA | T17, T24, T28 |
| R34 | U | Prefer supported OC SDK/plugin APIs; justify any narrowly scoped upstream PR before adopting unsupported internals. | OC | T32 |
| R35 | U | Plan and eventually create separate plugin and integration repositories with coordinated compatibility. | Both | T33 |
| R36 | U | Investigate existing code, reuse selectively with required notices, and make no design compromises to reuse it. | Both | T34 |
| R37 | U | Minimal v1 controls with structured, extensible configuration; do not ship a large matrix of speculative options. | Both | T27, T39 |
| R38 | U/D | Minimize new credentials; use a dedicated revocable client authority with verified narrow permissions, not the Gateway owner password. | Both | T29, T30 |
| R39 | D | Preserve OC tool/agent authorization and approval behavior; audio input or a session handle cannot expand authority. | OC | T29, T35 |
| R40 | D | Startup, unload/reload, reconnect, profile changes and shutdown release work and retain only intended state. | Both | T16, T36 |
| R41 | D | Distinguish accepted work, agent completion, synthesis completion, and audible playback. | Both | T09, T31 |
| R42 | D | Idempotent retries must not duplicate agent/tool execution; ambiguous partial work is not automatically rerun. | Both | T15, T37 |
| R43 | D | Bound audio/text queues, concurrency, timeouts, buffering and retained mappings. | Both | T14, T19, T36 |
| R44 | D | Negotiate protocol/features and declare tested minimum OC/HA versions before release. | Both | T32, T33 |
| R45 | D | Persist only plugin-owned binding/state with a versioned migration path; avoid direct OC/HA internal storage writes. | OC | T25, T36 |
| R46 | U/D | Do not automatically alter default HA pipelines, global OC models, unrelated sessions or credentials during installation. | Both | T27, T35 |
| R47 | U | Planning approval precedes coding; publication, installation and live operations remain separately scoped. | Both | T40 |
| R48 | U/D | Public product documentation/examples contain no private installation data or secret values. | Both | T30, T39 |
| R49 | D | Version/release, installation, upgrade and rollback instructions must work for both products independently and together. | Both | T33, T38 |
| R50 | D | Distinguish capability degradation from runtime failure; do not replay already spoken content or consequential work under a fallback label. | Both | T10, T15, T37 |
| R51 | D | Native STT/TTS callbacks work without requiring unavailable satellite/session context. | Both | T02, T18 |
| R52 | D | Expose ordinary OC session lifecycle behavior honestly; no promise of endless retention or incognito from a fresh session. | OC | T24, T26 |
| R53 | D | A settings change affects newly admitted work; in-flight jobs retain a consistent resolved profile revision. | OC | T07, T36 |
| R54 | D | Keep implementation boundaries: OC owns inference/policy, HA owns native UI/pipeline wiring; the protocol carries data rather than model prompts as control. | Both | T02, T23, T35 |
| R55 | D | Maintain detailed plans, decisions, risk records and evidence so compaction or team handoff cannot erase acceptance requirements. | Both | T40 |
| R56 | U | Expose explicit OC-side agent selection; support a dedicated HA agent without requiring all users to create one. | OC | T41 |
| R57 | D | Resolve sessions, provider credentials, model capabilities, memory and tool authority in the selected agent's context. | OC | T41, T42 |
| R58 | D | Treat plugin installation/lifecycle scope separately from agent routing; agent changes must not migrate or cross-wire existing histories/bindings. | Both | T41, T42 |

## 4. Accepted ownership and precedence

### 4.1 Plugin-side policy

The OC plugin is the configuration authority for:

- Selected agent and permitted persistent target.
- Model, thinking level and fast preference for voice conversations.
- STT and TTS provider/model/voice configuration and inherited OC settings.
- Provider-auth lookup through OC, without new plaintext credential stores.
- Capability-based adaptation and durable session binding.

The persistent session supplies conversation history. Its historical settings must not silently override the configured voice profile. Conversely, voice must not mutate other clients' preferences by patching and restoring a shared session. See G01 for the supported runtime/API proof.

### 4.2 HA-side policy

HA owns one integration default mode: persistent or per_conversation.

For automation-created work:

    explicit action mode, when supplied
        > integration default mode

The resulting mode is bound to that HA conversation handle for subsequent turns. There is no temporary global default change. HA does not select arbitrary OC session keys or inference models.

### 4.3 Configuration changes and active jobs

A job records the effective profile revision at admission. Editing plugin settings must not change voices, output formats, model controls, target sessions, or authority halfway through that job.

New conversations use the new profile. Existing active conversations need a documented policy: recommended v1 behavior is to retain their admitted profile until completion, while new independent work uses the new revision. Revocation/unavailable authority can terminate work immediately; configuration consistency never overrides revocation.

Agent selection is a routing-boundary change, not merely a voice or effort edit. In-flight work may finish under its admitted agent if authority remains valid, but subsequent conversation admission must not reinterpret an old handle/history as belonging to the new agent. End/rebind affected conversations explicitly; never migrate their history automatically.

### 4.4 Plugin scope versus agent scope

OC plugins are loaded/configured as Gateway extensions; installing one does not automatically make its state or service instance private to one agent. Our single v1 voice profile must include an explicit agentId, resolved against configured permitted agents. No hard-coded main fallback in a multi-agent installation. The service may be registered at Gateway scope, but all agent/session/provider operations must carry the selected agent context. Plugin-owned stores must namespace records accordingly. Per-agent tool exposure is a separate OC policy and is not a substitute for correct backend routing.

## 5. Session semantics

### Persistent

- If an existing session is configured, resolve its canonical owner and target using OC APIs and verify authority.
- Multiple conversations explicitly using the same target intentionally share its history and OC ordering.
- Recommended unset behavior: on first persistent use, create one session and commit one durable binding atomically.
- The generated target is visible in plugin settings/status and reused after restart.
- Lock the logical target, not an assumed immortal physical transcript ID; OC reset/rollover policies still apply.
- If a previously bound logical target is deleted, reassigned or inaccessible, surface a rebind-required condition.
- Do not silently create a substitute target to conceal lost context.

### Per conversation

- Map a new HA conversation to one newly created OC session.
- Preserve that map through follow-up turns, reconnects and acknowledged retry recovery.
- Another HA conversation gets a different target even if it uses the same agent or satellite.
- End conversation mapping according to a bounded lifecycle/TTL policy; do not delete the OC history automatically unless OC's normal retention policies do so.
- Fresh means no earlier session transcript. It does not disable agent memory or tools and is not an incognito promise.
- Verify isolation by session/transcript routing, not by demanding factual amnesia: normal memory/context engines may still retrieve permitted knowledge from other conversations. Do not disable those capabilities to make a fresh-history test appear to pass.
- A wake word, STT job, TTS job, network connection and user turn are not interchangeable with a new HA conversation.

## 6. Streaming-first degradation policy — latest controlling decision

Select the best available path independently for each stage:

- STT: streamed audio/transcript support where available; otherwise bounded finalized-utterance/batch transcription.
- Agent: incremental speakable text where available; otherwise wait for completed response without executing a second turn.
- TTS: progressive provider audio, preferably started from completed sentences while later text arrives; otherwise synthesize/play completed sentence batches; otherwise synthesize/play the completed response.

A provider with fewer streaming capabilities remains usable. Never reject it merely because a preferred streaming capability is absent. An invalid model, unavailable credential, denied permission, incompatible audio format, or runtime error remains a real error unless OC's configured policy supplies an authorized fallback.

No automatic substitution of a new provider/account outside OC's configured policy. No silent extra agent/tool run to retry speech delivery. No fabricated guarantee that every provider produces partial transcripts or accepts arbitrary unfinished text.

## 7. Automation actions

Two v1 action surfaces, exact public names finalized after domain selection:

1. Prompt-and-reply: submit text, obtain a response/handle/status, optionally speak on a specified compatible target.
2. Start interactive conversation: initiate a conversation on a compatible satellite, apply a mode override, and retain that mode for its follow-ups.

Both use the same backend policy and session mapping. Neither requires arbitrary session IDs from automations. A response handle is an opaque capability bound to the authorized HA client, not an OC administration token.

Do not conflate automation action target selection with granting OC a new HA control interface. The chosen agent uses its existing capabilities.

## 8. Proposed engineering defaults for owner review

These defaults were not explicitly dictated by the owner and must stay labeled:

- One voice profile per plugin deployment in v1, structured for future multiple profiles.
- Auto-create persistent target on first persistent use rather than failing for a missing initially configured target.
- Retain generated binding in plugin-owned durable state, expose the resolved reference in plugin configuration/status; use a normal supported config update only if required for the chosen UI implementation.
- Prefer OC-owned authenticated Gateway connection with targeted plugin events over a separate port/daemon.
- Use a namespaced opaque integration/client identity and job IDs.
- Do not make a dedicated agent mandatory; allow any permitted existing agent.
- Keep timing/resource defaults configurable only where operationally necessary; use negotiated documented defaults rather than many UI knobs.
- Preserve active conversation profile revisions through ordinary settings edits.

Reviewing these is part of reviewing the plan, not authorization to deploy them.

## 9. Explicit v1 non-goals

- A new LLM runtime, memory system, tool broker, identity/speaker recognition system, or persona.
- Hard-coded OpenAI or ElevenLabs provider implementations.
- Firmware modifications, alternative wake-word training, or replacing HA's satellite stack.
- Full-duplex/barge-in guarantees beyond what HA hardware/runtime support.
- Speculative agent execution from partial STT text before the utterance is finalized.
- Autonomous reconfiguration of HA devices, pipelines, entity exposure or OC permissions.
- Arbitrary client-selected agent/session/model overrides or new global credentials.
- Avatar UI, phone-call transports, browser voice apps, proactive announcements from unrelated work, or an extensive voice profile matrix.
- Treating any historical research recommendation as an unreviewable requirement.

## 10. Required resolution before coding and release

Before implementation: owner approves this plan.

During the first authorized engineering milestone: resolve G01–G08 with code/source/contract evidence and controlled proofs. Do not promise a core-free implementation before proving the public SDK path.

Before release: replace all provisional IDs and compatibility floors with verified values; all blocking acceptance cases pass or are explicitly re-scoped by the owner. A feature cannot be quietly dropped because existing copied code lacks it.
