/** Same-Gateway HTTP transport. The module never opens its own listener. */
import { randomUUID } from "node:crypto";
import { VoiceClients, ClientAuthorityError } from "./client-authority.mjs";
import { SessionBindings, SessionBindingError } from "./session-bindings.mjs";
import { Jobs, JobError } from "./jobs.mjs";
import { ProtocolError, readSpeechRequest, readFrames, writeFrame } from "./protocol.mjs";
import { canonicalSpeech } from "./audio-stream.mjs";
import { InferenceSettings } from "./inference-settings.mjs";
import { validateAssist } from "./assist-tools.mjs";
import { RunTiming } from "./timing.mjs";
import { Diagnostics, failureSummary } from "./observability.mjs";
import { fingerprint } from "./request-identity.mjs";

export const HTTP_PREFIX = "/plugins/openclaw-home-assistant/v1";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function routeOperation(raw) {
  try {
    const path = new URL(raw, "http://gateway.invalid").pathname.slice(HTTP_PREFIX.length);
    if (["/pair", "/capabilities", "/conversations", "/turns", "/tts", "/stt"].includes(path)) return path.slice(1);
    if (/^\/conversations\/[^/]+$/.test(path)) return "conversation_close";
    const match = /^\/jobs\/[^/]+(?:\/(events|cancel|tool-results|tool-claim))?$/.exec(path);
    return match ? "job_" + (match[1]?.replaceAll("-", "_") ?? "status") : "unknown_route";
  } catch { return "invalid_route"; }
}
const closed = (value, names) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !names.includes(key)))
    throw new ProtocolError("unexpected_field");
};
const identity = (value, max = 256) => {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > max)
    throw new ProtocolError("invalid_identity");
  return value;
};

async function body(request, max = 131072) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw new ProtocolError("body_limit");
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ProtocolError("invalid_json"); }
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...(status >= 400 ? { Connection: "close" } : {}) });
  response.end(JSON.stringify(value));
  return true;
}

class Limits {
  #windows = new Map();
  allow(key, maximum) {
    const now = Date.now();
    for (const [id, value] of this.#windows) if (value.until <= now) this.#windows.delete(id);
    let window = this.#windows.get(key);
    if (!window) {
      if (this.#windows.size >= 1024) return false;
      this.#windows.set(key, window = { count: 0, until: now + 60000 });
    }
    return ++window.count <= maximum;
  }
}

export class HomeAssistantService {
  #limits = new Limits();
  #stopping = false;
  constructor({ host, state, jobsOptions = {} }) {
    this.host = host;
    this.state = state;
    this.diagnostics = host.diagnostics ?? new Diagnostics();
    state.diagnostics = this.diagnostics;
    this.diagnostics.instrument(state, "storage", ["read", "transaction"]);
    this.profile = host.profile;
    this.inference = new InferenceSettings({ state, agentId: this.profile.agentId, profileId: this.profile.id,
      defaults: this.profile.conversation, validate: (value) => host.validateConversation ? host.validateConversation(value) : value });
    this.clients = new VoiceClients({ state, agentId: this.profile.agentId, profileId: this.profile.id, diagnostics: this.diagnostics });
    this.jobs = new Jobs({ state, agentId: this.profile.agentId, profileId: this.profile.id,
      diagnostics: this.diagnostics, ...jobsOptions });
    this.bindings = new SessionBindings({ state, host, agentId: this.profile.agentId,
      profileId: this.profile.id, profileRevision: this.profile.revision, persistentSession: this.profile.persistentSession,
      diagnostics: this.diagnostics });
    this.clients.onRevoke((principal) => this.jobs.cancelOwner(principal));
    this.diagnostics.instrument(this.clients, "authority", ["issue", "claim", "authenticate", "authorize", "list", "revoke", "close"]);
    this.diagnostics.instrument(this.bindings, "bindings", ["open", "resolve", "close", "describePersistent", "rebindPersistent"]);
    this.diagnostics.instrument(this.inference, "inference", ["get", "snapshot", "update"]);
    this.diagnostics.instrument(this.jobs, "jobs", ["lookup", "admit", "status", "cancel", "cancelOwner", "wait", "stop"]);
  }

  async initialize() {
    if (this.identity) return;
    this.initializing ??= this.state.transaction((all) => {
      const key = fingerprint([this.profile.agentId, this.profile.id]);
      const scope = all["service_identity:v1"] ??= { instance_id: randomUUID(), profiles: {} };
      if (!uuid.test(scope.instance_id) || !scope.profiles || typeof scope.profiles !== "object" || Array.isArray(scope.profiles))
        throw new JobError("invalid_service_identity");
      if (!scope.profiles[key]) {
        if (Object.keys(scope.profiles).length >= 256) throw new JobError("profile_identity_capacity");
        scope.profiles[key] = randomUUID();
      }
      if (!uuid.test(scope.profiles[key])) throw new JobError("invalid_service_identity");
      return Object.freeze({ instance_id: scope.instance_id, profile_id: scope.profiles[key] });
    });
    this.identity = await this.initializing;
  }

  assertStage(stage) {
    const facts = this.host.stageCapabilities?.()[stage];
    if (facts?.available === false) throw new JobError(facts.reason ?? "stage_unavailable");
  }

  async updateInference(params) {
    return this.inference.update(params, { validateTarget: async (conversation, all) => {
      const key = all[this.bindings.namespace]?.persistent?.key ?? this.profile.persistentSession;
      if (key) this.host.assertSessionModel(key, conversation);
    } });
  }

  capabilities() {
    const stages = this.host.stageCapabilities?.();
    return { protocol_major: 1, protocol_minor: 2, profile_revision: this.profile.revision,
      ...(this.identity ? { service: this.identity } : {}), ...(stages ? { stages } : {}),
      agent: { id: this.profile.agentId }, session_modes: ["persistent", "per_conversation"],
      languages: [...this.profile.languages], default_language: this.profile.defaultLanguage,
      stt: stages?.stt ?? this.host.sttCapabilities?.() ?? { modes: ["batch"],
        input: { encoding: "pcm_s16le", sample_rate: 16000, channels: 1 },
        reason: "native_realtime_finalization_contract_unavailable" },
      tts: stages?.tts ?? { input: "incremental_text", orchestration: "sentence", output: "capability_dependent",
        output_formats: ["wav"], audio_format: { encoding: "pcm_s16le", sample_rate: 24000, channels: 1, sample_width: 2 }, fallback: "automatic" },
      limits: { text_bytes: 65536, audio_chunk_bytes: 32768, stt_audio_bytes: 2097152,
        replay_bytes: this.jobs.replayBytes, receipt_ms: this.jobs.retentionMs, result_ms: this.jobs.resultTtlMs },
      assist_tools: { version: 1, max_calls: 20, execution: "home_assistant", transport: "job_events" },
      jobs: { request_id: "uuid7", event_replay: "bounded", completed_result_recovery: true,
        retry_executes_again: false, cancellation_confirmation: "capability_dependent" },
    };
  }

  #revision(input, fields, previous = false) {
    closed(input, ["protocol_major", "profile_revision", ...fields]);
    if (input.protocol_major !== 1) throw new ProtocolError("unsupported_protocol");
    if (typeof input.profile_revision !== "string" || !input.profile_revision || input.profile_revision.length > 128)
      throw new ProtocolError("invalid_profile_revision");
    if (!previous && input.profile_revision !== this.profile.revision) throw new ProtocolError("profile_changed");
  }

  async handle(request, response) {
    return this.diagnostics.trace("http", routeOperation(request.url), async (span) => {
      const timing = new RunTiming(); timing.attach(span);
      try { return await this.#handle(request, response, timing); }
      finally { span.annotate({ http_status: response.statusCode }); }
    });
  }

  async #handle(request, response, timing) {
    let authority;
    timing.mark("request_received");
    try {
      if (this.#stopping) throw new JobError("backend_stopping");
      await this.initialize();
      const url = new URL(request.url, "http://gateway.invalid");
      if (!url.pathname.startsWith(HTTP_PREFIX + "/")) return false;
      const path = url.pathname.slice(HTTP_PREFIX.length);
      if (path === "/pair" && request.method === "POST") {
        if (!this.#limits.allow("pair:" + request.socket.remoteAddress, 10)) return json(response, 429, { code: "rate_limit" });
        const input = await body(request, 2048);
        closed(input, ["pairing_code"]);
        const client = await this.clients.claim(input.pairing_code);
        return json(response, 200, { ...client, capabilities: this.capabilities() });
      }
      const header = request.headers.authorization;
      if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new ClientAuthorityError("unauthorized");
      if ((request.rawHeaders ?? []).filter((value, index) => index % 2 === 0 && value.toLowerCase() === "authorization").length !== 1)
        throw new ClientAuthorityError("unauthorized");
      const token = header.slice(7);
      authority = await this.clients.authorize(token, path === "/tts" ? "tts" : path === "/stt" ? "stt" : path.startsWith("/jobs/") || path === "/capabilities" ? "capabilities" : "conversation");
      timing.mark("authorization_ready");
      if (!this.#limits.allow("client:" + authority.id, 120)) return json(response, 429, { code: "rate_limit" });
      if (path === "/pair" && request.method === "DELETE")
        return json(response, 200, { revoked: await this.clients.revoke(authority.id) });
      if (path === "/capabilities" && request.method === "GET") return json(response, 200, this.capabilities());
      if (path === "/conversations" && request.method === "POST") {
        const input = await body(request, 8192);
        this.#revision(input, ["ha_conversation_id", "mode"]);
        const result = await this.bindings.open({ principal: authority.id,
          haConversationId: identity(input.ha_conversation_id), mode: input.mode });
        authority.assertCurrent();
        return json(response, 200, result);
      }
      const conversation = /^\/conversations\/([^/]+)$/.exec(path);
      if (conversation && request.method === "DELETE") {
        if (!uuid.test(conversation[1])) throw new ProtocolError("invalid_conversation_handle");
        return json(response, 200, { closed: await this.bindings.close(authority.id, conversation[1]) });
      }
      if (path === "/turns" && request.method === "POST") {
        const input = await body(request, 1179648);
        this.#revision(input, ["request_id", "conversation_handle", "text", "context", "assist"], true);
        const assist = validateAssist(input.assist);
        if (!uuid.test(input.conversation_handle) || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text) > 65536)
          throw new ProtocolError("invalid_turn");
        if (input.context !== undefined && (typeof input.context !== "string" || Buffer.byteLength(input.context) > 8192))
          throw new ProtocolError("invalid_conversation_context");
        const reference = input.context?.trim() ? input.context : undefined;
        const descriptor = { principal: authority.id, requestId: input.request_id,
          kind: "turn", profileRevision: input.profile_revision,
          payload: { handle: input.conversation_handle, text: input.text, ...(assist ? { assist } : {}), ...(reference ? { context: reference } : {}) } };
        this.diagnostics.current()?.annotate({ request_id: input.request_id });
        const existing = await this.jobs.lookup(descriptor);
        if (existing) return await this.#stream(response, authority, existing, 0);
        if (input.profile_revision !== this.profile.revision) throw new ProtocolError("profile_changed");
        this.assertStage("conversation");
        const binding = await this.bindings.resolve(authority.id, input.conversation_handle);
        timing.mark("binding_ready");
        authority.assertCurrent();
        // Preference capture is the inference admission boundary. Retries above
        // reuse their original receipt and never acquire a newer preference.
        const inference = await this.inference.snapshot();
        timing.mark("settings_ready");
        const admission = await this.jobs.admit({ ...descriptor, inference, timing,
          run: ({ signal, emit, timing }) => this.host.runTurn({ target: binding.target, inference, timing,
            principal: authority.id, conversationId: binding.haConversationId, text: input.text, reference, assist, requestId: input.request_id,
            runId: randomUUID(), signal, emit }),
        });
        return await this.#stream(response, authority, admission, 0);
      }
      if (path === "/tts" && request.method === "POST") {
        this.assertStage("tts");
        const incoming = await readSpeechRequest(request, this.profile.revision);
        this.diagnostics.current()?.annotate({ request_id: incoming.header.request_id });
        if (!(this.profile.tts?.languages ?? this.profile.languages).includes(incoming.header.language)) throw new ProtocolError("unsupported_language");
        const admission = await this.jobs.admit({ principal: authority.id, requestId: incoming.header.request_id,
          kind: "tts", profileRevision: this.profile.revision, timing,
          payload: { language: incoming.header.language, input: "incremental_text" },
          run: async ({ signal, emit, timing }) => {
            let terminal;
            try {
              for await (const event of canonicalSpeech(incoming.text, { host: this.host.speechHost(), signal, timing })) {
                const { sequence, type, ...value } = event;
                if (type === "done") terminal = value;
                else await emit({ type, ...value });
              }
              if (terminal?.audio_bytes > 44) this.host.recordStageResult?.("tts");
            } catch (error) { this.host.recordStageResult?.("tts", error); throw error; }
            return { terminal };
          },
        });
        if (admission.duplicate) return json(response, 409, { code: "upload_already_admitted", job_id: admission.job_id });
        return await this.#stream(response, authority, admission, 0, true);
      }
      if (path === "/stt" && request.method === "POST") {
        this.assertStage("stt");
        const frames = readFrames(request)[Symbol.asyncIterator]();
        const { value: first, done } = await frames.next();
        if (done) throw new ProtocolError("missing_start");
        this.diagnostics.current()?.annotate({ request_id: first.request_id });
        this.#revision(first, ["type", "request_id", "language", "encoding", "sample_rate", "channels"]);
        if (first.type !== "start" || first.encoding !== "pcm_s16le" || first.sample_rate !== 16000 || first.channels !== 1 ||
            !(this.profile.stt?.languages ?? this.profile.languages).includes(first.language)) throw new ProtocolError("invalid_audio_metadata");
        const audio = this.#audio(frames);
        const admission = await this.jobs.admit({ principal: authority.id, requestId: first.request_id,
          kind: "stt", profileRevision: this.profile.revision, timing,
          payload: { language: first.language, encoding: first.encoding, sample_rate: 16000, channels: 1 },
          run: async ({ signal, emit, timing }) => {
            const result = await this.host.transcribe(audio, { language: first.language, signal, timing });
            await emit({ type: "transcript", text: result.text, final: true, mode: result.mode ?? "batch" });
            return { result, terminal: { no_speech: result.no_speech === true } };
          },
        });
        if (admission.duplicate) return json(response, 409, { code: "upload_already_admitted", job_id: admission.job_id });
        return await this.#stream(response, authority, admission, 0, true);
      }
      const jobPath = /^\/jobs\/([^/]+)(?:\/(events|cancel|tool-results|tool-claim))?$/.exec(path);
      if (jobPath) {
        const id = jobPath[1];
        if (!uuid.test(id)) throw new ProtocolError("invalid_job_id");
        const status = await this.jobs.status(authority.id, id);
        await this.clients.authenticate(token, status.kind === "turn" ? "conversation" : status.kind);
        authority.assertCurrent();
        if (jobPath[2] === "tool-claim" && request.method === "POST") {
          if (status.kind !== "turn" || status.status !== "running") throw new JobError("assist_call_closed");
          const input = await body(request, 512);
          closed(input, ["call_id"]);
          if (typeof input.call_id !== "string") throw new JobError("invalid_assist_call");
          authority.assertCurrent();
          return json(response, 200, this.host.assist.claim(authority.id, status.request_id, input.call_id));
        }
        if (jobPath[2] === "tool-results" && request.method === "POST") {
          if (status.kind !== "turn" || status.status !== "running") throw new JobError("assist_call_closed");
          const input = await body(request, 60000);
          authority.assertCurrent();
          return json(response, 200, this.host.assist.result(authority.id, status.request_id, input));
        }
        if (!jobPath[2] && request.method === "GET") return json(response, 200, status);
        if (jobPath[2] === "cancel" && request.method === "POST") return json(response, 200, await this.jobs.cancel(authority.id, id));
        if (jobPath[2] === "events" && request.method === "GET") {
          if ([...url.searchParams.keys()].some((key) => key !== "after")) throw new ProtocolError("unexpected_query");
          const after = Number(url.searchParams.get("after") ?? "0");
          return await this.#stream(response, authority, status, after);
        }
      }
      return json(response, 404, { code: "not_found" });
    } catch (error) {
      if (response.headersSent) {
        this.diagnostics.current()?.fail(error, { stage: "http_request", http_status: response.statusCode, admitted: true });
        response.destroy(); return true;
      }
      const known = error instanceof ProtocolError || error instanceof JobError ||
        error instanceof ClientAuthorityError || error instanceof SessionBindingError;
      const code = known ? error.code : "backend_unavailable";
      const status = error instanceof ClientAuthorityError ? 401 : code === "job_not_found" || code === "conversation_not_found" ? 404 :
        ["replay_gap", "replay_unavailable", "request_conflict", "profile_changed"].includes(code) ? 409 : code?.endsWith("capacity") ? 429 : known ? 400 : 503;
      this.diagnostics.current()?.fail(error, { stage: timing.lastStage?.(), http_status: status });
      json(response, status, { code, ...(error.jobId && uuid.test(error.jobId) ? { job_id: error.jobId } : {}) });
      return true;
    } finally { authority?.release(); }
  }

  async *#audio(frames) {
    let sequence = 0, bytes = 0, ended = false;
    for await (const frame of { [Symbol.asyncIterator]: () => frames }) {
      if (ended || frame.sequence !== ++sequence) throw new ProtocolError("input_sequence");
      if (frame.type === "end") { closed(frame, ["type", "sequence"]); ended = true; continue; }
      closed(frame, ["type", "sequence", "audio"]);
      if (frame.type !== "audio" || typeof frame.audio !== "string" || frame.audio.length > 43692 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.audio))
        throw new ProtocolError("invalid_audio_chunk");
      const chunk = Buffer.from(frame.audio, "base64");
      bytes += chunk.length;
      if (!chunk.length || chunk.length % 2 || chunk.length > 32768 || bytes > 2097152) throw new ProtocolError("audio_limit");
      yield chunk;
    }
    if (!ended) throw new ProtocolError("missing_end");
  }

  async #stream(response, authority, admission, after, cancelOnDisconnect = false) {
    this.diagnostics.current()?.annotate({ job_id: admission.job_id, request_id: admission.request_id, admitted: true });
    const output = new AbortController();
    const signal = AbortSignal.any([authority.signal, output.signal]);
    let stream;
    try { stream = this.jobs.events(authority.id, admission.job_id, after, signal); }
    catch (error) {
      if (error.code === "job_not_found") throw Object.assign(new JobError("replay_unavailable"), { jobId: admission.job_id });
      throw error;
    }
    const onClose = () => {
      if (response.writableEnded) return;
      output.abort();
      this.diagnostics.event("http", "output", "disconnected", { job_id: admission.job_id, request_id: admission.request_id });
      if (cancelOnDisconnect) void this.jobs.cancel(authority.id, admission.job_id).catch((error) => {
        this.diagnostics.event("http", "disconnect_cancel", "cleanup_failed", failureSummary(error, { job_id: admission.job_id, stage: "cleanup" }), "warn");
      });
    };
    response.on("close", onClose);
    try {
      authority.assertCurrent();
      this.jobs.start(authority.id, admission.job_id);
      if (response.destroyed) onClose();
      response.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
        "X-OpenClaw-Job-ID": admission.job_id, "X-OpenClaw-Request-ID": admission.request_id });
      response.flushHeaders();
      for await (const event of stream) {
        authority.assertCurrent();
        await writeFrame(response, event);
      }
      response.end();
    } finally {
      response.off("close", onClose);
      await stream.return();
    }
    return true;
  }

  async stop() {
    this.#stopping = true;
    this.clients.close();
    const unresolved = await this.jobs.stop();
    this.host.close();
    return { cancellation_unconfirmed_jobs: unresolved.length };
  }
}
