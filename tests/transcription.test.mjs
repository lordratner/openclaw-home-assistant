import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenClawHost } from "../src/openclaw-host.mjs";

async function fixture(run, transcribeAudioStream) {
  const root = await mkdtemp(join(tmpdir(), "ha-transcription-"));
  const batchCalls = [];
  const api = {
    config: { agents: { entries: { voice: {} } },
      tools: { media: { audio: { preferredModel: "old" }, models: [] } } },
    runtime: {
      agent: { normalizeThinkingLevel: (value) => value,
        session: { resolveStorePath: () => join(root, "sessions.json") } },
      state: { resolveStateDir: () => root },
      mediaUnderstanding: { ...(transcribeAudioStream ? { transcribeAudioStream } : {}),
        transcribeAudioFile: async (params) => {
      batchCalls.push({ ...params, bytes: await readFile(params.filePath) });
      return { text: "Batch answer" };
    } } },
  };
  const host = new OpenClawHost(api, { agentId: "voice",
    stt: { provider: "unfamiliar-provider", model: "stream-model" } });
  host.tempRoot = root;
  try { await run({ host, batchCalls, root }); }
  finally { host.close(); await rm(root, { recursive: true, force: true }); }
}
async function* audio() { yield Buffer.alloc(320, 1); yield Buffer.alloc(80, 2); }
const options = () => ({ language: "en", signal: new AbortController().signal });

test("constructor uses the optional public runtime method with finite PCM arguments", async () => {
  let params, receiver;
  await fixture(async ({ host, batchCalls, root }) => {
    const opts = options();
    assert.deepEqual(host.sttCapabilities().modes, ["realtime", "batch"]);
    const result = await host.transcribe(audio(), opts);
    assert.equal(receiver, host.api.runtime.mediaUnderstanding);
    assert.deepEqual(Object.keys(params).sort(), ["agentId", "audio", "cfg", "format", "language", "scopeContext", "signal"]);
    assert.equal(params.signal, opts.signal);
    assert.equal(params.language, "en");
    assert.deepEqual(params.scopeContext, { channel: "openclaw-home-assistant", chatType: "direct" });
    assert.equal(result.text, "Complete final");
    assert.equal(batchCalls.length, 0);
    assert.deepEqual(await readdir(root), []);
  }, async function (input) {
    params = input; receiver = this;
    for await (const _chunk of input.audio) { /* Consume the finite source. */ }
    return { supported: true, text: "Complete final", no_speech: false,
      mode: "realtime", provider: "unfamiliar-provider", model: "stream-model" };
  });
});

test("streaming uses the generic SDK and original provider/model without a temporary WAV", async () => {
  await fixture(async ({ host, batchCalls, root }) => {
    const marks = [];
    host.streamingTranscriber = async (params) => {
      assert.equal(params.agentId, "voice");
      assert.deepEqual(params.cfg.tools.media.models[0], { provider: "unfamiliar-provider", model: "stream-model", capabilities: ["audio"] });
      assert.equal(params.cfg.tools.media.audio.preferredModel, undefined);
      assert.deepEqual(params.format, { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 });
      const chunks = []; for await (const chunk of params.audio) chunks.push(chunk);
      assert.deepEqual(chunks.map((chunk) => chunk.length), [320, 80]);
      return { supported: true, text: "Complete final", no_speech: false };
    };
    const result = await host.transcribe(audio(), { ...options(), timing: { mark(name) { marks.push(name); } } });
    assert.equal(result.mode, "realtime");
    assert.equal(result.text, "Complete final");
    assert.equal(batchCalls.length, 0);
    assert.deepEqual(await readdir(root), []);
    assert.ok(marks.indexOf("transcription_started") < marks.indexOf("input_complete"));
  });
});

test("unsupported streaming uses untouched audio once through native batch and cleans the WAV", async () => {
  await fixture(async ({ host, batchCalls, root }) => {
    host.streamingTranscriber = async () => ({ supported: false, reason: "unsupported" });
    const result = await host.transcribe(audio(), options());
    assert.equal(result.mode, "batch");
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(batchCalls[0].bytes.length, 444);
    assert.deepEqual(batchCalls[0].bytes.subarray(44), Buffer.concat([Buffer.alloc(320, 1), Buffer.alloc(80, 2)]));
    assert.deepEqual(await readdir(root), []);
  });
});

test("a failed or aborted stream is never replayed through batch", async () => {
  await fixture(async ({ host, batchCalls }) => {
    host.streamingTranscriber = async ({ audio: input }) => {
      for await (const _chunk of input) throw new Error("provider disconnected");
    };
    await assert.rejects(host.transcribe(audio(), options()), /provider disconnected/);
    const controller = new AbortController();
    host.streamingTranscriber = async () => {
      controller.abort(); return { supported: true, text: "Late answer", no_speech: false };
    };
    await assert.rejects(host.transcribe(audio(), { language: "en", signal: controller.signal }), /abort/i);
    assert.equal(batchCalls.length, 0);
  });
});

test("a host cannot consume streaming input and then request batch replay", async () => {
  await fixture(async ({ host, batchCalls }) => {
    await assert.rejects(host.transcribe(audio(), options()), /streaming_fallback_after_consumption/);
    assert.equal(batchCalls.length, 0);
  }, async ({ audio: input }) => {
    await input[Symbol.asyncIterator]().next();
    return { supported: false, reason: "too_late_to_fallback" };
  });
});

test("old hosts without the method transcribe the original audio through batch", async () => {
  await fixture(async ({ host, batchCalls }) => {
    const result = await host.transcribe(audio(), options());
    assert.equal(result.mode, "batch");
    assert.equal(result.text, "Batch answer");
    assert.equal(batchCalls.length, 1);
  });
});

test("older SDKs still advertise only batch capability", async () => {
  await fixture(async ({ host }) => {
    assert.deepEqual(host.sttCapabilities().modes, ["batch"]);
    host.streamingTranscriber = async () => ({ supported: false });
    assert.deepEqual(host.sttCapabilities().modes, ["realtime", "batch"]);
    assert.equal(host.sttCapabilities().selection, "configured_provider_capability");
  });
});

test("stock-host fallback can explicitly inherit native batch/CLI policy instead of a realtime-only override", async () => {
  await fixture(async ({ host, batchCalls }) => {
    host.profile = { ...host.profile, stt: { ...host.profile.stt, batch: {} } };
    host.cfg.tools.media.models = [{ type: "cli", command: "existing-local-stt", capabilities: ["audio"] }];
    await host.transcribe(audio(), options());
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].cfg, host.cfg);
    assert.equal(batchCalls[0].cfg.tools.media.models[0].command, "existing-local-stt");
  });
});

test("stock-host batch fallback preserves legacy explicit provider/model selection by default", async () => {
  await fixture(async ({ host, batchCalls }) => {
    await host.transcribe(audio(), options());
    assert.equal(batchCalls[0].cfg.tools.media.models[0].provider, host.profile.stt.provider);
    assert.equal(batchCalls[0].cfg.tools.media.models[0].model, host.profile.stt.model);
  });
});

test("an explicit batch alternative is used only after unsupported pre-consumption selection", async () => {
  await fixture(async ({ host, batchCalls }) => {
    host.profile = { ...host.profile, stt: { ...host.profile.stt,
      batch: { provider: "unfamiliar-batch-provider", model: "owner-selected-batch" } } };
    host.streamingTranscriber = async () => ({ supported: false, reason: "configured_audio_selection_requires_batch" });
    await host.transcribe(audio(), options());
    assert.deepEqual(batchCalls[0].cfg.tools.media.models[0], { provider: "unfamiliar-batch-provider", model: "owner-selected-batch", capabilities: ["audio"] });
    host.streamingTranscriber = async ({ audio: source }) => {
      await source[Symbol.asyncIterator]().next(); throw new Error("failure after consumption");
    };
    await assert.rejects(host.transcribe(audio(), options()), /failure after consumption/);
    assert.equal(batchCalls.length, 1);
  });
});

test("batch-capable explicit selection survives native request options that disallow finite streaming", async () => {
  await fixture(async ({ host, batchCalls }) => {
    host.cfg.models = { providers: { "unfamiliar-provider": { request: { allowPrivateNetwork: true } } } };
    host.streamingTranscriber = async () => ({ supported: false, reason: "configured_audio_selection_requires_batch" });
    await host.transcribe(audio(), options());
    assert.equal(batchCalls[0].cfg.tools.media.models[0].model, "stream-model");
    assert.deepEqual(batchCalls[0].cfg.models, host.cfg.models);
  });
});

test("empty input does not falsely verify a provider that was never called", async () => {
  await fixture(async ({ host, batchCalls }) => {
    const empty = async function* () {};
    const result = await host.transcribe(empty(), options());
    assert.equal(result.no_speech, true);
    assert.equal(batchCalls.length, 0);
    assert.equal(host.stageObservations.stt, undefined);
  });
});
