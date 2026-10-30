# Product setup: OpenClaw as a Home Assistant assistant

Development pair: bridge **0.0.1-dev.10**, HA **0.0.1-dev.6**, protocol **1.2**.
This is not a promise that every provider, runtime version or satellite is certified.

## Choose what each platform owns

- **Conversation only:** existing HA STT → OpenClaw conversation → existing HA TTS.
- **All OpenClaw:** OpenClaw-backed STT → OpenClaw conversation → OpenClaw-backed TTS.
- **Mixed:** independently choose each native entity in the Assist pipeline.

HA owns pipeline selection, playback, device formats, exposed entities and native
Assist authorization. OC owns its selected agent, native history, model selection,
provider configuration and its other tool policy. Keep each provider's credentials
on its owning platform; never copy a Gateway admin token or provider key into HA.
A scoped pairing token in HA's normal config-entry storage is still a credential;
protect HA backups normally. Pairing does not identify the human speaker.

## 1. Prepare OpenClaw

Use a supported OC host and an **existing** agent. In the plugin's standard
configuration UI select `agentId`; no main-agent fallback is implicit. Leave
conversation model/thinking/fast inherited unless the native agent supports the
desired explicit override. Grant the documented conversation hook access if using OC conversation; without
it, conversation alone is unavailable and OC speech/pairing still work. If the
agent has an explicit tool allowlist, native home control needs `home_assistant`
and follow-up intent needs `voice_conversation`, under normal OC policy.

FFmpeg on the OC host is needed **only if using OC TTS**. Missing FFmpeg leaves
pairing, conversation and STT running and reports TTS unavailable. An existing
HA TTS engine needs no new OC speech dependency. OC-backed STT/TTS still require
their native provider configuration; the bridge does not provision accounts.

Install/reload through normal platform mechanisms; see [installation](INSTALL.md).
Use the owner/admin status action to inspect stage facts:

```sh
openclaw gateway call openclaw_home_assistant.status --params '{}' --json
```

Read `capabilities.stages`. `available:false` is a locally known blocker; null
means native selection/account access is unverified. `configured` is not a paid
provider test. Only a successful real operation records verification with its
time; that result is historical, not a guarantee the provider will remain online.
No billable startup tests run automatically.

## 2. Pair through HA's native configuration flow

Issue a one-use code using the OC companion plugin's owner/admin action:

```sh
openclaw gateway call openclaw_home_assistant.pairing.issue --params '{"label":"Home Assistant"}' --json
```

Enter the Gateway base URL and code in **Settings → Devices & services → Add
integration → OpenClaw Home Assistant**. Codes expire in five minutes. Use HTTPS
across untrusted networks; certificate verification is not disabled and redirects
are not followed. HTTP remains supported for controlled trusted-network setups.

Choose history behavior and, optionally, native **Device control**. Leaving it
off does not silently grant home control. Other tools already granted to the OC
agent remain a separate authority. You can change these preferences in Options.

The flow pairs only a scoped client. Duplicate/concurrent attempts for the same
backend/profile are rejected and the unused new token is revoked. The normal
configuration flow is the HA UI; no YAML or HA internal storage edits are needed.

## 3. Choose the Assist pipeline explicitly

Create or edit a voice assistant in **Settings → Voice assistants**. Choose
OpenClaw Conversation and the STT/TTS engines you want. Keep existing local HA
speech engines if desired. Assign that assistant to a test satellite yourself;
setup never changes preferred/default pipelines or other rooms.

Conversation supports any language accepted by the native agent. Speech engines
are advertised with separate language lists/defaults. Current OC SDKs do not
provide universal language/account discovery; OC speech language lists are
explicit declarations, not guessed provider support. Stage-specific
`stt.languages/defaultLanguage` and `tts.languages/defaultLanguage` override the
legacy profile list. Select only languages the chosen native engine supports.

## Streaming preferred, functional fallback automatic

- **LLM:** native partial replies stream; final-only replies work without rerunning
  the turn. Tool control/follow-up still depend on the model and native harness.
- **STT:** use finite-input realtime when supported. A stock host without the
  optional method automatically uses native batch for the same selection. An SDK-declared batch-only model or
  provider keeps its explicit primary selection. No transcript is dispatched
  until finalized input completes.
- **TTS:** use progressive audio when supported; explicit unsupported streaming
  falls back to buffered sentence synthesis. HA also buffers text automatically
  for an existing non-streaming HA TTS engine.

An explicit realtime-only STT selection cannot be turned into a batch model by
guessing a vendor alias. To declare a distinct fallback, use `stt.batch` with an
existing native provider/model; `{}` explicitly inherits the native audio pipeline:

```json
{"stt":{"provider":"your-native-provider","model":"your-selected-model","batch":{}}}
```

Without `batch`, existing explicit batch-capable selections retain their model
even when native request/auth options prevent realtime use. If the finite SDK is
absent, the same explicit selection is kept for batch; inherited selection stays
native. Set `batch:{}` to use the original native audio pipeline instead.
The native pipeline must itself have a usable batch/CLI configuration. No public
SDK can manufacture a missing account or engine; use HA-native STT if preferred.

Unsupported capability is **not** an auth/quota/network retry policy. Failures
after input consumption or audio output do not replay the utterance, repeat an
LLM turn or duplicate a device action. Native configured provider policy remains
authoritative. An unconfirmed tool outcome needs status/recovery, not resubmission.

## Automation and optional HA speech

`openclaw_voice.query` is text-only when `speaker` is omitted. With a speaker it
defaults to OC TTS; optionally set `tts_entity` to an existing HA engine:

```yaml
action: openclaw_voice.query
data:
  config_entry_id: YOUR_ENTRY_ID
  prompt: Give me a short update.
  speaker: media_player.YOUR_SPEAKER
  tts_entity: tts.YOUR_EXISTING_ENGINE
```

The external engine receives only HA's standard options, not OC job/profile
options. HA handles buffered synthesis. `start_conversation` uses the satellite's
selected pipeline and requires native interactive-satellite support; a plain
media player is not a microphone or wake-word device. `speech_requested` is not
physical playback confirmation.

## Reconfigure, reauthenticate, upgrade

- **Address changed:** use the entry's Reconfigure UI. It tests the existing
  credential and rejects a different backend/profile/agent, preserving entities.
- **Pairing revoked:** use Reauthenticate with a new one-use code for the same
  backend/profile/agent. The old credential is retired best-effort; stable entry
  and entity IDs remain. A different assistant is a new connection, not a silent
  retarget of existing history.
- **Legacy entry:** v1→v2 moves the history default into Options without changing
  mode, token or entity IDs. Stable identity is adopted on successful capability
  refresh. An old entry must first establish identity at its original address
  before moving via reauth. Legacy backends remain usable with weaker URL/agent
  duplicate checking until they support stable identity.
- **Code upgrade:** OC plugin code needs supported plugin replacement/reload;
  HA Python replacement needs Core restart. No wholesale server/Gateway reboot
  is inherent to this design. Keep the prior packages and state for rollback.

## Troubleshooting and retention

Check connection health separately from the stage you use. Missing OC TTS does
not invalidate a conversation-only pipeline. A stage with unverified availability
may be tested with an explicit benign operation; provider/network failures retain
safe reason/status/timing metadata. See [logging](LOGGING.md).

Normal/error/cancel STT spool cleanup remains in place. Startup also removes a
bounded number of old generated private audio directories (>24h), preserving
recent work, symlinks and unrelated files. This is not a deletion deadline while
OC is offline. Native provider/HA caches and OC agent histories are independent.

See [compatibility and test limits](COMPATIBILITY.md) before reporting support or
publishing a release. No native core patch, new vendor SDK or custom HA pipeline
engine is bundled in this pair.
