/** Versioned, bounded, content-free operation logs. Never stringify raw errors. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import codes from "./diagnostic-codes.json" with { type: "json" };
import schema from "./diagnostic-schema.json" with { type: "json" };

const reasons = new Set(codes);
const context = new AsyncLocalStorage();
const hints = new WeakMap();
const wrapped = Symbol("voice-diagnostic-original");
const fingerprintKey = randomBytes(32);
const systemCodes = new Set(schema.system_codes);
const exceptionTypes = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "ProviderAuthError"]);
const providers = new Set(["openai", "elevenlabs", "google", "deepgram", "groq", "mistral", "azure", "aws", "local"]);
const providerCodes = new Set(["authentication_error", "auth_error", "invalid_api_key", "quota_exceeded",
  "rate_limit_exceeded", "resource_exhausted", "insufficient_audio_activity", "input_error",
  "audio_too_short", "commit_throttled", "transcriber_error", "session_time_limit_exceeded"]);
const uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const label = (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v) ? v : "unknown";
const stages = new Set(schema.stages);
const categories = new Set(["authentication", "timeout", "cancelled", "no_speech", "rate_limit", "capacity",
  "protocol", "transport", "provider", "storage", "policy", "validation", "internal", "unknown"]);

export function safeFields(raw = {}, depth = 0) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of ["trace_id", "span_id", "parent_span_id", "request_id", "job_id", "call_id"])
    if (uuid(raw[key])) out[key] = raw[key];
  for (const key of ["elapsed_ms", "bytes", "frames", "segments", "attempt", "count", "failure_count", "exit_code", "suppressed"])
    if (Number.isFinite(raw[key]) && Math.abs(raw[key]) <= 2 ** 53) out[key] = Math.round(raw[key] * 1000) / 1000;
  for (const key of ["partial_output", "admitted", "continuing", "confirmed", "truncated", "detail_present", "tool_result_error", "error_reply"])
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  if (Number.isInteger(raw.http_status) && raw.http_status >= 100 && raw.http_status <= 599) out.http_status = raw.http_status;
  if (Number.isInteger(raw.transport_code) && raw.transport_code >= 1000 && raw.transport_code <= 4999) out.transport_code = raw.transport_code;
  if (reasons.has(raw.reason)) out.reason = raw.reason;
  if (providerCodes.has(raw.provider_code)) out.provider_code = raw.provider_code;
  if (categories.has(raw.category)) out.category = raw.category;
  if (schema.classification_sources.includes(raw.classification_source)) out.classification_source = raw.classification_source;
  if (schema.containers.includes(raw.container)) out.container = raw.container;
  if (systemCodes.has(raw.system_code)) out.system_code = raw.system_code;
  if (exceptionTypes.has(raw.exception_type) || raw.exception_type === "other") out.exception_type = raw.exception_type;
  if (typeof raw.error_fingerprint === "string" && /^[a-f0-9]{16}$/.test(raw.error_fingerprint)) out.error_fingerprint = raw.error_fingerprint;
  if (stages.has(raw.stage)) out.stage = raw.stage;
  if (raw.provider !== undefined) out.provider = providers.has(raw.provider) ? raw.provider : "other";
  if (schema.signals.includes(raw.signal)) out.signal = raw.signal;
  if (["realtime", "batch", "progressive", "buffered", "persistent", "per_conversation"].includes(raw.mode)) out.mode = raw.mode;
  if (Array.isArray(raw.causes)) {
    if (depth < 2) out.causes = raw.causes.slice(0, 3).map((v) => safeFields(v, depth+1));
    if (raw.causes.length > (depth < 2 ? 3 : 0)) out.truncated = true;
  }
  return out;
}

export function safeFailure(raw) {
  const out = safeFields(raw);
  while (Buffer.byteLength(JSON.stringify(out)) > 1024 && out.causes?.length) {
    out.causes.pop(); out.truncated = true;
  }
  for (const key of ["trace_id", "span_id", "parent_span_id", "call_id", "bytes", "frames", "segments", "attempt", "count", "elapsed_ms", "exit_code", "suppressed", "job_id", "request_id"])
    if (Buffer.byteLength(JSON.stringify(out)) > 1024 && Object.hasOwn(out, key)) { delete out[key]; out.truncated = true; }
  return out;
}

export function failureSummary(error, facts = {}, depth = 0) {
  try {
    const hint = error && typeof error === "object" ? hints.get(error) : null;
    const code = reasons.has(error?.code) ? error.code : reasons.has(error?.message) ? error.message : "unknown_error";
    const message = typeof error?.message === "string" ? error.message.slice(0, 4096).toLowerCase() : "";
    const providerCode = [error?.errorCode, error?.code, ...providerCodes].find((v) =>
      providerCodes.has(v) && (v === error?.errorCode || v === error?.code || new RegExp(`\\b${v}\\b`).test(message)));
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    const transport = error?.closeCode ?? error?.close_code ?? (Number.isInteger(error?.code) ? error.code : undefined);
    const transportCode = Number.isInteger(transport) && transport >= 1000 && transport <= 4999 ? transport : undefined;
    const classificationSource = reasons.has(error?.code) || providerCodes.has(error?.errorCode) || providerCodes.has(error?.code) || Number.isInteger(status) || transportCode
      ? "structured" : systemCodes.has(error?.code) ? "system" : providerCode || reasons.has(error?.message)
        ? "known_token" : exceptionTypes.has(error?.name) ? "exception" : "unknown";
    let category = "unknown";
    const detail = code + " " + (providerCode ?? "");
    if (/auth|unauthorized|scope_denied|invalid_api_key/.test(detail) || error?.name === "ProviderAuthError" || [401, 403].includes(status)) category = "authentication";
    else if (/timeout|timed_out/.test(detail) || error?.code === "ETIMEDOUT" || error?.name === "TimeoutError" || /\b(timed out|timeout)\b/.test(message)) category = "timeout";
    else if (/cancel|closed|stopping/.test(code) || error?.name === "AbortError") category = "cancelled";
    else if (/no_speech|insufficient_audio_activity|audio_too_short/.test(detail)) category = "no_speech";
    else if (/rate_limit|quota|throttled|resource_exhausted/.test(detail) || status === 429) category = "rate_limit";
    else if (/capacity|limit/.test(code)) category = "capacity";
    else if (/receipt|state|storage/.test(code) || ["EACCES", "ENOSPC", "EROFS", "EIO"].includes(error?.code)) category = "storage";
    else if (/policy|denied|locked|profile_changed|binding|session_/.test(code) || ["request_conflict", "stale_inference_settings", "conversation_mode_conflict"].includes(code)) category = "policy";
    else if (/frame|sequence|protocol|framing|json|ownership/.test(code)) category = "protocol";
    else if (transportCode || /transport|connection|replay|websocket/.test(code) || /^(?:CERT_|DEPTH_|UNABLE_|ERR_TLS_|ERR_SSL_)/.test(error?.code ?? "") || ["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"].includes(error?.code)) category = "transport";
    else if (/invalid_|unsupported_|missing_/.test(code)) category = "validation";
    else if (providerCode || /provider|transcription|synthesis/.test(code) || (Number.isInteger(status) && status >= 400)) category = "provider";
    else if (["TypeError", "SyntaxError", "RangeError"].includes(error?.name)) category = "internal";
    const children = depth < 2 ? (Array.isArray(error?.errors) ? error.errors.slice(0, 3) : error?.cause && error.cause !== error ? [error.cause] : []) : [];
    const causes = children.map((cause) => failureSummary(cause, {}, depth+1));
    const truncated = Array.isArray(error?.errors) && error.errors.length > children.length || depth >= 2 && error?.cause && error.cause !== error;
    const inherited = causes.find((v) => v.category !== "cancelled") ?? causes[0];
    const detailHint = { ...hint };
    if (detailHint.reason === "unknown_error" && code !== "unknown_error") delete detailHint.reason;
    return safeFailure({ stage: stages.has(hint?.stage ?? facts.stage) ? hint?.stage ?? facts.stage : "unknown", ...safeFields({
      ...(code === "unknown_error" && inherited ? inherited : {}),
      reason: code === "unknown_error" && inherited ? inherited.reason : code,
      category: category === "unknown" && inherited ? inherited.category : category,
      http_status: status ?? inherited?.http_status, provider_code: providerCode ?? inherited?.provider_code,
      system_code: systemCodes.has(error?.code) ? error.code : inherited?.system_code,
      transport_code: transportCode ?? inherited?.transport_code,
      classification_source: code === "unknown_error" && inherited?.classification_source ? inherited.classification_source : classificationSource,
      exception_type: exceptionTypes.has(error?.name) ? error.name : "other", detail_present: !!message,
      ...(message ? { error_fingerprint: createHmac("sha256", fingerprintKey).update(message).digest("hex").slice(0,16) } : {}),
      ...(causes.length ? { causes, failure_count: Array.isArray(error?.errors) ? error.errors.length : 1 } : {}),
      ...(truncated ? { truncated: true } : {}),
      ...facts, ...detailHint }) });
  } catch { return { stage: "unknown", reason: "unknown_error", category: "unknown" }; }
}

export function annotateFailure(error, facts) {
  if (error && typeof error === "object") hints.set(error, { ...safeFields(facts), ...hints.get(error) });
  return error;
}

export function resultFailure(result, facts = {}) {
  const attempts = Array.isArray(result?.attempts) ? result.attempts.slice(-3) : [];
  const provider = facts.provider ?? result?.provider ?? attempts.at(-1)?.provider;
  facts = { ...facts, ...(provider ? { provider } : {}) };
  const causes = attempts.map((attempt) => failureSummary(typeof attempt?.error === "string"
    ? Object.assign(new Error(attempt.error), { code: attempt.reasonCode, status: attempt.status, errorCode: attempt.errorCode })
    : attempt?.error ?? attempt, facts));
  const useful = causes.find((v) => v.category !== "unknown") ?? causes[0];
  return { ...failureSummary(typeof result?.error === "string" ? new Error(result.error) : result?.error, facts),
    ...useful, ...(causes.length ? { causes, failure_count: attempts.length } : {}) };
}

export class Diagnostics {
  constructor({ logger, limit = 128, failureLimit = 32, clock = () => performance.now() } = {}) {
    this.logger = logger; this.limit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 512)) : 128;
    this.instanceId = randomUUID();
    this.failureLimit = Number.isSafeInteger(failureLimit) ? Math.max(1, Math.min(failureLimit, 64)) : 32; this.clock = clock;
    this.recent = []; this.failures = []; this.rate = new Map(); this.sequence = 0;
    this.stats = { events_total: 0, recent_evicted: 0, failures_evicted: 0, native_suppressed: 0, observer_failures: 0 };
  }
  current() { const span = context.getStore(); return span?.owner === this ? span : null; }
  event(component, operation, phase, facts = {}, level = "debug") {
    try {
      const span = context.getStore();
      const item = { schema: 1, side: "oc", instance_id: this.instanceId, sequence: ++this.sequence, at_ms: Date.now(),
        component: label(component), operation: label(operation), phase: label(phase),
        ...safeFields(span?.fields), ...safeFields(facts) };
      this.stats.events_total++;
      this.recent.push(item); if (this.recent.length > this.limit) { this.recent.shift(); this.stats.recent_evicted++; }
      if (["failed", "partial_failure", "cleanup_failed", "interrupted"].includes(phase)) {
        this.failures.push(item); if (this.failures.length > this.failureLimit) { this.failures.shift(); this.stats.failures_evicted++; }
      }
      // Bound untrusted repeated failures without discarding the latest ring entry.
      const key = [item.component, item.operation, item.phase, item.reason].join(":");
      const now = Date.now();
      for (const [k, v] of this.rate) if (v.until <= now) this.rate.delete(k);
      let rate = this.rate.get(key);
      if (!rate && this.rate.size < 256) this.rate.set(key, rate = { until: now + 60000, count: 0 });
      const write = (value) => { const pending = this.logger?.[level]?.("voice_event " + JSON.stringify(value)); pending?.catch?.(() => { this.stats.observer_failures++; }); };
      if (rate && ++rate.count <= 8) write(item);
      else if (rate?.count === 9) write({ ...item, phase: "suppressed", suppressed: 1 });
      if (!rate || rate.count > 8) this.stats.native_suppressed++;
      return item;
    } catch { this.stats.observer_failures++; return null; } // Never fail or replay product work.
  }
  start(component, operation, facts = {}) { return new Span(this, component, operation, facts); }
  trace(component, operation, fn, facts = {}) {
    const span = this.start(component, operation, facts);
    return span.run(async () => {
      try { const value = await fn(span); span.finish("completed"); return value; }
      catch (error) { span.fail(error); throw error; }
    });
  }
  snapshot() { return structuredClone({ schema: 1, recent: this.recent, failures: this.failures, stats: this.stats }); }
  async collect(readers) {
    const values = {}, unavailable_sections = [];
    for (const name of ["inference", "jobs"]) {
      if (typeof readers[name] !== "function") continue;
      try { values[name] = await readers[name](); }
      catch (error) {
        unavailable_sections.push(name);
        this.event("diagnostics", name, "failed", failureSummary(error, { stage: "storage" }), "warn");
      }
    }
    return { values, unavailable_sections };
  }
  instrument(target, component, methods) {
    for (const operation of methods) {
      if (typeof target?.[operation] !== "function") continue;
      const original = target[operation][wrapped] ?? target[operation];
      const owner = this;
      const replacement = function (...args) {
        const span = owner.start(component, operation);
        return span.run(() => {
          const complete = (value) => {
            try {
              span.annotate(safeFields(value));
              if (component === "speech_provider" && Array.isArray(value?.attempts)) {
                const failed = value.attempts.filter((attempt) => attempt?.outcome === "failed");
                for (const attempt of failed.slice(-3)) owner.event(component, operation, "failed",
                  resultFailure({ attempts: [attempt] }, { stage: "synthesis_request" }), "warn");
                if (failed.length && value.success) span.phase("provider_fallback", { failure_count: failed.length, provider: value.provider });
              }
            } catch { owner.stats.observer_failures++; }
            span.finish("completed"); return value;
          };
          try {
            const result = original.apply(this, args);
            if (result && typeof result.then === "function") return result.then(
              complete,
              (error) => { span.fail(error); throw error; });
            return complete(result);
          } catch (error) { span.fail(error); throw error; }
        });
      };
      replacement[wrapped] = original;
      try { target[operation] = replacement; }
      catch { this.stats.observer_failures++; }
    }
    return target;
  }
}

class Span {
  constructor(owner, component, operation, facts) {
    this.owner = owner; this.component = component; this.operation = operation; this.started = owner.clock();
    const parent = context.getStore();
    this.fields = { ...parent?.fields, ...safeFields(facts), span_id: randomUUID() };
    this.fields.trace_id ??= randomUUID();
    if (parent) this.fields.parent_span_id = parent.fields.span_id;
    this.steps = []; this.finished = false;
    this.run(() => owner.event(component, operation, "started", this.fields));
  }
  run(fn) { return context.run(this, fn); }
  annotate(facts) { Object.assign(this.fields, safeFields(facts)); }
  phase(name, facts = {}) {
    const stage = label(name); if (this.steps.some((s) => s.stage === stage)) return;
    if (this.steps.length >= 48) { this.annotate({ truncated: true }); return; }
    this.steps.push({ stage, elapsed_ms: this.owner.clock() - this.started });
    this.run(() => this.owner.event(this.component, this.operation, stage,
      { ...this.fields, ...safeFields(facts), elapsed_ms: this.owner.clock() - this.started }, "info"));
  }
  fail(error, facts = {}) {
    const defaults = { storage: "storage", authority: "authorization", bindings: "binding", inference: "validation",
      http: "http_request", stt: "stt_transcription", tts: "synthesis_request", speech_provider: "synthesis_request",
      assist: "tool_execution", continuation: "dispatch", host: "dispatch", run_policy: "validation" };
    this.failure = failureSummary(error, { stage: this.steps.at(-1)?.stage ?? defaults[this.component], ...facts });
    this.finish("failed", this.failure); return this.failure;
  }
  finish(outcome, facts = {}) {
    if (this.finished) return; this.finished = true;
    const important = this.operation === "job" || this.component === "service" || this.component === "speech_provider" ||
      (["authority", "bindings", "inference", "jobs"].includes(this.component) && /issue|claim|revoke|open|rebind|update|admit|cancel|stop/.test(this.operation));
    const level = ["failed", "partial_failure", "interrupted"].includes(outcome) ? "warn" : important ? "info" : "debug";
    this.run(() => this.owner.event(this.component, this.operation, outcome,
      { ...this.fields, ...safeFields(facts), elapsed_ms: this.owner.clock() - this.started }, level));
  }
}
