/** Bounded, content-free monotonic timing. No prompt/audio/session fields. */
const stages = new Set(["request_received", "authorization_ready", "binding_ready", "settings_ready",
  "admission_started", "job_started", "model_selection_ready", "work_admitted",
  "session_ready", "dispatch_started", "model_input", "first_text", "dispatch_completed",
  "input_complete", "transcription_started", "transcription_completed", "first_synthesis_request",
  "first_source_audio", "first_decoded_audio", "first_audio_frame", "job_completed", "job_failed", "cancel_requested"]);
const segmentStages = new Set(["request", "source_audio", "decoded_audio", "completed"]);
export class RunTiming {
  constructor(clock = () => performance.now()) {
    this.clock = clock; this.started = clock(); this.marks = {}; this.segments = []; this.synthesisRequests = 0;
  }
  elapsed() { return Math.max(0, Math.round((this.clock() - this.started) * 1000) / 1000); }
  mark(name) {
    if (!stages.has(name)) throw new TypeError("invalid_timing_stage");
    const first = this.marks[name] === undefined;
    this.marks[name] ??= this.elapsed();
    if (first) this.span?.phase(name);
  }
  attach(span) { this.span = span; }
  lastStage() { return Object.keys(this.marks).at(-1) ?? "unknown"; }
  observeReplyError() { this.errorReply = true; }
  segment(name, index) {
    if (!segmentStages.has(name) || !Number.isSafeInteger(index) || index < 0) throw new TypeError("invalid_timing_segment");
    if (name === "request") this.synthesisRequests++;
    if (index >= 16) return;
    this.segments[index] ??= { index };
    this.segments[index][name + "_ms"] ??= this.elapsed();
  }
  observeModel(provider, model) {
    const safe = (v) => typeof v === "string" && v.length <= 256 && /^[a-zA-Z0-9_.:/-]+$/.test(v);
    if (safe(provider) && safe(model)) this.observedModel = { provider, model };
    this.mark("model_input");
  }
  snapshot() {
    return { clock: "monotonic", elapsed_ms: this.elapsed(), stages_ms: { ...this.marks },
      synthesis_requests: this.synthesisRequests, segments: this.segments.filter(Boolean).map((s) => ({ ...s })),
      segments_truncated: this.synthesisRequests > 16,
      ...(this.observedModel ? { observed_model: { ...this.observedModel } } : {}),
      ...(this.errorReply ? { error_reply: true } : {}) };
  }
}
