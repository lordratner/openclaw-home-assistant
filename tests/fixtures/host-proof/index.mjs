// Test fixture only. Loaded solely by the disposable loopback proof Gateway.
import { randomUUID } from "node:crypto";
import { VoiceRunControls } from "../../../src/run-controls.mjs";
import { streamSpeech, synthesizeSpeech } from "openclaw/plugin-sdk/tts-runtime";
import { speechEvents } from "../../../src/speech-stream.mjs";
import { readSpeechRequest, writeFrame } from "../../../src/protocol.mjs";
import { VoiceClients } from "../../../src/client-authority.mjs";
import { StateFile } from "../../../src/state-file.mjs";
export default {
  id: "voice-proof", name: "Isolated voice framework proof",
  register(api) {
    const controls = new VoiceRunControls();
    const clients = new VoiceClients({ state: new StateFile(process.env.VOICE_PROOF_CLIENT_STATE),
      agentId: "fixture-voice", profileId: "fixture" });
    api.on("before_model_resolve", controls.beforeModelResolve.bind(controls));
    api.registerTool({
      name: "voice_proof", label: "Voice proof", description: "Return a synthetic test marker",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { return { content: [{ type: "text", text: "TOOL_PROOF_OK" }] }; },
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
