# Native SDK capability notes

## Companion upstream PRs

The full streaming setup documented in the README uses two OpenClaw core PRs,
both open/unmerged as of2026-10-29:

- [#187371: finite-input streaming transcription for plugins](https://github.com/openclaw/openclaw/pull/187371).
- [#187369: configured environment proxy routing for realtime transcription](https://github.com/openclaw/openclaw/pull/187369),
  required where those WebSocket/egress proxies are used.

Use a released host containing the relevant changes after merge, or a reviewed
version-matched core canary/backport. This plugin neither bundles nor installs
those core changes. Stock hosts without the finite API use native batch STT;
an explicitly realtime-only model needs a compatible configured batch alternative.

## Candidate finite-input STT integration (plugin dev.6)

The dev.6 bridge consumes the additive optional public injected-runtime method
`api.runtime.mediaUnderstanding.transcribeAudioStream`. It does not import the
private `openclaw/plugin-sdk/realtime-transcription` subpath. The reviewed core
change is PR187371 at `79b395a14b0a03bf31c66a88e950a7c13af83232`, intended for
separate backport to OpenClaw 2026.10.3; updating the bridge alone does not install it.

The helper owns configured audio-provider/model selection and finite-input
completion. The bridge contains no provider names, vendor WebSockets, commit
messages, API keys, or provider-specific audio conversion. It forwards bounded
PCM chunks while capture continues and submits only the completed transcript.
The provider owns framing, acknowledgment and safe segmentation of long audio.
Explicit batch models are not silently substituted with realtime models.

An older host, unsupported format/model or unavailable finite-input capability
uses the existing native batch path. The SDK guarantees that an unsupported
result has not touched the input iterator. A failure after streaming admission
throws and is not automatically replayed through batch or another provider.
The bridge also rejects a host that consumes input and then reports unsupported.
Capability output distinguishes batch-only hosts from provider-dependent
streaming hosts, and transcript events report the actual mode.

For initial provider proof, the ElevenLabs adapter implements finite mono PCM16
16 kHz with `scribe_v2_realtime`, serial acknowledged segments below its upstream
automatic-commit threshold, awaited final text, cancellation and no reconnect
with a truncated utterance. Other providers can implement the same generic
contract without changing this bridge. TTS is unchanged.

## Shipped 2026.10.3 limitation (without the companion SDK change)

The tested OpenClaw 2026.10.3 realtime-transcription surface exposes connection,
audio send and close/connectivity operations. It does not expose a usable
finalized-utterance commit/flush acknowledgment or watermark tied to the last
accepted sample, nor a complete sample-format/backpressure contract and explicit
selected-agent creation context for this use case.

Do not infer finalization by waiting for silence, socket close or the first
partial transcript. That can omit late words or execute a tool-bearing turn from
unfinished user speech. This is a **host SDK contract gap**, not a blanket claim
that OpenAI/ElevenLabs or every provider lacks realtime transcription.

The implemented path uploads microphone chunks, then calls OC's native batch
transcription capability once at finalized input. Capabilities honestly report
`batch` and `native_realtime_finalization_contract_unavailable`. It is functional
fallback under the accepted streaming-first policy; it is not realtime STT.

A minimal future upstream proposal should supply:

- Selected-agent/auth context and explicit supported audio formats at creation.
- Bounded/backpressured audio writes and a caller-owned abort signal.
- `finishInput()` or equivalent commit returning an acknowledgment tied to all
  accepted input, followed by an unambiguous final transcript for that utterance.
- Documented provider cancellation/release semantics and capability discovery.
- Contract tests for delayed finals, provider errors, unsupported commit, abort,
  reconnect, multiple channels/utterances and no accidental agent dispatch.

No upstream source, installed runtime bundle, provider configuration or PR was
changed for this proposal. Any upstream implementation is a separate project
assignment; this report is reviewable without expanding that boundary.

## Other evidence limits

Native OpenAI TTS on the tested host reports unsupported progressive output;
sentence-buffered fallback is exercised. Native ElevenLabs progressive audio is
exercised against a synthetic local provider endpoint. Neither proves current
real-account access, latency or speaker behavior. Model/thinking overrides use
public native dispatch; saved session settings are never patched/restored by the
production plugin. Native approval UI and alternate runtime/account combinations
still need their own compatibility evidence.
