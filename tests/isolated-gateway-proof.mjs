/** Opt-in framework proof. Starts only a disposable loopback Gateway and model fixture.
 * No live configuration, credentials, channels, provider calls or satellites.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = await mkdtemp(join(tmpdir(), "oc-voice-proof-"));
const workspace = join(root, "workspace");
await mkdir(workspace);
await writeFile(join(workspace, "SOUL.md"), "AGENT_FIXTURE_MEMORY: synthetic test agent, use voice_proof when asked.");
const calls = [];
const emissions = [];
const audioPath = join(root, "synthetic.mp3");
const encoded = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", "-ar", "44100", "-ac", "1", audioPath]);
assert.equal(encoded.status, 0, "ffmpeg synthetic audio fixture failed");
const audio = await readFile(audioPath);
const speechCalls = [];
const model = createServer(async (req, res) => {
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const body = Buffer.concat(parts).toString();
  if (req.url === "/v1/audio/transcriptions") {
    speechCalls.push({ kind: "stt", bytes: Buffer.byteLength(body) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: "SYNTHETIC_TRANSCRIPT_OK" })); return;
  }
  if (req.url === "/v1/audio/speech" || req.url.startsWith("/v1/text-to-speech/")) {
    speechCalls.push({ kind: "tts", request: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.write(audio.subarray(0, Math.floor(audio.length / 2)));
    await delay(200);
    res.end(audio.subarray(Math.floor(audio.length / 2))); return;
  }
  const data = JSON.parse(body);
  calls.push(data);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const chunk = (delta, finish_reason = null) => res.write("data: " + JSON.stringify({
    id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1,
    model: data.model, choices: [{ index: 0, delta, finish_reason }],
  }) + "\n\n");
  if (!data.messages.some((message) => message.role === "tool")) {
    const deferred = !data.tools?.some((tool) => tool.function?.name === "voice_proof");
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_fixture",
      type: "function", function: { name: deferred ? "tool_call" : "voice_proof",
        arguments: deferred ? JSON.stringify({ id: "voice_proof", args: {} }) : "{}" } }] });
    chunk({}, "tool_calls");
  } else {
    chunk({ role: "assistant", content: "Opening sentence. " });
    emissions.push({ part: "opening", at: Date.now() });
    await delay(1200);
    chunk({ content: "This is the ending." });
    emissions.push({ part: "ending", at: Date.now() });
    chunk({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((done) => model.listen(0, "127.0.0.1", done));
const modelPort = model.address().port;
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const gatewayPort = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const token = randomBytes(32).toString("hex");
const config = {
  logging: { file: join(root, "gateway.log") },
  gateway: { mode: "local", bind: "loopback", port: gatewayPort, auth: { mode: "token" } },
  agents: { defaults: { workspace, model: { primary: "voice-fixture/voice-default" },
    thinkingDefault: "high", bootstrapMaxChars: 20000, heartbeat: { every: "0m" } }, entries: { "fixture-voice": { workspace } } },
  models: { providers: { "voice-fixture": { api: "openai-completions",
    baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: "synthetic-fixture-not-a-real-key",
    models: ["voice-default", "voice-override"].map((id) => ({ id, name: id, reasoning: true,
      input: ["text"], contextWindow: 32768, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsReasoningEffort: true } })) },
    openai: { api: "openai-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`,
      apiKey: "synthetic-fixture-not-a-real-key", request: { allowPrivateNetwork: true }, models: [] } } },
  tts: { provider: "openai", providers: { openai: {
    apiKey: "synthetic-fixture-not-a-real-key", baseUrl: `http://127.0.0.1:${modelPort}/v1`,
    model: "fixture-tts", voice: "alloy" }, elevenlabs: {
      apiKey: "synthetic-fixture-not-a-real-key", baseUrl: `http://127.0.0.1:${modelPort}`,
      modelId: "eleven_flash_v2_5", voiceId: "abcdefghijklmnopqrst" } } },
  tools: { media: { audio: { enabled: true }, models: [{ provider: "openai", model: "fixture-transcribe", capabilities: ["audio"] }] } },
  update: { checkOnStart: false }, cron: { enabled: false },
  plugins: { allow: ["voice-proof", "openai", "elevenlabs"], slots: { memory: "none" }, load: { paths: [resolve("tests/fixtures/host-proof")] },
    entries: { "voice-proof": { enabled: true, hooks: { allowConversationAccess: true } } } },
};
const configPath = join(root, "openclaw.json");
await writeFile(configPath, JSON.stringify(config));
const env = {
  PATH: process.env.PATH, LANG: "C.UTF-8", HOME: process.env.HOME,
  OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_GATEWAY_TOKEN: token, VOICE_PROOF_TOKEN: token,
  VOICE_PROOF_AUDIO: audioPath,
  VOICE_PROOF_CLIENT_STATE: join(root, "voice-clients.json"),
  OPENCLAW_NO_RESPAWN: "1", OPENCLAW_SKIP_CHANNELS: "1",
};
const cli = process.env.OPENCLAW_PROOF_CLI ?? "openclaw";
const child = spawn(cli, ["gateway", "run", "--port", String(gatewayPort), "--bind", "loopback"], {
  env, detached: true, stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error("isolated gateway exited: " + log);
    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, { signal: AbortSignal.timeout(500) });
      if (response.status === 401) { ready = true; break; }
    } catch {}
    await delay(300);
  }
  assert.ok(ready, "isolated gateway did not register fixture route: " + log);
  const events = [];
  for (let turn = 0; turn < 2; turn++) {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ text: "Use voice_proof and answer with the fixture text.", seed: turn === 1 }), signal: AbortSignal.timeout(30000),
    });
    let partial = "";
    for await (const bytes of response.body) {
      partial += Buffer.from(bytes).toString();
      let end;
      while ((end = partial.indexOf("\n")) >= 0) {
        const event = JSON.parse(partial.slice(0, end));
        events.push({ ...event, at: Date.now(), turn });
        partial = partial.slice(end + 1);
      }
    }
  }
  const errors = events.filter((event) => event.type === "error");
  await writeFile(join(root, "proof.json"), JSON.stringify({ calls, emissions, events }, null, 2));
  assert.deepEqual(errors, [], "native dispatch error: " + JSON.stringify(errors));
  assert.ok(calls.length >= 3, "normal tool result and follow-up should reach model");
  assert.ok(calls.every((call) => call.model === "voice-override"), "per-run model override must beat agent default");
  assert.ok(calls.every((call) => call.reasoning_effort === "low"), "per-run thinking must beat high agent default");
  assert.ok(calls.some((call) => JSON.stringify(call.messages).includes("AGENT_FIXTURE_MEMORY")), "selected agent workspace missing");
  assert.ok(calls.some((call) => JSON.stringify(call.messages).includes("TOOL_PROOF_OK")), "normal plugin tool missing");
  assert.ok(events.some((event) => event.type === "partial" && event.at < emissions.find((part) => part.part === "ending").at), "opening text must arrive before fixture ending");
  for (const event of events.filter((event) => event.type === "done")) {
    assert.deepEqual(event.after, event.before, "voice turn must not mutate shared session inference preferences");
  }
  const speechResponse = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token },
    body: JSON.stringify({ kind: "speech" }), signal: AbortSignal.timeout(30000),
  });
  const speech = await speechResponse.json();
  await writeFile(join(root, "speech-proof.json"), JSON.stringify({ speech, speechCalls }, null, 2));
  assert.equal(speechResponse.status, 200, JSON.stringify(speech));
  assert.equal(speech.buffered.success, true, JSON.stringify(speech));
  assert.equal(speech.buffered.bytes, audio.length);
  assert.equal(speech.transcript.text, "SYNTHETIC_TRANSCRIPT_OK", JSON.stringify(speech));
  assert.equal(speech.progressive.success, true, JSON.stringify(speech.progressive));
  assert.equal(speech.progressive.bytes, audio.length);
  assert.ok(speech.progressive.chunks >= 2, "progressive host synthesis must preserve chunk delivery");
  const pairing = await (await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token },
    body: JSON.stringify({ kind: "pairing_issue" }),
  })).json();
  const client = await (await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof/pair`, {
    method: "POST", body: JSON.stringify({ pairing_code: pairing.pairing_code }),
  })).json();
  assert.ok(client.client_token && client.client_token !== token);
  const forbidden = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + client.client_token }, body: "{}",
  });
  assert.equal(forbidden.status, 401, "voice client cannot use owner-only proof control route");
  const haRoot = resolve("../home-assistant-openclaw-voice");
  const pairAudio = join(root, "paired-speech.mp3");
  const pairRun = await promisify(execFile)(join(haRoot, ".venv/bin/python"), [join(haRoot, "tests/native_pair_proof.py")], {
    env: { PATH: process.env.PATH, VOICE_PROOF_URL: `http://127.0.0.1:${gatewayPort}/plugins/voice-proof`,
      VOICE_PROOF_TOKEN: client.client_token, VOICE_PROOF_OUTPUT: pairAudio }, timeout: 25000,
  });
  const pair = JSON.parse(pairRun.stdout);
  assert.equal(pair.early_audio, true);
  assert.equal(pair.bytes, audio.length * 2, "both sentence audio buffers must reach HA exactly once");
  const decoded = spawnSync("ffmpeg", ["-loglevel", "error", "-i", pairAudio, "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"]);
  assert.equal(decoded.status, 0, "concatenated MP3 fixture must decode");
  pair.decoded_seconds = decoded.stdout.length / 48000;
  assert.ok(pair.decoded_seconds >= 0.7 && pair.decoded_seconds <= 1.0, "both synthetic tones must survive MP3 stitching");
  await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token },
    body: JSON.stringify({ kind: "revoke", client_id: client.client_id }),
  });
  const revoked = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof/tts`, {
    method: "POST", headers: { authorization: "Bearer " + client.client_token }, body: "{}",
  });
  assert.equal(revoked.status, 401, "revocation must reject further speech requests");
  pair.scoped_client = true; pair.revocation_tested = true;
  await writeFile(join(root, "pair-proof.json"), JSON.stringify(pair, null, 2));
  console.log(JSON.stringify({ status: "passed", node: process.version, root, calls: calls.length,
    models: calls.map((call) => call.model), reasoning: calls.map((call) => call.reasoning_effort),
    events: events.map(({ stack, ...event }) => event), emissions, speech, speechCalls, pair }, null, 2));
} catch (error) {
  await writeFile(join(root, "failed-proof.json"), JSON.stringify({ calls, emissions }, null, 2));
  console.error(String(error));
  console.error("Disposable proof artifacts: " + root);
  console.error(log.slice(-16000));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((done) => child.once("exit", done)), delay(5000)]);
  if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  model.closeAllConnections();
  await new Promise((done) => model.close(done));
}
