# Risks, compatibility gates, and engineering decisions

Current execution: owner authorized development in message 20256. See [implementation status](../implementation/STATUS.md). Historical planning-only statements below describe the review snapshot; they do not cancel the later development authorization. Live deployment remains separate.

Status: no implementation gates have been executed. This is a planning risk register.
Revision: 1, 2026-10-27.

## 1. Gate rules

A gate has a specific owner, evidence requirement and decision path. A gate is not passed by reading a README or discovering a function name. If it cannot be passed under supported APIs, record the smallest concrete gap and obtain the appropriate owner/project decision.

Missing streaming support in a provider is NOT a gate failure by itself. It selects a degraded usable mode. A gate fails when the product cannot implement its promised lifecycle, policy or functional fallback correctly.

### G00 — Owner approval of end-product plans

Owner: product owner.
Current state: APPROVED FOR LOCAL DEVELOPMENT by owner message 20256. Live deployment and unrelated core-project changes remain separately scoped. See ../implementation/STATUS.md.

Required evidence: owner confirms the requirements, module split, session/inference precedence, action behavior, fallback policy and v1 boundaries.

Until then: documentation edits only. No coding, prototypes, test implementation, repository creation, installs, provider calls, live playback, settings changes or publication.

### G01 — Public OC agent dispatch and inference controls

Owners: OC plugin developer, reviewed by HA counterpart.

Questions to prove:

- Can the plugin run the selected normal agent with its real history, tools, memory and permissions?
- Can it obtain genuine incremental speakable output?
- Can it set model, thinking and fast for both fresh and selected persistent session work?
- Can those voice settings be applied without temporarily patching shared session defaults?
- What permission/runtime/model constraints apply?
- Is the plugin's explicit agentId carried through speech provider/auth resolution, session stores and tool authority in a multi-agent Gateway, including a nondefault dedicated voice agent?

Known evidence: public session create/patch schemas expose all three controls. Public chat-send and agent request schemas expose different subsets. That is not yet proof one plugin dispatch path satisfies the full requirement.

Pass: controlled execution confirms all settings and shared-session behavior under a supported public SDK.

If blocked: document the exact missing run-control/API field and propose a minimal generic upstream addition. Do not use prompt directives as a substitute, patch/restore shared settings, silently inherit conflicting defaults, or replace the agent with tool-free model inference.

### G02 — HA interactive action session-mode binding

Owners: HA developer, reviewed by OC counterpart.

Questions to prove:

- How does an action-created satellite conversation expose its generated HA ID and trusted service context?
- How can a per-action mode override bind to that conversation and its follow-ups?
- How are an unrelated wake and simultaneous start distinguished?
- Can optional spoken query output use the native streaming playback path?
- Which released HA APIs support this without private-field mutation?

Known evidence: native satellite start_conversation creates and retains its own conversation ID. STT/TTS callbacks do not uniformly receive the same conversation metadata. A generic next-request override is unsafe.

Pass: deterministic concurrency/context proof plus actual supported framework execution.

If blocked: identify a public API extension or review an alternative action orchestration design. Changes to HA core or another integration are a separate project boundary. Do not quietly omit the action or temporarily change global defaults/assistant selection.

### G03 — Generic speech provider and metadata compatibility

Owners: OC speech developer and HA speech developer.

Prove:

- Streaming and batch STT are reachable through supported OC capability interfaces.
- Progressive, sentence-buffered and full-response TTS have usable host paths.
- Provider/model/voice/language facts can be projected safely into HA metadata.
- An unfamiliar provider capability fixture works without provider-name conditionals.
- Profile changes do not cause HA to reuse stale voice/model audio.
- Provider API failures and unsupported streaming are classified differently.

Pass: fixture matrix plus authorized initial-provider smoke evidence where claimed.

If blocked: use a supported lower capability where functional, or document a genuine host interface gap. Do not duplicate vendor SDK stacks or demand a new provider account to hide the gap.

### G04 — Cancellation, incremental output and delivery ownership

Owner: OC lifecycle developer, reviewed by HA client developer.

Prove exact ownership/cancellation of STT, agent and TTS work, targeted event delivery, terminal states and resource release. Check whether stopping output can leave agent/tool work running and report it honestly.

Pass: cancellation at every phase, cross-client denial and no late audio in a later turn.

If blocked: narrow the promised cancellation behavior explicitly and obtain owner review before a release; do not claim remote work stopped based only on socket/audio closure.

### G05 — Dedicated client authority without provider-secret exposure

Owners: OC authorization developer and HA config-flow developer.

Prove:

- One dedicated revocable client identity can use required voice/session operations.
- It does not require a general Gateway owner password.
- Agent/session restrictions are real server checks, not client assertions.
- Job events/handles are caller-bound.
- Provider keys are never returned.
- Plugin RPC registration has explicit appropriate scopes; default broad write scope is not assumed harmless.

Pass: positive and negative authority tests against the supported host version.

If blocked: propose the smallest scoped API/identity support needed. Do not disable device authentication, treat a shared bearer header as narrowly scoped, or accept arbitrary session/model/tool policy fields.

### G06 — Selective reuse and license provenance

Owner: developer copying the unit, reviewed by module maintainer.

Prove exact source/commit/path, license/header/dependency notices, meaningful tests, and compatibility with current product requirements.

Pass: per-unit reuse record and notices in source/release artifacts.

If blocked: learn from the design and implement cleanly, or choose a different unit. No compromise to authentication, provider neutrality, cancellation or session policy merely to reuse code.

### G07 — Audio continuity, conversion and native playback

Owners: both speech developers.

Prove one valid output stream across sentence requests, streaming conversion, correct metadata, no repeated container headers and bounded backpressure. Test native HA announcement/pipeline playback and a supported real satellite.

Pass: decoding tests plus physical early-speech/full-response canaries where relevant.

If blocked: choose a compatible negotiated format or buffered path honestly. Do not stream invalid bytes, restart announcements per sentence, or claim audibility from a state flag.

### G08 — Paired contract and framework version floor

Owners: both module maintainers.

Prove exact protocol fixtures, compatible package pairs, required public OC/HA APIs, supported runtime versions, migration behavior, action schemas and rollback.

Pass: released/tested compatibility matrix and clean major-version mismatch handling.

If blocked: restrict the declared support floor to proved versions or propose an explicit API dependency. Do not ship a guessed version range or silently depend on private current-main implementation details.

## 2. Risk register

| Risk | Consequence | Prevention / required response | Related tests |
| --- | --- | --- | --- |
| K01: ordinary TTS RPC is buffered | Apparent streaming waits for complete audio | Use host stream API or sentence/full-response fallback with accurate telemetry | T09, T10 |
| K02: provider has fewer capabilities | Provider unnecessarily rejected or a stream badge lies | Negotiate modes independently; degrade automatically | T04, T10, T11 |
| K03: partial STT starts tools | Wrong/duplicate consequential work | Finalized utterance only in v1 | T08, T35, T37 |
| K04: shared-session settings race | Voice changes another client's model/effort | Run-scoped controls; no patch/restore workaround | T07, T19 |
| K05: first-use persistent race | Multiple histories or orphan sessions | Atomic binding plus creation receipt/reconciliation | T25 |
| K06: stale binding after deletion | Context loss concealed by replacement | Explicit rebind-required state | T26 |
| K07: retries replay agent work | Duplicate actions or repeated speech | Stable request receipts; status recovery; no blind rerun | T15, T37 |
| K08: per-action mode leaks globally | Other conversations unexpectedly isolated/shared | Immutable per-conversation policy; no temporary defaults | T22, T23 |
| K09: next-wake override is stolen | Wrong user/room gets automation context | Trusted HA lifecycle binding, not global next-turn slot | T23 |
| K10: independent callbacks lack context | Speech fails or mixes rooms | Independent owner/job IDs; context optional | T18 |
| K11: hidden content enters speech | Reasoning/control/secret payload spoken | Typed speakable projection and redacted failures | T13, T30 |
| K12: sentence audio has format discontinuity | Clicks, decoder errors or repeated headers | Normalize one negotiated stream and test decoding | T14 |
| K13: conversion buffers everything | Early speech lost despite progressive provider | Streaming conversion and timing evidence | T09, T14 |
| K14: unbounded queues/spools | Memory/disk/latency/resource failure | Negotiated limits, backpressure and cleanup ownership | T14, T36 |
| K15: connection uses owner credential | Excessive OC authority from HA compromise | Dedicated revocable identity and server-side limits | T29, T30 |
| K16: provider creds copied into HA | Additional secret management and leak surface | OC-only credential resolution | T03, T30 |
| K17: provider error text leaks secrets | Spoken/logged credentials or internal URLs | Safe taxonomy and redaction | T30 |
| K18: stale HA audio cache | Wrong voice/model after profile change | Profile-aware supported cache key/policy | T27 |
| K19: local intent bypass misunderstood | User thinks OC handled every command | Document and test explicit shortcut behavior | T28 |
| K20: core trace storage misrepresented | Privacy expectations incorrect | Document native HA/OC storage separately from plugin diagnostics | T30, T39 |
| K21: copying private/deprecated scaffolding | Insecure brittle implementation | Small reuse units, host API contracts and notice review | T32, T34 |
| K22: mismatched package versions | Broken jobs or wrong event interpretation | Versioned handshake/fixtures and compatibility matrix | T33 |
| K23: lifecycle edits change active jobs | Voice/target/authority changes mid-answer | Admitted profile revision, explicit revocation behavior | T07, T36 |
| K24: a cleanup deletes canonical sessions | Irrecoverable history loss | Plugin mapping cleanup is not session deletion | T26, T38 |
| K25: a performance claim comes from a README | Unmet user expectations | Measured timestamps and physical proof | T09, T31 |
| K26: early strict-streaming proposal returns | Provider-neutral compatibility broken | Current requirements supersede old research | T04, T11, T40 |
| K27: one side silently changes contract | Paired products diverge | Shared fixture/version ownership and coordinated review | T33 |
| K28: a test on one installation becomes product policy | Nonportable product | Capability-based floors, neutral fixtures, declared matrices | T01, T32, T39 |
| K29: Gateway-scoped plugin falls back to the wrong agent | Wrong memory/tools/auth/session history | Explicit agentId and agent-namespaced state; no multi-agent main fallback | T41, T42 |

## 3. Open engineering decisions, not unresolved product preferences

The owner has answered the product questions. These remaining items are engineering proof tasks:

- Exact supported public OC dispatch API and minimum release.
- Exact supported HA interactive action binding mechanism.
- Gateway/plugin event transport details and scoped pairing registration.
- Audio format/conversion path supported across selected providers/HA clients.
- How the OC plugin settings UI displays an auto-created durable binding.
- How HA synthesis cache keys include effective voice/profile changes.
- Concrete resource limits and timeout defaults, based on bounded measurements.
- Which candidate algorithms/tests are reused and under what notices.
- Final repository/package/domain names, ownership and license.

Do not ask the owner to solve API mechanics that developers can investigate. Do obtain an explicit decision if solving one requires changing another project, dropping/changing a product requirement, accepting broader authority, or making an externally consequential change.

## 4. Proposed architecture decision records

### ADR-A — Two products, one shared contract

Disposition: accepted owner direction.

Two independent repositories/packages with one pinned protocol/fixture contract. No third mandatory runtime service in the recommended architecture. A third shared-code repository is not required for v1.

### ADR-B — Plugin-owned profile and session target

Disposition: accepted owner direction.

HA selects mode, not target/model/provider. OC resolves actual sessions and inference policy. Explicit action override wins for its conversation only.

### ADR-C — Lazy persistent creation

Disposition: recommended engineering proposal for owner review.

If initially unconfigured, create/bind one session on first persistent use. Retain/expose the reference durably. No substitute history after a previously bound target disappears.

Alternative originally discussed: require an explicit target. Keep this alternative in the decision record; do not present the recommendation as an already deployed behavior.

### ADR-D — Streaming-first with functional fallback

Disposition: accepted latest owner correction.

Use progressive capabilities whenever possible. Automatically degrade through sentence and full-response buffering when necessary. A provider's lack of streaming does not invalidate an otherwise functional path.

### ADR-E — Native HA integration, OC-hosted backend

Disposition: current recommended implementation architecture, subject to G01/G02/G05 proof.

Use standard HA entities and the OC plugin runtime. Wyoming is a viable alternative client bridge, but does not inherently solve the OC transport gap or reduce credentials. Do not force adoption of Wyoming solely to reuse an existing bridge.

### ADR-F — Selective reuse, not a large fork

Disposition: accepted owner direction.

Copy small compatible algorithms/tests with required licenses and provenance. Preserve no feature merely to accommodate upstream scaffolding.

### ADR-G — Public extension rather than private patch

Disposition: accepted preference.

Prefer no OC core changes. A focused generic SDK/transport PR is acceptable to propose when a gate proves it necessary. Opening/modifying upstream projects remains outside current planning authorization.

## 5. Failure/blocked-work report template

When a gate fails, record:

- Gate/test ID and module owner.
- Exact framework/source/artifact revision.
- Expected behavior and observed behavior.
- Minimal reproduction, with synthetic data.
- Whether this is an absent API, a product bug, a provider capability limit, or an authorization issue.
- Which requirements are affected.
- Plausible smallest remedy and alternatives.
- Whether another project, new credential, deployment, publication or product-scope decision is needed.
- What can proceed independently.
- Exact resume condition and next action.

Do not mark failed/blocked work complete. Do not expand scope because a test failure points to another repository or service.

## 6. Release-blocking versus informative outcomes

Blocking:

- A required feature lacks an honest functional path.
- Incorrect session/authority behavior.
- Invalid audio or missing/duplicated answer endings.
- Duplicate agent actions or cross-client delivery.
- Undisclosed private API dependency.
- Missing license obligations.
- A claim of support without required proof.

Informative/expected:

- A selected provider only supports a slower buffered mode.
- A specific account lacks a provider/API entitlement; that stage is unavailable for that account, not evidence the whole abstraction is wrong.
- An optional HA client feature is outside the declared supported matrix.
- A capability flag is present but live execution has not been tested yet; record not run rather than passed.

## 7. Review checkpoint before coding

At owner review, surface the proposed defaults and the G01/G02 technical proof tasks clearly. The owner need not choose an API implementation now. The team must not promise that all gates will pass without an OC/HA extension until evidence exists.

This document is part of the handoff protection against context compaction. Update outcomes, exact revisions and ownership when engineering begins, without rewriting historical failed observations as successful ones.
