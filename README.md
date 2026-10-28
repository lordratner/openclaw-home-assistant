# OpenClaw Voice plugin — development foundation

Reusable, agent-neutral backend for the paired Home Assistant integration.
OpenClaw owns agent/session/model/speech policy and provider credentials. HA is
the native voice client. Streaming is preferred, with functional sentence/batch
and fully buffered fallback when a configured capability cannot stream.

**Pre-release source checkpoint; not an installable plugin yet.** The test
fixture is not a production entrypoint. No live OpenClaw changes are required to
review this source or run the isolated proofs.

## Read first

- [Current execution ledger, evidence and exact next actions](implementation/STATUS.md)
- [Full paired-product design index](planning/00-README.md)
- [Plugin development plan](planning/03-OPENCLAW-PLUGIN-DEVELOPMENT-PLAN.md)
- [Companion integration plan](planning/04-HOME-ASSISTANT-DEVELOPMENT-PLAN.md)
- [Requirements and owner decisions](planning/01-REQUIREMENTS-AND-DECISIONS.md)
- [License and reuse provenance](THIRD_PARTY_NOTICES.md)

The plugin must explicitly select an existing OC agent. It must never default
silently to another agent, mutate shared session settings to apply a voice
model, duplicate a vendor credential stack, or replay an ambiguous agent turn.
Fresh mode changes history only, not the selected agent's knowledge/tools.

## Implemented here

- Owned run controls and cancellation leases.
- Atomic plugin metadata and caller-bound persistent/fresh session bindings.
- One-use pairing and revocable, hashed voice-client credentials.
- Bounded NDJSON speech subprotocol and backpressure-aware writer.
- Provider-neutral progressive/sentence-buffered synthesis scheduler.
- Native OC Gateway / HA TTS paired proof with synthetic local providers.

Still unfinished: production registration/profile UI and host adapters, complete
capability/conversation/STT/job protocol, durable turn idempotency/recovery,
full cancellation/reload/race handling, general audio normalization and release
packaging. Core libraries are not a claim that all acceptance cases pass.

## Development checks

Tested: Node 24.18.1, OC 2026.10.3, Python 3.14.10, HA 2026.10.4, FFmpeg.
Make the matching **public** OC package available in this checkout, without
editing its installed source. One local-only dependency setup option is:

```sh
npm install --no-save --package-lock=false --ignore-scripts openclaw@2026.10.3
npm test
```

For the native paired proof, place the companion repository at sibling path
`../home-assistant-openclaw-voice`, prepare its `.venv` as documented there, and
make the matching `openclaw` CLI and FFmpeg available on PATH:

```sh
npm run test:native-pair
```

`OPENCLAW_PROOF_CLI` can select another matching CLI executable. The harness
creates disposable loopback ports/config/state/workspace, strips ambient
provider credentials, uses local synthetic endpoints, disables channels and
scheduled work, and terminates its own test process group. It does not install
this plugin into a real Gateway or play audio on a satellite. Fixture timings
are not a real-provider benchmark.

The native proof demonstrates normal selected-agent tools/workspace context,
incremental text, unchanged saved session inference preferences, bundled speech
adapters, native HA unfinished-text input, client revocation and MP3 decoding.
It does **not** establish physical audibility, general codec compatibility or
the full production authentication/job lifecycle.

## Layout

`src/` contains original reusable core libraries. `tests/fixtures/host-proof/`
is an isolated, synthetic-only plugin used to exercise real public host APIs.
Do not copy its owner control routes, synthetic settings or diagnostics into
the production plugin. `planning/` is the complete design baseline.

MIT for original code; see [LICENSE](LICENSE). Third-party runtime licenses remain
with their owners.
