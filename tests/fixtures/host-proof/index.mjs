// Test fixture only. Loaded solely by the disposable loopback proof Gateway.
import { randomUUID } from "node:crypto";
import { VoiceRunControls } from "../../../src/run-controls.mjs";
import { streamSpeech, synthesizeSpeech } from "openclaw/plugin-sdk/tts-runtime";
import { speechEvents } from "../../../src/speech-stream.mjs";
import { readSpeechRequest, writeFrame } from "../../../src/protocol.mjs";
import { VoiceClients } from "../../../src/client-authority.mjs";
import { StateFile } from "../../../src/state-file.mjs";
import { OpenClawHost } from "../../../src/openclaw-host.mjs";
import { readdir } from "node:fs/promises";
export default {
  id: "voice-proof", name: "Isolated voice framework proof",
  register(api) {
    const controls = new VoiceRunControls();
    let forbiddenExecutions = 0;
    let streamObserved;
    let streamInputDone = false;
    const streamEvents = [];
    api.registerRealtimeTranscriptionProvider({
      id: "fixture-stream", label: "Synthetic finite transcription", defaultModel: "fixture-stream-v1",
      utterance: { formats: [{ encoding: "pcm_s16le", sampleRate: 16000, channels: 1 }], models: ["fixture-stream-v1"] },
      isConfigured: () => true,
      createSession(request) {
        if (!request.utterance) throw new Error("finite fixture requires explicit utterance mode");
        return {
          async connect() { streamEvents.push("connected"); },
          sendAudio(chunk) {
            request.utterance.signal.throwIfAborted();
            streamEvents.push({ bytes: chunk.length, inputDone: streamInputDone });
            streamObserved?.();
          },
          async writeAudio(chunk) { this.sendAudio(chunk); },
          async finishInput() {
            if (!streamInputDone) throw new Error("finish called before end of input");
            streamEvents.push("finished");
            return { text: "SYNTHETIC_STREAM_COMPLETE" };
          },
          close() { streamEvents.push("closed"); }, isConnected: () => true,
        };
      },
    });
    api.registerAgentHarness({ id: "voice-lock-proof", label: "Synthetic locked session proof",
      autoSelection: { providerIds: [] }, delegatedExecutionPluginIds: ["openclaw-home-assistant"],
      supports: () => ({ supported: false }), runAttempt: async () => { throw new Error("locked fixture must never dispatch"); } });
    const hostAdapter = new OpenClawHost(api, { agentId: "fixture-voice",
      conversation: { model: "voice-fixture/voice-override", thinking: "low", fast: false },
      tts: { provider: "openai", model: "fixture-tts", voice: "alloy" } });
    const clients = new VoiceClients({ state: new StateFile(process.env.VOICE_PROOF_CLIENT_STATE),
      agentId: "fixture-voice", profileId: "fixture" });
    api.on("before_model_resolve", controls.beforeModelResolve.bind(controls));
    api.on("before_model_resolve", hostAdapter.controls.beforeModelResolve.bind(hostAdapter.controls));
    api.on("llm_input", hostAdapter.observeModel.bind(hostAdapter));
    api.registerTool({
      name: "voice_proof", label: "Voice proof", description: "Return a synthetic test marker",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { return { content: [{ type: "text", text: "TOOL_PROOF_OK" }] }; },
    });
    api.registerTool({
      name: "voice_forbidden", label: "Forbidden fixture", description: "Must be denied by native tool policy",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { forbiddenExecutions++; return { content: [{ type: "text", text: "FORBIDDEN_EXECUTED" }] }; },
    });
    api.registerHttpRoute({ path: "/plugins/voice-proof/tts", auth: "plugin", match: "exact",
      async handler(req, res) {
        try { await clients.authenticate(req.headers.authorization?.replace(/^Bearer /, ""), "tts"); }
        catch {
          res.writeHead(401); res.end(); return true;
        }
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const jobId = randomUUID();
        let header, sequence = 0;
        try {
          const incoming = await readSpeechRequest(req, "fixture");
          header = incoming.header;
          const common = { cfg: api.config, agentId: "fixture-voice", disableFallback: true,
            overrides: { provider: "openai" } };
          res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
          res.flushHeaders();
          const host = {
            stream: (text) => streamSpeech({ ...common, text }),
            buffer: (text) => synthesizeSpeech({ ...common, text }),
          };
          for await (const event of speechEvents(incoming.text, { host, signal: controller.signal })) {
            sequence = event.sequence;
            await writeFrame(res, { ...event, protocol_major: 1, job_id: jobId,
              request_id: header.request_id, profile_revision: "fixture" });
          }
        } catch {
          if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/x-ndjson" });
          if (header && !res.destroyed) await writeFrame(res, { type: "error", sequence: sequence + 1,
            protocol_major: 1, job_id: jobId, request_id: header.request_id, profile_revision: "fixture" });
        } finally { res.end(); }
        return true;
      },
    });
    api.registerHttpRoute({ path: "/plugins/voice-proof/pair", auth: "plugin", match: "exact",
      async handler(req, res) {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 1024) { res.writeHead(413); res.end(); return true; } }
        try {
          const input = JSON.parse(body);
          if (Object.keys(input).length !== 1 || typeof input.pairing_code !== "string") throw new Error("invalid");
          const result = await clients.claim(input.pairing_code);
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch { res.writeHead(401); res.end(); }
        return true;
      },
    });
    api.registerHttpRoute({ path: "/plugins/voice-proof", auth: "plugin", match: "exact",
      async handler(req, res) {
        if (req.headers.authorization !== "Bearer " + process.env.VOICE_PROOF_TOKEN) {
          res.writeHead(401); res.end(); return true;
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) { res.writeHead(413); res.end(); return true; }
        }
        const request = JSON.parse(raw);
        const agentId = "fixture-voice";
        if (request.kind === "policy_status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ forbiddenExecutions })); return true;
        }
        if (request.kind === "host_locked_session") {
          const key = "agent:fixture-voice:voice-proof:locked";
          try {
            await api.runtime.agent.session.createSessionEntry({ cfg: api.config, agentId, key,
              initialEntry: { agentHarnessId: "voice-lock-proof", modelSelectionLocked: true } });
            const target = await hostAdapter.inspectSession(agentId, key);
            let code;
            try {
              await hostAdapter.runTurn({ target, principal: "native-client", conversationId: "locked-proof",
                text: "Must not dispatch", runId: randomUUID(), signal: new AbortController().signal, emit: async () => {} });
            } catch (error) { code = error.code; }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code, locked: api.runtime.agent.session.getSessionEntry({ agentId, sessionKey: key,
              readConsistency: "latest" }).modelSelectionLocked }));
          } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ fixture_error: String(error) }));
          }
          return true;
        }
        if (request.kind === "host_sessions") {
          const target = await hostAdapter.createSession({ agentId, idempotencyKey: "a".repeat(64) });
          const repeated = await hostAdapter.createSession({ agentId, idempotencyKey: "a".repeat(64) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ target, repeated, model: hostAdapter.model() })); return true;
        }
        if (request.kind === "host_turn") {
          const target = await hostAdapter.createSession({ agentId, idempotencyKey: "b".repeat(64) });
          const projected = [];
          const result = await hostAdapter.runTurn({ target, principal: "native-client", conversationId: "native-conversation",
            text: "Use voice_proof and answer with the fixture text.", runId: randomUUID(),
            signal: new AbortController().signal, emit: async (event) => { projected.push({ ...event, at: Date.now() }); } });
          const after = await hostAdapter.inspectSession(agentId, target.key);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result, projected, before: target, after })); return true;
        }
        if (request.kind === "host_stt") {
          async function* audio() { yield Buffer.alloc(3200); }
          const transcript = await hostAdapter.transcribe(audio(), { language: "en", signal: new AbortController().signal });
          const empty = await hostAdapter.transcribe((async function* () {})(), { language: "en", signal: new AbortController().signal });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ transcript, empty, remaining: await readdir(hostAdapter.tempRoot) })); return true;
        }
        if (request.kind === "host_stt_stream") {
          const streamHost = new OpenClawHost(api, { agentId,
            stt: { provider: "fixture-stream", model: "fixture-stream-v1" } });
          streamEvents.length = 0; streamInputDone = false;
          const observed = new Promise((resolve) => { streamObserved = resolve; });
          async function* input() {
            yield Buffer.alloc(3200);
            await observed;
            yield Buffer.alloc(1600);
            streamInputDone = true;
          }
          try {
            const result = await streamHost.transcribe(input(), { language: "en", signal: AbortSignal.timeout(10000) });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ result, events: streamEvents, capabilities: streamHost.sttCapabilities() }));
          } finally { streamHost.close(); streamObserved = undefined; }
          return true;
        }
        if (request.kind === "pairing_issue" || request.kind === "revoke") {
          const result = request.kind === "pairing_issue" ? await clients.issue("Synthetic HA client") : await clients.revoke(request.client_id);
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result)); return true;
        }
        if (request.kind === "speech") {
          try {
            const common = { cfg: api.config, agentId, text: "Synthetic speech fixture",
              disableFallback: true, overrides: { provider: "openai" } };
            const streaming = await streamSpeech(common);
            await streaming.release?.();
            const buffered = await synthesizeSpeech(common);
            const genericSpeech = await hostAdapter.speechHost().buffer("Generic model and voice override proof");
            const progressive = await streamSpeech({ ...common, overrides: { provider: "elevenlabs" } });
            let progressiveBytes = 0, progressiveChunks = 0;
            if (progressive.audioStream) {
              const reader = progressive.audioStream.getReader();
              try {
                while (true) { const part = await reader.read(); if (part.done) break;
                  progressiveBytes += part.value.length; progressiveChunks++; }
              } finally { reader.releaseLock(); await progressive.release?.(); }
            }
            const transcript = await api.runtime.mediaUnderstanding.transcribeAudioFile({
              cfg: api.config, agentId, filePath: process.env.VOICE_PROOF_AUDIO, mime: "audio/mpeg",
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ host_version: api.runtime.version, streaming: { ...streaming, audioStream: undefined },
              genericSpeech: { success: genericSpeech.success, provider: genericSpeech.provider,
                model: genericSpeech.providerModel, voice: genericSpeech.providerVoice },
              progressive: { ...progressive, audioStream: undefined, release: undefined,
                bytes: progressiveBytes, chunks: progressiveChunks },
              buffered: { ...buffered, audioBuffer: undefined, bytes: buffered.audioBuffer?.length },
              transcript }));
          } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error), stack: error.stack })); }
          return true;
        }
        const sessionKey = "agent:fixture-voice:voice-proof:shared";
        if (request.seed === true) {
          await api.runtime.agent.session.patchSessionEntry({ agentId, sessionKey,
            update: () => ({ modelOverride: "voice-default", providerOverride: "voice-fixture",
              modelOverrideSource: "user", thinkingLevel: "high", fastMode: true }) });
        }
        const runId = randomUUID();
        const snapshot = () => {
          const entry = api.runtime.agent.session.getSessionEntry({ agentId, sessionKey, readConsistency: "latest" });
          return Object.fromEntries([
            "modelOverride", "providerOverride", "modelOverrideSource", "thinkingLevel", "fastMode",
            "modelOverrideFallbackOriginProvider", "modelOverrideFallbackOriginModel", "modelSelectionLocked",
          ].map((key) => [key, entry?.[key] ?? null]));
        };
        const before = snapshot();
        const { lease, replyOptions } = controls.admit({ runId, agentId, sessionKey,
          model: { provider: "voice-fixture", id: "voice-override" }, thinking: "low", fast: false });
        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
        const emit = (value) => res.write(JSON.stringify(value) + "\n");
        res.on("close", () => controls.cancel(lease));
        try {
          const ctxPayload = api.runtime.channel.inbound.buildContext({
            channel: "voice-proof", provider: "voice-proof", surface: "voice-proof",
            from: "proof-client", sender: { id: "proof-client" },
            conversation: { kind: "direct", id: "proof-conversation" },
            route: { agentId, routeSessionKey: sessionKey },
            reply: { to: "proof-client", sourceReplyDeliveryMode: "none" },
            message: { rawBody: request.text, inboundEventKind: "user_request" },
            channelIngress: "unsupported",
          });
          await api.runtime.channel.inbound.dispatch({
            cfg: api.config, channel: "voice-proof", route: { agentId, sessionKey },
            ctxPayload, messageId: runId,
            delivery: { async deliver(payload, info) { emit({ type: "delivery", kind: info.kind, text: payload.text }); } },
            replyOptions: { ...replyOptions, suppressDefaultToolProgressMessages: true,
              onModelSelected: (value) => emit({ type: "model", ...value }),
              onPartialReply: async (payload) => { emit({ type: "partial", ...payload }); },
            },
          });
          emit({ type: "done", runId, before, after: snapshot() });
        } catch (error) { emit({ type: "error", error: String(error), stack: error.stack }); }
        finally { controls.release(lease); res.end(); }
        return true;
      },
    });
  },
};
