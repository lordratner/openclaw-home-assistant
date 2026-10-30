# OpenClaw Home Assistant

## Current product candidate

Bridge **dev.10** + HA **dev.6**, additive protocol **1.2**. New source candidates,
not a public compatibility certification or a claim they are installed. Start
with [the product setup guide](docs/PRODUCT.md), [compatibility](docs/COMPATIBILITY.md)
and [HA quality checklist](docs/QUALITY.md). Older versioned notes below are
historical feature evidence, not the current release status.

Use OpenClaw conversation with existing HA speech providers, all three OC
entities, or a mix. Missing OC speech dependencies do not disable text chat.
Streaming is preferred automatically and unsupported capabilities use native
batch/buffered paths; interrupted admitted work is never blindly repeated.


Agent-neutral Home Assistant speech/conversation backend. OpenClaw owns the
selected agent, normal tools/memory/policy, session target and provider credentials.
HA provides native STT, conversation and TTS entities plus two automation actions.

**Development candidate, 0.0.1-dev.10. Live acceptance remains pending.**
Production plugin registration and the paired native HA flow are implemented and
pass disposable-runtime checks. Real providers, physical speakers and the full
compatibility/approval matrix still require controlled acceptance.

## Configuration

Select an existing agent explicitly; there is no silent main-agent fallback.
Illustrative config (merge only after review, never replace the whole config):

```json
{
  "plugins": {
    "entries": {
      "openclaw-home-assistant": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "agentId": "your-existing-agent",
          "conversation": {
            "model": "inherit",
            "thinking": "inherit",
            "fast": "inherit"
          }
        }
      }
    }
  }
}
```

The conversation hook grant is required for run-scoped model selection. The plugin
uses public `before_model_resolve`/`llm_input` hooks; it does not patch/restore saved
session preferences. Optional `persistentSession` must belong to the selected
agent. Omit it to create and durably bind one target on first persistent use.
Optional `stt` accepts native `provider`, `model`, `language`; `tts` accepts native
`provider`, `model`, `voice`. Omitted settings inherit OC policy. Do not add keys
or tokens to this plugin config. Fresh mode means fresh history, not amnesia.

## Operations and evidence

### Change the next turn's model without reloading

Use the owner-only Gateway API, not a config-file edit:

```sh
openclaw gateway call openclaw_home_assistant.inference.get --params '{}' --json
openclaw gateway call openclaw_home_assistant.inference.update --params '{"expected_revision":"REVISION_FROM_GET","patch":{"model":"openai/gpt-6-luna","thinking":"medium","fast":true}}' --json
```

The response shows `defaults`, `overrides`, `effective`, `source`, and a new
`revision`. Changes apply to the next admitted turn. Existing turns keep their
settings; conversation handles and history are preserved. A stale revision,
invalid/disallowed model, invalid thinking/fast value, or conflicting bound
persistent-session model lock rejects the update without changing state. Every
turn also rechecks its own session's lock. Paired HA tokens cannot call this API.

Overrides are durable plugin state scoped to the selected agent/profile. They
take precedence over config bootstrap defaults until cleared. In a patch,
`null` clears a field back to its bootstrap default; `"inherit"` explicitly uses
the native agent/session preference instead. Config-file edits still use the
normal plugin-replacement lifecycle; this API does not hot-swap agent identity,
credentials, speech providers or plugin code. No generic agent/session settings
are rewritten. `status.profile.conversation` reports effective voice preferences,
not the generic session-status screen's saved defaults.

### Locate a slow stage

```sh
openclaw gateway call openclaw_home_assistant.diagnostics --params '{"limit":10}' --json
```

This owner-only view returns at most 32 jobs, without prompts, transcripts,
audio, credentials, or session/client IDs. It includes per-turn inference
revision/settings, observed model when the native hook supplies it, and bounded
monotonic timings. See [timing semantics](docs/TIMING.md). HA's diagnostics add
a separate bounded ring of local first-text/first-audio receive times.

- [Installation/upgrade/rollback](docs/INSTALL.md)
- [Wire contract, limits, retention and recovery](docs/PROTOCOL.md)
- [Executed checks and remaining gates](docs/ACCEPTANCE.md)
- [Native speech SDK gap](docs/SDK-GAPS.md)
- [Detailed development baseline](planning/00-README.md)
- [Current checkpoint](implementation/STATUS.md)

All eight owner RPC methods and their parameters are listed in the protocol.
Issue a one-use pairing code through `openclaw_home_assistant.pairing.issue` and
enter it in HA; never enter the owner token or provider key there.

## Development

Tested on OC 2026.10.3, Node 24.18.1, HA 2026.10.4, Python 3.14.10 and FFmpeg 7.1.5.
Other versions are not implicitly certified. FFmpeg is required only for OpenClaw-backed TTS normalization; its absence does not disable pairing, conversation or STT.
Use the matching public OC package as a development dependency (the runtime
package is not bundled). No production vendor SDK dependencies are added.

```sh
npm install --no-save --package-lock=false --ignore-scripts openclaw@2026.10.3
npm test
npm run test:native-pair
```

The native proof requires the sibling `../home-assistant-openclaw-voice` checkout
with its `.venv`, plus `openclaw` and `ffmpeg` on PATH. It creates only disposable
loopback config/state, synthetic provider endpoints and hardware fixtures. It
strips ambient provider credentials and terminates its own Gateway process group.
`OPENCLAW_PROOF_CLI` selects the tested CLI. No real audio or live service is used.

Package locally with `npm pack --ignore-scripts --pack-destination /review/path`.
The files allowlist excludes tests, development dependencies and fixture state.
No npm publication or public GitHub release has been performed.

Original code is MIT. See [provenance](THIRD_PARTY_NOTICES.md); runtime dependencies
retain their own licenses. No community application source was copied.

## Native HA Assist tools (candidate dev.3)

The [native Assist bridge](docs/NATIVE-ASSIST.md) forwards HA’s own prompt/tool API and executes callbacks through HA’s ChatLog. Enable Device control in HA options; allow the `home_assistant` tool in the selected agent’s policy. No MCP or SSH dependency. Existing entries keep control disabled until explicitly selected. Local-first pipeline choices remain untouched.

### Stale conversation recovery

Bridge dev.7 and HA dev.4 recover a retained native satellite chat ID after
voice-profile change or expiry, without replacing native session/history.
Recovery is bounded to one explicit pre-admission refresh/reopen; known or
uncertain admitted work never redispatches. See [protocol](docs/PROTOCOL.md).

### Structured diagnostics

The logging candidate adds consistent bounded lifecycle/error logs across both
products, persistent safe failure summaries, cross-layer request/job correlation,
and diagnostics readable during startup/storage failure. No transcript/audio/key
logging or automatic retry is enabled. See [logging contract](docs/LOGGING.md).
