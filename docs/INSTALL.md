# Installation, upgrade and rollback — development candidate

This is a review procedure, **not evidence that a live installation was run**.
The current artifacts are 0.0.1-dev.0 and must remain a controlled canary until
[acceptance gates](ACCEPTANCE.md) pass. Tested pair: OC 2026.10.3 / Node 24.18.1,
HA 2026.10.4 / Python 3.14.10, FFmpeg 7.1.5 on Linux. Other versions require a
separate compatibility run; do not infer broad support from version ordering.

## Before installation

1. Verify artifact hashes and record both source revisions. Keep the previous
   plugin/integration package and configuration available for rollback.
2. Confirm the target OC/HA versions, FFmpeg availability on the OC host and
   supported public SDK exports. Do not edit installed core bundles to compensate.
3. Choose an existing agent; decide whether it may use household-control tools
   and approval-requiring tools through its **normal OC policy**. Pairing does not
   grant the voice user operator/admin authority or identify a human speaker.
4. Select one test satellite/speaker and record its current Assist pipeline.
   Preserve preferred/default pipelines and unrelated devices.
5. Back up relevant OC configuration/plugin metadata and HA integration/config
   entries using the platform's normal protected backup facilities. Backups may
   contain scoped credentials and conversation data; do not attach them to issues.
6. Obtain explicit approval for the exact installation/configuration/restart and
   bounded provider/audio canary. This document does not itself authorize them.

## OC installation

After approval, install the reviewed local archive without silently enabling it:

```sh
openclaw plugins install --no-enable /review/path/lordratner-openclaw-home-assistant-0.0.1-dev.0.tgz
```

Use the normal installation-policy review; do not bypass a rejection. Preserve
existing plugin allow/deny entries. Merge the selected-agent settings from the
README, enable this plugin, and explicitly grant
`plugins.entries.openclaw-home-assistant.hooks.allowConversationAccess=true`.
Provider credentials stay in the already configured native OC auth system.
The service reports `audio_normalizer_unavailable` if FFmpeg cannot start.

Validate the configuration using the target version's supported validation
surface before activation. If a Gateway restart is required, explain impact and
verification and obtain approval for exactly:

```sh
openclaw gateway restart --safe
```

An acknowledgment only schedules the restart. After continuation, verify Gateway
health, existing channel reconnection and `openclaw_home_assistant.status`.
There is no second plugin listener and no reason to open another port.

An administrator can issue a code with:

```sh
openclaw gateway call openclaw_home_assistant.pairing.issue --params '{"label":"Home Assistant canary"}' --json
```

The returned code is short-lived private credential material. Transfer it only
to the intended HA administrator. Do not put it in repository files, logs or
public screenshots. The administrator token used for the RPC is never entered
in HA.

## HA installation

After approval, install the reviewed `custom_components/openclaw_voice/` directory
under HA's configuration directory. Use a supported file-deployment mechanism;
do not replace another integration or edit HA internal storage directly. Restart
HA only under the separately approved maintenance step, then add the integration
in Settings → Devices & services. HACS custom-repository discovery is a future
validation path, not a claim that a public HACS listing exists.

Enter the Gateway URL, one-use code and default history mode. Verify three native
entities and the `query` / `start_conversation` actions. Create/select a test Assist
pipeline explicitly; setup must not change preferred/default pipelines.

Run bounded synthetic checks in order: standalone STT, standalone TTS, text-only
query, spoken query, interactive satellite start, follow-up, second conversation,
mode override, cancellation, revocation and reauthentication. Confirm actual sound
and follow-up listening with a human observer. Record provider/model, timing,
playback target and outcome without raw audio/credentials. OpenAI first, then
ElevenLabs where the native provider supports that stage. Chargeable calls and
speaker output require the canary approval.

## Upgrade

Upgrade paired protocol-major versions together. Preserve plugin metadata and
HA config entries; never reset state to resolve an unknown receipt or stale
handle. Read release/migration notes first. Current metadata schema is v1;
unknown schemas fail closed, and no upgrade migration is claimed yet. Quiesce
active work, install reviewed versions, perform approved activation/restarts,
verify status/entities/pairing and repeat the bounded canary. An interrupted
accepted turn may have executed tools: recover its status, do not resubmit it.

## Rollback

1. Stop issuing new voice requests. Record accepted job statuses; cancel only
   owned jobs. Cancellation is not proof that remote tools/providers stopped.
2. Restore the previous integration/plugin source and reviewed configuration
   through supported mechanisms. Preserve normal OC histories and plugin receipts.
3. Use the approved restart path if needed; never substitute forced service kills.
4. Restore the test satellite's prior pipeline selection, not unrelated defaults.
5. Verify original Gateway/channels/HA behavior. Revoke a canary client through
   the admin RPC if it should no longer have access; deleting the integration
   attempts self-revocation but a disconnected backend still requires admin review.
6. Do not delete provider credentials, OC sessions or metadata as "cleanup".

## Evidence still required

Archive-content checks and source-loaded native proofs are not equivalent to a
successful package-install/upgrade/rollback on the real targets. Capture those
results separately. No live installation, provider charge, restart or audible
playback is authorized or claimed by this development checkpoint.
