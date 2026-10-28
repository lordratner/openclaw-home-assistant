# OpenClaw Home Assistant

Agent-neutral Home Assistant speech/conversation backend. OpenClaw owns the
selected agent, normal tools/memory/policy, session target and provider credentials.
HA provides native STT, conversation and TTS entities plus two automation actions.

**Development candidate, 0.0.1-dev.0. Not yet approved for live deployment.**
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

- [Installation/upgrade/rollback](docs/INSTALL.md)
- [Wire contract, limits, retention and recovery](docs/PROTOCOL.md)
- [Executed checks and remaining gates](docs/ACCEPTANCE.md)
- [Native speech SDK gap](docs/SDK-GAPS.md)
- [Detailed development baseline](planning/00-README.md)
- [Current checkpoint](implementation/STATUS.md)

All five owner RPC methods and their parameters are listed in the protocol.
Issue a one-use pairing code through `openclaw_home_assistant.pairing.issue` and
enter it in HA; never enter the owner token or provider key there.

## Development

Tested on OC 2026.10.3, Node 24.18.1, HA 2026.10.4, Python 3.14.10 and FFmpeg 7.1.5.
Other versions are not implicitly certified. FFmpeg is required at backend startup.
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
