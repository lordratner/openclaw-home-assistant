/** Public OC adapter. No hashed/private bundle imports and no provider SDKs. */
import { listAgentIds, buildConfiguredModelCatalog } from "openclaw/plugin-sdk/agent-runtime";
import { streamSpeech, synthesizeSpeech, resolveExplicitTtsOverrides } from "openclaw/plugin-sdk/tts-runtime";
import { resolveProfile } from "./profile.mjs";
import { VoiceRunControls } from "./run-controls.mjs";
import { JobError } from "./jobs.mjs";
import { ReplyProjection } from "./reply-projection.mjs";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "./request-identity.mjs";
import { spawn } from "node:child_process";

function wavHeader(bytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(bytes + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(bytes, 40);
  return header;
}

export class OpenClawHost {
  constructor(api, rawProfile, cfg = api.config) {
    this.api = api;
    this.cfg = cfg;
    this.profile = resolveProfile(rawProfile, { cfg, agentIds: listAgentIds(cfg),
      normalizeThinking: api.runtime.agent.normalizeThinkingLevel });
    this.controls = new VoiceRunControls();
    this.observers = new Map();
    this.storePath = api.runtime.agent.session.resolveStorePath(cfg.session?.store, { agentId: this.profile.agentId });
    this.tempRoot = join(api.runtime.state.resolveStateDir(), "plugins", "openclaw-home-assistant", "tmp",
      fingerprint([this.profile.agentId, this.profile.id]).slice(0, 24));
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
    await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true });
      const timer = setTimeout(() => { child.kill(); reject(new JobError("audio_normalizer_unavailable")); }, 3000);
      child.once("error", () => { clearTimeout(timer); reject(new JobError("audio_normalizer_unavailable")); });
      child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new JobError("audio_normalizer_unavailable")); });
    });
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

  model() {
    if (!this.profile.conversation.model) return undefined;
    const base = this.api.runtime.modelConfig.resolveDefaultModelForAgent({ cfg: this.cfg, agentId: this.profile.agentId });
    const selection = this.api.runtime.modelConfig.resolveAllowedModelRef({ cfg: this.cfg,
      catalog: buildConfiguredModelCatalog({ cfg: this.cfg }), defaultProvider: base.provider, defaultModel: base.model,
      agentId: this.profile.agentId, raw: this.profile.conversation.model });
    if ("error" in selection) throw new JobError("configured_model_not_allowed");
    return { provider: selection.ref.provider, id: selection.ref.model };
  }

  speechHost() {
    const overrides = resolveExplicitTtsOverrides({ cfg: this.cfg, agentId: this.profile.agentId,
      channelId: "openclaw-home-assistant", provider: this.profile.tts.provider,
      modelId: this.profile.tts.model, voiceId: this.profile.tts.voice });
    const common = { cfg: this.cfg, agentId: this.profile.agentId, channel: "openclaw-home-assistant",
      overrides, disableFallback: true };
    return {
      // Capability fallback must not switch providers solely to obtain streaming.
      stream: (text) => streamSpeech({ ...common, text }),
      // Real provider fallback remains OC's policy, never a private vendor stack.
      buffer: (text) => synthesizeSpeech({ ...common, text, disableFallback: false }),
    };
  }

  async transcribe(audio, { language, signal }) {
    signal.throwIfAborted();
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.tempRoot, "stt-"));
    const path = join(directory, "utterance.wav");
    let file;
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
      if (!bytes) return { text: "", no_speech: true, mode: "batch" };
      await file.write(wavHeader(bytes), 0, 44, 0);
      await file.close(); file = undefined;
      let cfg = this.cfg;
      const stt = this.profile.stt;
      if (stt.provider) {
        const media = cfg.tools?.media ?? {};
        cfg = { ...cfg, tools: { ...cfg.tools, media: { ...media,
          audio: { ...media.audio, preferredModel: undefined },
          models: [{ provider: stt.provider, ...(stt.model ? { model: stt.model } : {}), capabilities: ["audio"] }, ...(media.models ?? [])],
        } } };
      }
      const result = await this.api.runtime.mediaUnderstanding.transcribeAudioFile({ cfg,
        agentId: this.profile.agentId, filePath: path, mime: "audio/wav", language: stt.language ?? language });
      // This public batch API has no universal abort parameter. Fence its late
      // result honestly; cancellation does not claim the provider stopped.
      signal.throwIfAborted();
      if (typeof result.text !== "string") throw new JobError("transcription_failed");
      return { text: result.text, no_speech: !result.text.trim(), mode: "batch",
        language: stt.language ?? language };
    } finally {
      await file?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }

  async observeModel(event, context) {
    const owner = this.observers.get(event.runId);
    if (!owner || context.agentId !== this.profile.agentId || context.sessionKey !== owner.sessionKey ||
        context.runId && context.runId !== event.runId) return;
    if (typeof event.provider !== "string" || typeof event.model !== "string") return;
    await owner.emit({ type: "model", provider: event.provider, model: event.model });
  }

  async runTurn({ target, principal, conversationId, text, reference, runId, signal, emit }) {
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 65536)
      throw new JobError("invalid_turn_text");
    const model = this.model();
    const { lease, replyOptions } = this.controls.admit({ runId, agentId: this.profile.agentId,
      sessionKey: target.key, model, thinking: this.profile.conversation.thinking, fast: this.profile.conversation.fast });
    const abort = () => this.controls.cancel(lease);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    const projection = new ReplyProjection(emit);
    this.observers.set(runId, { sessionKey: target.key, emit });
    try {
      await this.api.runtime.agent.session.runWithWorkAdmission({ storePath: this.storePath,
        sessionKey: target.key, signal }, async (lifecycleSignal) => {
        const current = await this.inspectSession(this.profile.agentId, target.key);
        if (!current || current.sessionId !== target.sessionId) throw new JobError("session_changed");
        const entry = this.api.runtime.agent.session.getSessionEntry({ agentId: this.profile.agentId,
          sessionKey: target.key, readConsistency: "latest" });
        if (entry.modelSelectionLocked && model &&
            ((entry.providerOverride ?? entry.modelProvider) !== model.provider || (entry.modelOverride ?? entry.model) !== model.id))
          throw new JobError("session_model_locked");
        await this.api.runtime.channel.inbound.dispatch({ cfg: this.cfg, channel: "openclaw-home-assistant",
          route: { agentId: this.profile.agentId, sessionKey: target.key },
          ctxPayload: this.context(target.key, text, principal, conversationId, runId, reference), messageId: runId,
          delivery: { deliver: (payload, info) => projection.final(payload, info) },
          replyOptions: { ...replyOptions,
            abortSignal: AbortSignal.any([replyOptions.abortSignal, lifecycleSignal]),
            preserveProgressCallbackStartOrder: true, suppressDefaultToolProgressMessages: true,
            onPartialReply: (payload) => projection.partial(payload),
            onAssistantMessageStart: () => projection.start(),
          },
        });
      });
      signal.throwIfAborted();
      const result = await projection.result();
      return { result, terminal: { continue_conversation: result.continue_conversation } };
    } finally {
      signal.removeEventListener("abort", abort);
      this.observers.delete(runId);
      this.controls.release(lease);
    }
  }

  close() { this.controls.close(); this.observers.clear(); }
}
