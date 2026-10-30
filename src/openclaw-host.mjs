/** Public OC adapter. No hashed/private bundle imports and no provider SDKs. */
import { listAgentIds, buildConfiguredModelCatalog } from "openclaw/plugin-sdk/agent-runtime";
import { streamSpeech, synthesizeSpeech, resolveExplicitTtsOverrides, resolveTtsConfig,
  resolveTtsPrefsPath, getTtsProvider, isTtsProviderConfigured } from "openclaw/plugin-sdk/tts-runtime";
import { getSpeechProvider } from "openclaw/plugin-sdk/speech-core";
import { stageFacts } from "./stage-readiness.mjs";
import { resolveProfile } from "./profile.mjs";
import { VoiceRunControls } from "./run-controls.mjs";
import { JobError } from "./jobs.mjs";
import { ReplyProjection } from "./reply-projection.mjs";
import { normalizeConversation } from "./inference-settings.mjs";
import { mkdir, mkdtemp, open, rm, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "./request-identity.mjs";
import { AssistTools, ASSIST_BINDING } from "./assist-tools.mjs";
import { VoiceContinuation, CONTINUATION_BINDING } from "./voice-continuation.mjs";
import { spawn } from "node:child_process";
import { Diagnostics, annotateFailure, failureSummary } from "./observability.mjs";
const providerInvoked = Symbol("native-stt-invoked");

function wavHeader(bytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(bytes + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(bytes, 40);
  return header;
}

export class OpenClawHost {
  constructor(api, rawProfile, cfg = api.config, diagnostics = new Diagnostics({ logger: api.logger })) {
    this.api = api;
    this.diagnostics = diagnostics;
    this.cfg = cfg;
    this.conversationGranted = !api.id || cfg.plugins?.entries?.[api.id]?.hooks?.allowConversationAccess === true;
    this.profile = resolveProfile(rawProfile, { cfg, agentIds: listAgentIds(cfg),
      normalizeThinking: api.runtime.agent.normalizeThinkingLevel });
    this.controls = new VoiceRunControls();
    this.assist = new AssistTools({ diagnostics });
    this.continuation = new VoiceContinuation({ diagnostics });
    // dev.6 also runs on the shipped SDK, where finite-input streaming is not
    // yet available. No provider-name branching or private runtime imports.
    const media = api.runtime.mediaUnderstanding;
    this.streamingTranscriber = typeof media.transcribeAudioStream === "function"
      ? media.transcribeAudioStream.bind(media) : null;
    this.observers = new Map();
    this.stageObservations = {};
    this.storePath = api.runtime.agent.session.resolveStorePath(cfg.session?.store, { agentId: this.profile.agentId });
    this.tempRoot = join(api.runtime.state.resolveStateDir(), "plugins", "openclaw-home-assistant", "tmp",
      fingerprint([this.profile.agentId, this.profile.id]).slice(0, 24));
    diagnostics.instrument(this, "host", ["prepare", "inspectSession", "createSession", "validateConversation",
      "assertSessionModel", "model", "transcribe", "runTurn", "close"]);
    diagnostics.instrument(this.controls, "run_policy", ["admit", "cancel", "release", "close"]);
  }

  context(sessionKey, text, principal, conversationId, messageId, reference) {
    return this.api.runtime.channel.inbound.buildContext({
      channel: "openclaw-home-assistant", provider: "openclaw-home-assistant", surface: "home-assistant",
      from: "home-assistant:" + principal, sender: { id: principal },
      conversation: { kind: "direct", id: conversationId, label: "Home Assistant" },
      route: { agentId: this.profile.agentId, routeSessionKey: sessionKey },
      reply: { to: "home-assistant:" + principal, sourceReplyDeliveryMode: "none" },
      message: { rawBody: text, inboundEventKind: "user_request" },
      ...(messageId ? { messageId } : {}), channelIngress: "unsupported",
      ...(reference ? { extra: { UntrustedContext: ["Home Assistant conversation context (reference data):\n" + reference] } } : {}),
    });
  }

  async prepare() {
    this.normalizerAvailable = await new Promise((resolve) => {
      const child = spawn("ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true });
      const timer = setTimeout(() => { child.kill(); resolve(false); }, 3000);
      child.once("error", () => { clearTimeout(timer); resolve(false); });
      child.once("close", (code) => { clearTimeout(timer); resolve(code === 0); });
    });
    if (!this.normalizerAvailable) this.diagnostics?.event("audio", "readiness", "unavailable",
      { reason: "audio_normalizer_unavailable" }, "warn");
    await this.cleanStaleAudio();
  }

  async cleanStaleAudio(now = Date.now()) {
    // Only old generated directories under this profile's private root. A hot
    // replacement must not delete another generation's live five-minute upload.
    try {
      const entries = await readdir(this.tempRoot, { withFileTypes: true });
      let removed = 0;
      for (const entry of entries.slice(0, 512)) {
        if (!entry.isDirectory() || !/^stt-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
        const path = join(this.tempRoot, entry.name);
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink() || now - metadata.mtimeMs < 86400000) continue;
        await rm(path, { recursive: true, force: true }); removed++;
      }
      this.diagnostics?.event("stt", "stale_audio", "cleaned", { count: removed });
    } catch (error) {
      if (error.code !== "ENOENT") this.diagnostics?.event("stt", "stale_audio", "cleanup_failed",
        failureSummary(error, { stage: "cleanup" }), "warn");
    }
  }

  recordStageResult(stage, error) {
    this.stageObservations ??= {};
    const prior = this.stageObservations[stage] ?? {};
    this.stageObservations[stage] = error ? { ...prior, last_outcome: "failed", last_failure_at: Date.now(),
      last_failure: failureSummary(error, { stage: stage === "stt" ? "stt_transcription" : stage === "tts" ? "synthesis_request" : "dispatch" }) }
      : { ...prior, last_outcome: "succeeded", last_success_at: Date.now() };
  }

  stageCapabilities() {
    let speechProvider, speechConfigured, speechStreaming;
    try {
      const config = resolveTtsConfig(this.cfg, { agentId: this.profile.agentId, channelId: "openclaw-home-assistant" });
      speechProvider = this.profile.tts.provider ?? getTtsProvider(config, resolveTtsPrefsPath(config));
      const provider = getSpeechProvider(speechProvider, this.cfg);
      speechConfigured = isTtsProviderConfigured(config, speechProvider, this.cfg);
      speechStreaming = typeof provider?.streamSynthesize === "function";
    } catch (error) {
      this.diagnostics?.event("readiness", "native_speech", "failed",
        failureSummary(error, { stage: "authorization" }), "warn");
    }
    const facts = stageFacts({ profile: this.profile, normalizer: this.normalizerAvailable,
      streamStt: !!this.streamingTranscriber, batchStt: typeof this.api.runtime.mediaUnderstanding?.transcribeAudioFile === "function",
      audioEnabled: this.cfg.tools?.media?.audio?.enabled !== false,
      conversation: this.conversationGranted && typeof this.api.runtime.channel?.inbound?.dispatch === "function",
      conversationReason: this.conversationGranted ? "native_conversation_unavailable" : "conversation_hook_grant_required",
      speechProvider, speechConfigured, speechStreaming });
    for (const [stage, result] of Object.entries(this.stageObservations ?? {})) {
      const success = result.last_outcome === "succeeded";
      facts[stage] = { ...facts[stage], ...result,
        ...(facts[stage].available !== false && success ? { state: "verified", verified: true,
          reason: "last_operation_succeeded", verification: "last_operation", verified_at: result.last_success_at } : {}) };
    }
    return facts;
  }

  async inspectSession(agentId, key) {
    if (agentId !== this.profile.agentId || !key.startsWith("agent:" + agentId + ":")) return undefined;
    const entry = this.api.runtime.agent.session.getSessionEntry({ agentId, sessionKey: key, readConsistency: "latest" });
    if (!entry?.sessionId) return undefined;
    return { key, sessionId: entry.sessionId,
      lifecycleRevision: entry.lifecycleRevision ?? entry.sessionId,
      previousSessionId: entry.previousSessionId ?? null };
  }

  async createSession({ agentId, idempotencyKey }) {
    if (agentId !== this.profile.agentId || !/^[a-f0-9]{64}$/.test(idempotencyKey)) throw new JobError("invalid_session_reservation");
    const key = `agent:${agentId}:openclaw-home-assistant:${idempotencyKey}`;
    let target = await this.inspectSession(agentId, key);
    if (target) return target;
    let failed = false;
    // Supported public channel metadata admission creates an ordinary agent
    // session without running inference. createSessionEntry is for harnesses
    // owned by the calling plugin, not for stealing the host's native harness.
    await this.api.runtime.channel.session.recordInboundSession({
      storePath: this.storePath, sessionKey: key, createIfMissing: true,
      ctx: this.context(key, "", "reservation", idempotencyKey),
      onRecordError: () => { failed = true; },
    });
    target = await this.inspectSession(agentId, key);
    if (failed || !target) throw new JobError("session_reservation_failed");
    return target;
  }

  validateConversation(value) {
    const conversation = normalizeConversation(value, this.api.runtime.agent.normalizeThinkingLevel);
    this.model(conversation);
    return conversation;
  }

  assertSessionModel(sessionKey, conversation) {
    const model = this.model(conversation);
    const entry = this.api.runtime.agent.session.getSessionEntry({ agentId: this.profile.agentId,
      sessionKey, readConsistency: "latest" });
    if (entry?.modelSelectionLocked && model &&
        ((entry.providerOverride ?? entry.modelProvider) !== model.provider || (entry.modelOverride ?? entry.model) !== model.id))
      throw new JobError("session_model_locked");
  }

  model(conversation = this.profile.conversation) {
    if (!conversation.model) return undefined;
    const base = this.api.runtime.modelConfig.resolveDefaultModelForAgent({ cfg: this.cfg, agentId: this.profile.agentId });
    const selection = this.api.runtime.modelConfig.resolveAllowedModelRef({ cfg: this.cfg,
      catalog: buildConfiguredModelCatalog({ cfg: this.cfg }), defaultProvider: base.provider, defaultModel: base.model,
      agentId: this.profile.agentId, raw: conversation.model });
    if ("error" in selection) throw new JobError("configured_model_not_allowed");
    return { provider: selection.ref.provider, id: selection.ref.model };
  }

  speechHost() {
    if (this.normalizerAvailable === false) throw new JobError("audio_normalizer_unavailable");
    const overrides = resolveExplicitTtsOverrides({ cfg: this.cfg, agentId: this.profile.agentId,
      channelId: "openclaw-home-assistant", provider: this.profile.tts.provider,
      modelId: this.profile.tts.model, voiceId: this.profile.tts.voice });
    const common = { cfg: this.cfg, agentId: this.profile.agentId, channel: "openclaw-home-assistant",
      overrides, disableFallback: true };
    return this.diagnostics.instrument({
      // Capability fallback must not switch providers solely to obtain streaming.
      stream: (text) => streamSpeech({ ...common, text }),
      // Real provider fallback remains OC's policy, never a private vendor stack.
      buffer: (text) => synthesizeSpeech({ ...common, text, disableFallback: false }),
    }, "speech_provider", ["stream", "buffer"]);
  }

  sttCapabilities() {
    return { modes: this.streamingTranscriber ? ["realtime", "batch"] : ["batch"],
      input: { encoding: "pcm_s16le", sample_rate: 16000, channels: 1 },
      ...(this.streamingTranscriber ? { selection: "configured_provider_capability" } :
        { reason: "native_realtime_finalization_contract_unavailable" }) };
  }

  async transcribe(audio, { language, signal, timing }) {
    try { const result = await this.transcribeInput(audio, { language, signal, timing });
      if (result[providerInvoked]) this.recordStageResult("stt"); return result; }
    catch (error) { this.recordStageResult("stt", error);
      throw annotateFailure(error, { stage: "stt_transcription", provider: this.profile.stt.provider }); }
  }

  async transcribeInput(audio, { language, signal, timing }) {
    signal.throwIfAborted();
    let cfg = this.cfg;
    const stt = this.profile.stt;
    if (stt.provider) {
      const media = cfg.tools?.media ?? {};
      cfg = { ...cfg, tools: { ...cfg.tools, media: { ...media,
        audio: { ...media.audio, preferredModel: undefined },
        models: [{ provider: stt.provider, ...(stt.model ? { model: stt.model } : {}), capabilities: ["audio"] }, ...(media.models ?? [])],
      } } };
    }
    let fallbackReason = "native_realtime_finalization_contract_unavailable";
    if (this.streamingTranscriber) {
      let consumed = false;
      let bytes = 0, frames = 0;
      const diagnostics = this.diagnostics;
      async function* measuredAudio() {
        consumed = true;
        try {
          for await (const chunk of audio) {
            signal.throwIfAborted();
            bytes += chunk.length; frames++;
            timing?.mark("transcription_started");
            yield chunk;
          }
          timing?.mark("input_complete");
        } finally {
          diagnostics.event("stt", "input", "closed", { bytes, frames, mode: "realtime" });
        }
      }
      const streamed = await this.streamingTranscriber({ cfg, agentId: this.profile.agentId,
        audio: measuredAudio(), format: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
        signal, language: stt.language ?? language,
        scopeContext: { channel: "openclaw-home-assistant", chatType: "direct" } });
      signal.throwIfAborted();
      if (streamed.supported) {
        this.diagnostics.event("stt", "transcription", "completed", { mode: "realtime", provider: stt.provider });
        timing?.mark("transcription_completed");
        return { text: streamed.text, no_speech: streamed.no_speech, mode: "realtime", [providerInvoked]: bytes > 0,
          language: stt.language ?? language };
      }
      // The public SDK guarantees unsupported is returned before touching the
      // audio iterator. Execution failures throw, never silently replay audio.
      if (consumed) throw new JobError("streaming_fallback_after_consumption");
      fallbackReason = streamed.reason;
      this.diagnostics.event("stt", "selection", "fallback", { mode: "batch", provider: stt.provider, reason: streamed.reason });
    }
    // Explicit fallback is an owner-authored native selection, not a vendor alias.
    // A batch-only or legacy selection stays primary, including on stock hosts.
    // Empty batch override explicitly inherits native CLI/auth/options policy.
    if (stt.batch) {
      const media = this.cfg.tools?.media ?? {};
      cfg = stt.batch.provider ? { ...this.cfg, tools: { ...this.cfg.tools, media: { ...media,
        audio: { ...media.audio, preferredModel: undefined }, models: [{ ...stt.batch, capabilities: ["audio"] }, ...(media.models ?? [])] } } } : this.cfg;
    }
    if (typeof this.api.runtime.mediaUnderstanding?.transcribeAudioFile !== "function") throw new JobError("native_stt_unavailable");
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.tempRoot, "stt-"));
    const path = join(directory, "utterance.wav");
    let file, primaryFailure, cleanupFailure;
    try {
      file = await open(path, "wx", 0o600);
      await file.write(wavHeader(0));
      let bytes = 0;
      for await (const chunk of audio) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || chunk.length % 2) throw new JobError("invalid_pcm_audio");
        bytes += chunk.length;
        if (bytes > 2097152) throw new JobError("audio_limit");
        await file.write(chunk);
      }
      signal.throwIfAborted();
      timing?.mark("input_complete");
      this.diagnostics.event("stt", "input", "completed", { bytes, mode: "batch" });
      if (!bytes) {
        this.diagnostics.event("stt", "input", "no_speech", { reason: "no_speech", bytes: 0, mode: "batch" });
        return { text: "", no_speech: true, mode: "batch" };
      }
      await file.write(wavHeader(bytes), 0, 44, 0);
      await file.close(); file = undefined;
      timing?.mark("transcription_started");
      const result = await this.api.runtime.mediaUnderstanding.transcribeAudioFile({ cfg,
        agentId: this.profile.agentId, filePath: path, mime: "audio/wav", language: stt.language ?? language });
      timing?.mark("transcription_completed");
      // This public batch API has no universal abort parameter. Fence its late
      // result honestly; cancellation does not claim the provider stopped.
      signal.throwIfAborted();
      if (typeof result.text !== "string") throw new JobError("transcription_failed");
      return { text: result.text, no_speech: !result.text.trim(), mode: "batch", [providerInvoked]: true,
        language: stt.language ?? language };
    } catch (error) { primaryFailure = error; throw error; }
    finally {
      for (const cleanup of [() => file?.close(), () => rm(directory, { recursive: true, force: true })]) {
        try { await cleanup(); }
        catch (error) {
          this.diagnostics.event("stt", "temporary_audio", "cleanup_failed", failureSummary(error, { stage: "cleanup" }), "warn");
          cleanupFailure ??= error;
        }
      }
      // Cleanup failures are visible without replacing an existing provider error.
      if (!primaryFailure && cleanupFailure) throw annotateFailure(cleanupFailure, { stage: "cleanup" });
    }
  }

  async observeModel(event, context) {
    const owner = this.observers.get(event.runId);
    if (!owner || context.agentId !== this.profile.agentId || context.sessionKey !== owner.sessionKey ||
        context.runId && context.runId !== event.runId) return;
    if (typeof event.provider !== "string" || typeof event.model !== "string") return;
    owner.timing?.observeModel(event.provider, event.model);
    await owner.emit({ type: "model", provider: event.provider, model: event.model });
  }

  async runTurn({ target, principal, conversationId, text, reference, runId, signal, emit, inference, timing, assist, requestId }) {
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 65536)
      throw new JobError("invalid_turn_text");
    const conversation = inference?.conversation ?? this.profile.conversation;
    const model = this.model(conversation);
    timing?.mark("model_selection_ready");
    const { lease, replyOptions } = this.controls.admit({ runId, agentId: this.profile.agentId,
      sessionKey: target.key, model, thinking: conversation.thinking, fast: conversation.fast });
    const abort = () => this.controls.cancel(lease);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    const projection = new ReplyProjection(emit, { diagnostics: this.diagnostics });
    this.observers.set(runId, { sessionKey: target.key, emit, timing });
    const assistLease = assist ? this.assist.open({ bundle: assist, agentId: this.profile.agentId,
      sessionKey: target.key, sessionId: target.sessionId, runId, principal, requestId, signal, emit }) : null;
    let continuationLease;
    try {
      await this.api.runtime.agent.session.runWithWorkAdmission({ storePath: this.storePath,
        sessionKey: target.key, signal }, async (lifecycleSignal) => {
        timing?.mark("work_admitted");
        const current = await this.inspectSession(this.profile.agentId, target.key);
        if (!current || current.sessionId !== target.sessionId) throw new JobError("session_changed");
        const entry = this.api.runtime.agent.session.getSessionEntry({ agentId: this.profile.agentId,
          sessionKey: target.key, readConsistency: "latest" });
        if (entry.modelSelectionLocked && model &&
            ((entry.providerOverride ?? entry.modelProvider) !== model.provider || (entry.modelOverride ?? entry.model) !== model.id))
          throw new JobError("session_model_locked");
        timing?.mark("session_ready");
        const turnSignal = AbortSignal.any([signal, replyOptions.abortSignal, lifecycleSignal]);
        continuationLease = this.continuation.open({ agentId: this.profile.agentId,
          sessionKey: target.key, sessionId: target.sessionId, runId, signal: turnSignal });
        timing?.mark("dispatch_started");
        await this.api.runtime.channel.inbound.dispatch({ cfg: this.cfg, channel: "openclaw-home-assistant",
          route: { agentId: this.profile.agentId, sessionKey: target.key },
          ctxPayload: { ...this.context(target.key, text, principal, conversationId, runId, reference),
            GatewayRunToolBindings: { [CONTINUATION_BINDING]: continuationLease.token,
              ...(assistLease ? { [ASSIST_BINDING]: assistLease.token } : {}) } }, messageId: runId,
          delivery: { deliver: (payload, info) => projection.final(payload, info) },
          replyOptions: { ...replyOptions,
            abortSignal: turnSignal,
            preserveProgressCallbackStartOrder: true, suppressDefaultToolProgressMessages: true,
            onPartialReply: (payload) => projection.partial(payload),
            onAssistantMessageStart: () => projection.start(),
          },
        });
        timing?.mark("dispatch_completed");
      });
      signal.throwIfAborted();
      const result = await projection.result({ continueConversation: continuationLease?.continuing() });
      if (projection.errorReply) {
        timing?.observeReplyError?.();
        timing?.span?.annotate({ error_reply: true });
      }
      this.recordStageResult("conversation", projection.errorReply ? new JobError("native_reply_error") : undefined);
      return { result, terminal: { continue_conversation: result.continue_conversation } };
    } catch (error) { this.recordStageResult("conversation", error); throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      assistLease?.close();
      continuationLease?.close();
      this.observers.delete(runId);
      this.controls.release(lease);
    }
  }

  close() { this.assist.close(); this.continuation.close(); this.controls.close(); this.observers.clear(); }
}
