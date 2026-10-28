# Research, existing options, selective reuse, and licenses

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: evidence register and future reuse plan, not an implementation or endorsement.
Research dates: 2026-10-27 local; some source timestamps are UTC on 2026-10-28.

## 1. What this review establishes

Public catalogs, GitHub repository search, documentation, READMEs, selected source files and actual LICENSE files were inspected. This found substantial partial overlap. No complete, verified reusable plugin/integration pair meeting the combined product contract was established.

This is not proof that no other project exists. Before implementation, repeat a bounded update check and inspect proposed files at fixed revisions. Do not replace source review with popularity, a project title, a search snippet, or a claim that a voice loop was tested elsewhere.

No candidate was installed, executed as project code, granted credentials or validated live on behalf of these products during planning.

## 2. Evidence hierarchy

1. Owner decisions define product behavior.
2. Versioned official OC/HA source and documented public APIs define framework capability.
3. Executed future contract/provider/hardware proofs define actual compatibility.
4. Candidate source explains potential reuse.
5. READMEs/issues show author/user claims and limitations, not our proof.
6. Search-index snippets are discovery/corroboration, not a read full discussion.

Some HA forum/Reddit pages blocked automated fetches. Their indexed excerpts were not treated as full-page evidence. The handoff plans are self-contained and do not require private chat or inaccessible forum content.

## 3. Primary framework sources

### SRC01 — HA STT entity

https://developers.home-assistant.io/docs/core/entity/stt/

Defines audio metadata, native streamed input and final recognition result contracts. Newer partial-result APIs must not be assumed available/consumed on every supported HA version.

Implication: stream input when possible; final-only providers remain usable. Standard satellite input is a useful interoperability baseline, not a hard-coded specific device.

### SRC02 — HA conversation entity

https://developers.home-assistant.io/docs/core/entity/conversation/

Defines ConversationEntity, supports_streaming, ChatLog deltas, normal result creation and conversation context.

Implication: native HA streaming needs actual deltas passed to ChatLog, not internal SSE consumption followed by one final string.

### SRC03 — HA TTS entity

https://developers.home-assistant.io/docs/core/entity/tts/

Defines finite-message synthesis and incremental message/audio interfaces.

Implication: three axes need separate discovery: text input timing, provider audio timing, and actual device playback.

### SRC04 — HA pipeline events and native implementation

https://developers.home-assistant.io/docs/voice/pipelines/
https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/assist_pipeline/default_pipeline.py
https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/assist_satellite/entity.py
https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/esphome/assist_satellite.py

Source review showed early-TTS events, short-response buffering/caching behavior and native satellite conversation creation. A reviewed release used a 60-character early-start threshold; this is not a universal product constant.

Implication: use sufficiently long controlled fixtures; verify interactive action context propagation rather than assume it.

### SRC05 — Native Wyoming speech implementation

https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/wyoming/stt.py
https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/wyoming/tts.py

Source showed streamed input audio and synthesize-start/chunk/stop plus audio output where advertised.

Implication: Wyoming is a viable client protocol but does not grant new backend OC streaming capability or inherently save credentials.

### SRC06 — Official explanation of early speech

https://www.home-assistant.io/blog/2025/10/22/voice-chapter-11/#text-to-speech-streaming
https://www.home-assistant.io/blog/2025/08/06/release-20258/#streaming-text-to-speech-for-home-assistant-cloud

Explains text chunks in/audio chunks out and first-party adoption. Their benchmark numbers are not performance promises for these products.

### SRC07 — OC speech and plugin interfaces

https://docs.openclaw.ai/tools/tts/api
https://docs.openclaw.ai/nodes/audio
https://docs.openclaw.ai/plugins/sdk-provider-plugins/voice-and-audio
https://docs.openclaw.ai/plugins/sdk-overview/infrastructure
https://docs.openclaw.ai/plugins/sdk-channel-plugins
https://docs.openclaw.ai/nodes/talk/realtime-sessions

Public/plugin surfaces include speech capability registration, runtime transcription/synthesis, custom RPC/HTTP registration and agent/channel execution. Exact stable API entrypoints must be checked against declared supported releases in G01.

Research observed buffered ordinary speech RPCs and a streaming speech runtime. A plugin can bridge a runtime capability without an OC core fork if the required public APIs and lifecycle/authority behavior are proved.

### SRC08 — OC model/session/authority contracts

https://docs.openclaw.ai/tools/thinking
https://docs.openclaw.ai/concepts/session
https://docs.openclaw.ai/gateway/operator-scopes
https://docs.openclaw.ai/gateway/protocol/rpc-session-control
https://docs.openclaw.ai/gateway/tools-invoke-http-api
https://github.com/openclaw/openclaw/tree/main/packages/gateway-protocol/src/schema

Research found model/thinking/fast session controls, differing per-turn API fields, normal session reset/retention, Talk-scoped operations and broad shared-secret HTTP authority.

A main-head lookup during planning returned f76e79be6a8fc934afd0faf1315f0261cfc4bafe. Earlier individual main-source reads were not all pinned to that exact head; recapture exact source revisions before using them as release/provenance evidence. No minimum supported release is established by that lookup.

## 4. Candidate projects

Additional official agent-routing evidence:

- https://docs.openclaw.ai/plugins describes Gateway plugin loading/configuration and plugin-instance replacement on configuration changes.
- https://docs.openclaw.ai/concepts/multi-agent explains distinct agent workspaces/auth/session stores and warns plugin-owned storage is not automatically split by agent.
- https://docs.openclaw.ai/plugins/voice-call/configuration provides an existing plugin precedent: explicit agentId chooses response/session ownership in multi-agent deployments; main is not a universal fallback.

Implication: our plugin may be installed once at Gateway scope while explicitly targeting a configured agent. It must carry that agent context through dispatch, sessions, model/credential resolution and state ownership. No product decision depends on a particular user's agent roster.

### C01 — sprite-core

Repository: https://github.com/tylerwarburton/sprite-core
Reviewed source anchor: fe17af8b77c0d7398294b7cf09fb7908e378b8e9.
License: actual root LICENSE is MIT, copyright 2026 Tyler.

Relevant reviewed files:

- packages/plugin/src/stt-route.ts.
- packages/plugin/src/tts-route.ts.
- packages/plugin/README.md.

Verified source observations:

- A streaming STT upload route manually frames multipart input and forwards incoming audio without collecting the whole request first.
- TTS forwards upstream response chunks and handles response drain/backpressure.
- Current speech routes are ElevenLabs-specific and resolve plugin-specific API-key settings.
- The broader product includes avatar/assets/client SDK functionality.
- TTS route design includes text carried in a request URL; that route shape should not be copied into a product whose default logs must not disclose utterances.

Potential reuse: stream pumping, cleanup/backpressure tests, request framing ideas, bounded error projection.

Do not inherit: avatar system, provider-specific route ownership/auth duplication, full utterance in GET URL, unrelated UI/assets.

This is partial overlap, not the required native HA three-provider pair.

### C02 — openclaw-plugin-voice-chat

Repository: https://github.com/levivoelz/openclaw-plugin-voice-chat
Reviewed source anchor: 1010535bbd98d9895e7eab2e4ac8494a345a6332.
License: actual root LICENSE is MIT, copyright 2026 Levi Voelz.

Relevant source:

- src/core/voice-session.ts.
- src/core/sentence-buffer.ts and tests: proposed reuse candidates, require file-level review.
- src/plugin.ts.
- src/providers/stt and src/providers/tts.

Verified source/README observations:

- Real OC channel turns, block/sentence response delivery and streamed audio are central to the design.
- Agent execution remains OC-backed rather than a replacement bare LLM.
- Credential plumbing is explicitly deployment-specific; pairing is described as incomplete/stubbed and the README discusses a disabled-device-auth workaround.
- Source comments distinguish cancelling TTS from an agent dispatch that can continue.
- Actual session routing uses a client/agent-derived channel key; do not assume its advertised fresh/resume semantics match our HA conversation modes without tests.
- Speculative agent dispatch on partial recognition is present; excluded from our v1.

Potential reuse: sentence scheduling, turn/audio sequencing, state-machine tests, useful lifecycle lessons.

Do not inherit: private secret daemon integration, deployment/OS assumptions, disabled auth, speculative actions, deprecated host shims, or unproved cancellation/session semantics.

### C03 — HA OpenClaw Assistant

Repository: https://github.com/JadCham/ha-openclaw-assistant
Reviewed source anchor: 6693cd1ea91b734666327bfe44101cf7e82c0c6e.
License: actual root LICENSE is MIT, copyright 2026 JadCham.

Relevant source: custom_components/openclaw_assistant/conversation.py.

Verified source: supports_streaming is true and actual deltas are fed through ChatLog. It is a conversation integration, not OC-owned STT/TTS.

Potential reuse: native ConversationEntity structure, cancellation/error handling and relevant conformance tests. SSE parser reuse is useful only if our final transport actually needs SSE; do not carry an unused parser simply because it exists.

Do not inherit: an independent HTTP bearer/key route, full-history replay into a persistent OC session, or client-side inference/session policy contrary to our split.

### C04 — techartdev OpenClawHomeAssistantIntegration

Repository: https://github.com/techartdev/OpenClawHomeAssistantIntegration
Reviewed stable version: v0.1.65.
Reviewed tree from prior source research: c75c18f57181f4552d86b7700fd43d52422a46d2.
License: root LICENSE is MIT, copyright 2026 techartdev, Tech Art Ltd.

Evidence:

- Configurable agent and fixed/HA-derived session routing exist.
- Stable conversation code accumulates text before handing it to HA.
- Native Assist streaming is explicitly excluded from that stable release.
- https://github.com/techartdev/OpenClawHomeAssistantIntegration/pull/39 remains experimental at review time.
- The broader integration has chat-card/automation features outside this product.
- Earlier source review found a diagnostic polling concern; do not reuse inference/tool polling for idle health.

Potential reuse: selected HA setup/session/normalization patterns and tests after adapting ownership.

Do not inherit: whole-response buffering when better modes exist, unrelated chat-card feature surface, broad bearer assumptions or unnecessary polling.

### C05 — ddrayne openclaw-homeassistant

Repository: https://github.com/ddrayne/openclaw-homeassistant
Reviewed version/tree: v1.8.3, 0b475e38fdab8b599aec320a4eae73c889d2b2ce.
License: actual LICENSE text states Apache License Version 2.0 with copyright 2026 OpenClaw Contributors. GitHub's automatic classifier returned NOASSERTION; that classifier is not the license itself.

Relevant source: config_flow.py, gateway_client.py, gateway/device auth code and conversation.py.

Evidence:

- Native Gateway WebSocket, agent and fixed session routing.
- Existing speech handling delegates to HA.
- Modern HA streaming compatibility and reported incomplete spoken replies require exact-version review; README alone is not proof.
- https://github.com/ddrayne/openclaw-homeassistant/issues/18 is a reported issue, not proof the new products are broken.

Potential reuse: protocol/connection/session-authority lessons and selected tests.

Do not inherit: arbitrary HA session/model pickers, compatibility guessing, response trimming, broad credentials or unreviewed native streaming shims.

### C06 — other reviewed alternatives, not primary reuse bases

- https://github.com/TristanBrotherton/voicepe-realtime: substantial realtime frontend, custom firmware/add-on and optional OC recall/delegation. It is not simply the selected OC agent supplying all three native HA provider stages.
- https://github.com/inxaos-repo/openclaw-voice-satellite: OC voice/channel routing with HA-hosted speech; session-sharing assumptions differ.
- https://github.com/wortmanb/friday-voice: webhook relay/direct-model paths, extra provider/HA tokens and deployment-specific assistant design.
- https://github.com/PrayerfulDrop/HA-OpenClaw-Conversation-Agent-and-Bridge: conversation/action bridge, not an all-three streaming voice backend.
- https://github.com/Epiphytic/openclaw-voice: local/Discord/Wyoming bridges and separate local model/provider choices; not the target reusable native pair.
- https://github.com/croccio/openclaw-conversation: conversation-only flow and explicitly buffered speech in reviewed documentation.
- https://github.com/AurelioB/ha-codex-voice: subscription conversation/experimental speech/realtime, but not an arbitrary selected OC agent/capability client.

These are useful context, not commitments to adopt their architecture.

## 5. License and provenance process

Confirmed MIT candidates: C01, C02, C03, C04.
Apache-2.0 text candidate: C05.

Before copying any substantial source/test portion:

1. Pin the exact upstream commit and path.
2. Read that file's license/header and relevant dependency/subdirectory notices.
3. Record original copyright/license and intended local modification.
4. Preserve notices in copied files and release artifacts where required.
5. Include a third-party notice/provenance entry.
6. For Apache-derived material, preserve license/attribution/NOTICE requirements and mark modified files appropriately.
7. Do not relabel all borrowed source as our original code under only our repository license.
8. Review dependency licensing and transitive obligations separately.
9. Record that rewritten code using an idea is different from copied source, without using that distinction to conceal actual copying.

Select each new repository's own license during authorized bootstrap. Do not assume README credit alone satisfies license conditions.

## 6. Reuse decision rubric

For every proposed reuse unit, record:

- Which current requirement it serves.
- Its inputs/outputs and public host API assumptions.
- Whether it has meaningful independent tests.
- Whether current source relies on private/deprecated host interfaces.
- Its cancellation, buffering, fallback and auth behavior.
- Direct/transitive dependency cost.
- License/provenance obligations.
- Adaptation effort versus a small clean implementation.
- Decision: reuse unchanged, adapt with retained provenance, learn only, or reject.

Reject copying a large project because it looks close. Prefer a small coherent module that satisfies our contract over a large fork whose assumptions dominate it. Reuse parsers/schedulers/pumps/tests where they genuinely save work without compromising provider abstraction, credentials, session policy or fallback.

## 7. Historical lessons retained without private environment assumptions

- Speech recognition can fail independently of announcements; stage-specific readiness and errors matter.
- A displayed streaming flag can mean only advertised support, not actual early audio.
- A device can be online through one playback connection and unavailable through another; transport health is not inference proof.
- A provider's streaming API does not automatically mean an HA/OC adapter forwards chunks progressively.
- Subscription-backed agent conversation and speech API entitlements are separate.
- A complete audio stream after full-text generation is not the same latency behavior as early sentence speech.
- Public source may have a useful core algorithm and unacceptable auth/lifecycle scaffolding.
- Reusable product decisions must not depend on a particular household's devices, billing state, agent name or installed provider choices.

## 8. Recheck and update policy

At implementation bootstrap, perform a bounded recheck of C01–C05 releases/source and OC/HA public API compatibility. Record changes rather than assuming the research is permanently current.

Only repeat a broader search if a material gap, new project/version, or reuse blocker justifies it. Do not let indefinite research postpone an authorized build; conversely, do not claim global absence from one search.

Any copied unit must be traceable in both repositories' release notices and development notes.
