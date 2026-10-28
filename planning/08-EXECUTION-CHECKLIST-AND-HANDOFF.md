# Execution checklist, milestones, and compaction-safe handoff

Status: DEVELOPMENT AUTHORIZED by owner message 20256. Live deployment is not authorized in this phase. Current execution state: ../implementation/STATUS.md. Historical planning restrictions below are superseded for local development by that explicit authorization.
Revision: 1, 2026-10-27.

## 1. Resume here after context compaction or team handoff

Read:

1. [Package index and approval boundary](00-README.md).
2. [Current requirements and owner decisions](01-REQUIREMENTS-AND-DECISIONS.md).
3. This document's current status and exact next action.
4. The relevant module plan and [shared contract](02-SHARED-ARCHITECTURE-AND-PROTOCOL.md).
5. [Open gates](07-RISKS-AND-COMPATIBILITY-GATES.md) and applicable [acceptance cases](05-ACCEPTANCE-AND-TEST-MATRIX.md).

Never reconstruct requirements from an old summary alone. New owner steering supersedes older research. Check the latest direct instructions before acting.

Current product decisions most likely to be lost:

- Streaming-first, NOT streaming-only; automatically support fully buffered fallback when necessary.
- OC owns agent selection, actual persistent-session target, model/thinking/fast, provider/model/voice and auth resolution.
- HA owns only connection, mode default, native entities, actions and per-action mode override.
- One fresh session per HA conversation, not per utterance; same agent knowledge/tools/memory.
- Both automation action types are required.
- Provider-neutral through OC; OpenAI first and ElevenLabs second for validation, not brand restrictions.
- Explicit selected-agent routing even though plugin installation is Gateway-scoped; a dedicated HA agent is supported.
- Two separate repositories; selective licensed reuse without design compromise.
- Local development is authorized by 20256. Live installation/restarts and unrelated upstream core changes remain separately scoped.

## 2. Current status

The authoritative, detailed implementation ledger is [implementation/STATUS.md](../implementation/STATUS.md). It supersedes the original not-started planning snapshot.

- Two local independent module repositories exist, with original core source, complete baseline plans, MIT licenses and provenance notices.
- OC automated suite: 36 passed; HA suite: 27 passed. A separate native paired framework proof passed on OC2026.10.3 / HA2026.10.4.
- Selected-agent native tool/context dispatch, fresh/existing run controls without saved-setting mutation, native HA action-mode correlation, OC speech paths and actual unfinished-text HA→OC→audio delivery are demonstrated with local synthetic providers.
- Framework foundation and speech transport exist; neither production module is installable yet. Config/registration, full conversation/STT/job protocol, both registered actions, resilience, codec normalization and real provider/hardware acceptance remain unfinished.
- No GitHub remotes, live configuration changes, real provider calls or physical playback tests have been performed for these products.
- Next: complete protocol/job lifecycle and production adapters/registration. This does not require another requirements-approval round. Live deployment still requires its own scope/rollback review.

## 3. Planning completion checklist

- [x] Capture reusable paired-product scope and component ownership.
- [x] Capture session semantics and per-action overrides.
- [x] Capture profile model/thinking/fast precedence and shared-session risk.
- [x] Capture provider-neutral automatic streaming degradation.
- [x] Capture two actions and native three-entity HA integration.
- [x] Record existing options, useful source units and actual licenses.
- [x] Write both ordered module plans with milestone exits.
- [x] Write shared protocol/lifecycle and acceptance matrix.
- [x] Incorporate explicit agent selection and dedicated-agent deployment.
- [x] Complete documentation link/ID/consistency audit.
- [x] Package a documentation-only review bundle.
- [x] Prepare package delivery and owner-review summary.
- [x] Obtain owner approval before any development — message 20256.

## 4. Cross-product milestone map

| Integration checkpoint | OC deliverables | HA deliverables | Shared exit |
| --- | --- | --- | --- |
| M0: approval and identity | P00 | H00 | Approved scope, names, ownership/license decisions; no accidental live mutation |
| M1: framework proof | P01 | H01 | G01–G08 feasibility reports; especially scoped inference and interactive override |
| M2: contract baseline | P02 | H02 | Versioned operations/events/fixtures reviewed by both owners |
| M3: configuration and connection | P03 | H03 | Scoped client, capability metadata, safe lifecycle |
| M4: session and conversation | P04–P05 | H05 | Persistent/fresh mapping and real selected-agent deltas |
| M5: speech services | P06–P07 | H04/H06 | Streaming, sentence and buffered paths all usable |
| M6: actions and resilience | P08 | H07–H08 | Both actions, cancellation, concurrency and mode isolation |
| M7: pair acceptance | P09 | H09 | Actual pair/framework/provider/satellite evidence |
| M8: release candidate | P10 | H10 | Docs, notices, install/upgrade/rollback and separate release decision |

Work with fakes may proceed independently after a stable contract, but does not count as actual pair acceptance. Do not let one team invent a different protocol to unblock itself.

## 5. OC milestone ledger

Development is now authorized. Partial implementation and evidence are tracked in implementation/STATUS.md; unchecked milestones are not complete merely because some substeps pass.

- [ ] P00 approval, repository/provenance bootstrap.
- [ ] P01 supported public host capability and inference proof.
- [ ] P02 versioned protocol and host contracts.
- [ ] P03 registration/configuration/capabilities.
- [ ] P04 session bindings and durable mappings.
- [ ] P05 real selected-agent dispatch.
- [ ] P06 streaming/batch STT.
- [ ] P07 TTS scheduling/streaming/fallback/audio continuity.
- [ ] P08 lifecycle/authority/resilience.
- [ ] P09 actual HA pair acceptance.
- [ ] P10 reviewable release candidate.

For a partially completed milestone, record substep IDs, code revisions, passed/failed tests and next action. Do not mark the milestone complete because most of its happy path works.

## 6. HA milestone ledger

- [ ] H00 approval and repository bootstrap.
- [ ] H01 native API and automation-context proof.
- [ ] H02 protocol client/conformance harness.
- [ ] H03 config entry/pairing/lifecycle.
- [ ] H04 native STT entity.
- [ ] H05 native conversation entity/session mode.
- [ ] H06 native TTS entity/playback/cache behavior.
- [ ] H07 prompt-and-reply action.
- [ ] H08 interactive satellite action.
- [ ] H09 diagnostics/interoperability.
- [ ] H10 HACS packaging/docs/rollback/release candidate.

An absent public HA mechanism for H08 is a gate outcome requiring a decision, not permission to substitute a global mode toggle.

## 7. Gate ledger

| Gate | Owner | State | Required next evidence |
| --- | --- | --- | --- |
| G00 | Product owner | Approved | Owner message 20256; local development may begin |
| G01 | OC owner | Partial native proof | Selected-agent context/tools, model/thinking, unchanged saved preferences passed; lock/runtime/race matrix unfinished |
| G02 | HA owner | Native correlation proof passed | Actual native HA start/service/log correlation passed; registered integration/hardware still pending |
| G03 | Both speech owners | Partial native proof | OpenAI transcription/buffered, ElevenLabs progressive and sentence fallback passed with local synthetic providers; live access/metadata/cache still pending |
| G04 | Both lifecycle owners | Not run | Cancellation and exact event ownership |
| G05 | Both auth/client owners | Partial native proof | Paired voice token/owner-route denial/revocation passed; production method/rate/job enforcement pending |
| G06 | Copying developer/module maintainer | Research baseline only | Per-file provenance for units actually selected |
| G07 | Both speech owners | MP3 fixture proof passed | Native pair delivered both segments and FFmpeg decoded them; normalizer/other formats/physical playback pending |
| G08 | Both maintainers | Not run | Supported release floor and paired contract matrix |

## 8. Work-unit update template

After a meaningful implementation/review unit, append:

    Date / owner:
    Module / milestone / substeps:
    Authorization and project boundary:
    Starting revision:
    Ending revision:
    Changed files or documents:
    Requirements affected:
    Tests executed and exact outcomes:
    Evidence paths:
    Open gates / blockers:
    New owner decisions:
    Runtime/deployment changes, if any:
    Exact next action:
    Resume condition if blocked:

Keep a record of failed attempts and subsequent fixes. Do not overwrite historical failures with a summary that implies the first attempt passed.

## 9. Evidence and decision discipline

- Record exact package/source/provider/framework revisions.
- Record what was observed, not inferred.
- Separate source review, mocks, actual pair behavior, provider access and audible proof.
- Keep proposed defaults labeled until reviewed/validated.
- A changed requirement updates document 01, affected module steps, tests and contract together.
- A changed protocol updates the canonical revision/fixtures and both compatibility matrices.
- A provider capability limit updates mode selection; it does not automatically change product scope.
- A framework API gap updates its G record and smallest remedy.
- A new borrowed source unit updates license/provenance before copying.
- No private deployment facts become product defaults merely because they made a local test work.

## 10. Stop and scope boundaries during future development

Stop the affected work and report before:

- Changing another project (including OC core or HA core) to satisfy a test.
- Installing/restarting/modifying a live service outside approved scope.
- Altering credentials/access or weakening pairing/permissions.
- Publishing/pushing/opening PRs without the required authority.
- Dropping a product requirement or accepting a hidden behavioral compromise.
- Continuing after the owner says stop/audit/investigate/read-only.

Independent already-authorized work may continue if it does not depend on the blocked decision. A failure does not authorize scope expansion.

## 11. Repository handoff requirements

When repository creation is authorized:

1. Transfer the approved plan snapshot to each repository.
2. Keep each module's plan principal and link the counterpart.
3. Include shared requirements/contract/test/license docs at a pinned revision.
4. Record final repository/package/domain names and ownership in both.
5. Establish where the live execution checklist and append-only decisions reside.
6. Keep this workspace copy as the planning/historical tracker, not competing application source.
7. Update source-of-truth links rather than duplicating mutable operational status everywhere.
8. Keep deployment proof, private credentials and real audio out of public repositories.

## 12. Review and implementation-ready criteria

The owner should be able to inspect:

- What each product will and will not do.
- Every user-facing setting and action.
- Persistent versus fresh history and agent-selection behavior.
- How model/thinking/fast settings apply consistently.
- How automatic streaming fallback works.
- How credentials and permissions stay contained.
- Existing code to reuse or reject and why.
- The sequence of engineering proofs and milestones.
- What evidence is required before release.
- How a new team resumes after compaction.

Only after explicit approval should the execution ledger advance from planning into M0/P00/H00.
