# Voice timing boundaries

These measurements describe software boundaries, not acoustic latency or a
provider speed guarantee. All `stages_ms` and segment fields are monotonic
milliseconds relative to the job's HTTP request (or Jobs admission for direct
internal callers). Marks record the first occurrence. Do not subtract clocks
from different processes/hosts. `created_at` is a wall-clock correlation aid.

## Backend job stages

- `request_received`, `authorization_ready`: request handler entry and completed
  scoped-client authorization; not the microphone's last spoken word.
- `binding_ready`, `settings_ready`, `admission_started`: conversation resolution,
  validated inference snapshot, and start of durable job admission.
- `job_started`: running-state metadata committed.
- `model_selection_ready`, `work_admitted`, `session_ready`, `dispatch_started`:
  native model selection, session work admission, session/lock checks, dispatch.
- `model_input`: native `llm_input` hook observed. This is not a provider HTTP
  request timestamp. `observed_model` is recorded only from that owned hook.
- `first_text`: first speakable text frame being appended to the job's replay
  stream; not necessarily received by HA. `dispatch_completed` includes native
  dispatch teardown/after-turn work, not just model generation.
- `input_complete`, `transcription_started`, `transcription_completed`: completed
  microphone input, native transcription API entry and return. The API interval
  includes the host's provider orchestration.
- `first_synthesis_request`, `first_source_audio`, `first_decoded_audio`,
  `first_audio_frame`: first sentence submission, first provider-result bytes,
  first decoded PCM and first outgoing replay-frame append. Synthesis request
  time includes the native SDK path; source bytes may contain container headers.
- `job_completed` / `job_failed`: work terminal determination, captured before
  final receipt persistence and terminal-frame delivery. `cancel_requested`
  records local cancellation, not proof a remote provider stopped.

The first 16 synthesis segments retain `request_ms`, `source_audio_ms`,
`decoded_audio_ms`, and `completed_ms`. `synthesis_requests` counts sentence
requests, not each underlying provider attempt; the native SDK may implement
its own fallback policy. `segments_truncated` marks omitted later segment detail.
No extra provider calls or per-token metadata writes are performed for timings.

Terminal snapshots are persisted with existing receipts, not a new unbounded
log. Owner diagnostics return at most 32 recent jobs and no conversation content.
The owning HA client can inspect its own job status under its existing scope.
Requested inference preferences are not proof the provider honored a service
tier; only the observed model is independently available through the hook.

## HA local diagnostics

HA retains at most 20 completed/failed/closed conversation or TTS samples in
memory. They contain kind, status, wall-clock start, and monotonic offsets for
`conversation_opened`, `first_text_received`, `first_audio_received`, `finished`
where observed. The TTS clock starts when the caller consumes the audio stream,
not when a lazy response object is created. No identities, URL tokens, prompts,
raw errors, text or audio are retained. Reload clears this ring.

`first_audio_received` is receipt by the HA TTS entity, before any later HA
conversion, network/satellite buffering or acoustic playback. HA `tts-end` can
mean that an audio URL is ready; it must not be used as synthesis completion.
