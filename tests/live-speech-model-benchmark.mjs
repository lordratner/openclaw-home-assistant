/** Explicitly opt-in, silent native speech comparison. No global settings writes. */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

if (process.env.VOICE_LIVE_BENCHMARK !== "1") throw new Error("Set VOICE_LIVE_BENCHMARK=1 only for an authorized live test");
const output = process.argv[2];
if (!output) throw new Error("Provide an evidence output path");
const rpc = (method, params = {}) => callGatewayFromCli(method, { json: true, timeout: "60000" }, params, { progress: false });
const providers = await rpc("tts.providers");
const openai = providers.providers?.find((p) => p.id === "openai");
const order = ["tts-1", "gpt-4o-mini-tts", "gpt-4o-mini-tts", "tts-1", "tts-1", "gpt-4o-mini-tts"];
if (!openai?.configured || !order.every((model) => openai.models.includes(model))) throw new Error("Required native speech models are not configured/advertised");
const evidence = { method: "native tts.convert per-request overrides; buffered full-result timing, not first-byte or audible latency",
  text: "The answer is four.", voice: "nova", settings_changed: false, playback: false, samples: [] };
for (const model of order) {
  const start = performance.now();
  try {
    const result = await rpc("tts.convert", { text: evidence.text, provider: "openai", modelId: model, voiceId: evidence.voice,
      channel: "openclaw-home-assistant" });
    const elapsed_ms = performance.now() - start;
    if (result.provider !== "openai" || typeof result.audioPath !== "string") throw new Error("Unexpected conversion result");
    const probe = await promisify(execFile)("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", result.audioPath], { timeout: 5000 });
    const sample = { requested_model: model, elapsed_ms: Math.round(elapsed_ms), provider: result.provider,
      format: result.outputFormat, audio_duration_s: Number(JSON.parse(probe.stdout).format.duration),
      audio_bytes: (await stat(result.audioPath)).size, generated_audio_path: result.audioPath };
    evidence.samples.push(sample);
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ ...sample, generated_audio_path: "native-generated-test-audio" }));
  } catch (error) {
    evidence.failure = { requested_model: model, error_class: error.name };
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    throw error;
  }
}
