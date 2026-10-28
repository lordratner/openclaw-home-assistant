# Native SDK capability notes

## Reliable streaming STT finalization

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
