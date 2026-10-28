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
import { requestId } from "../src/request-identity.mjs";

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
    speechCalls.push({ kind: "stt", bytes: Buffer.byteLength(body), model: /name="model"\r?\n\r?\n([^\r\n]+)/.exec(body)?.[1] });
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
    const forbidden = data.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("denied-tool-proof"));
    const tool = forbidden ? "voice_forbidden" : "voice_proof";
    const deferred = forbidden || !data.tools?.some((tool) => tool.function?.name === "voice_proof");
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_fixture",
      type: "function", function: { name: deferred ? "tool_call" : tool,
        arguments: deferred ? JSON.stringify({ id: tool, args: {} }) : "{}" } }] });
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
    model: "fixture-default-tts", voice: "coral" }, elevenlabs: {
      apiKey: "synthetic-fixture-not-a-real-key", baseUrl: `http://127.0.0.1:${modelPort}`,
      modelId: "eleven_flash_v2_5", voiceId: "abcdefghijklmnopqrst" } } },
  tools: { deny: ["voice_forbidden"], media: { audio: { enabled: true }, models: [{ provider: "openai", model: "fixture-default-transcribe", capabilities: ["audio"] }] } },
  update: { checkOnStart: false }, cron: { enabled: false },
  plugins: { allow: ["voice-proof", "openai", "elevenlabs", "openclaw-home-assistant"], slots: { memory: "none" },
    load: { paths: [resolve("tests/fixtures/host-proof"), resolve(".")] },
    entries: { "voice-proof": { enabled: true, hooks: { allowConversationAccess: true } },
      "openclaw-home-assistant": { enabled: true, hooks: { allowConversationAccess: true },
        config: { agentId: "fixture-voice", conversation: { model: "voice-fixture/voice-override", thinking: "low", fast: false },
          stt: { provider: "openai", model: "fixture-transcribe" }, tts: { provider: "openai", model: "fixture-tts", voice: "alloy" } } } } },
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
  const hostProbeResponse = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ kind: "host_sessions" }),
    signal: AbortSignal.timeout(10000),
  });
  const hostProbe = await hostProbeResponse.json();
  assert.equal(hostProbeResponse.status, 200, JSON.stringify(hostProbe));
  assert.deepEqual(hostProbe.target, hostProbe.repeated, "ordinary host session reservation must be idempotent");
  assert.ok(hostProbe.target.sessionId && hostProbe.target.lifecycleRevision);
  assert.deepEqual(hostProbe.model, { provider: "voice-fixture", id: "voice-override" });
  const hostTurnResponse = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ kind: "host_turn" }),
    signal: AbortSignal.timeout(15000),
  });
  const hostTurn = await hostTurnResponse.json();
  assert.equal(hostTurnResponse.status, 200, JSON.stringify(hostTurn));
  assert.equal(hostTurn.result.result.text, "Opening sentence. This is the ending.");
  assert.equal(hostTurn.projected.filter((event) => event.type === "text_delta").map((event) => event.text).join(""), "Opening sentence. This is the ending.");
  assert.ok(hostTurn.projected.some((event) => event.type === "model" && event.model === "voice-override"));
  assert.deepEqual(hostTurn.before, hostTurn.after, "native work admission must not retarget reserved history");
  assert.ok(hostTurn.projected.some((event) => event.type === "text_delta" && event.at < emissions.find((part) => part.part === "ending").at));
  const baselineEmissionCount = emissions.length;
  const hostSttResponse = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ kind: "host_stt" }),
    signal: AbortSignal.timeout(10000),
  });
  const hostStt = await hostSttResponse.json();
  assert.equal(hostSttResponse.status, 200, JSON.stringify(hostStt));
  assert.equal(hostStt.transcript.text, "SYNTHETIC_TRANSCRIPT_OK");
  assert.equal(hostStt.empty.no_speech, true);
  assert.deepEqual(hostStt.remaining, []);
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
  assert.ok(events.some((event) => event.type === "partial" && event.at < emissions.slice(baselineEmissionCount).find((part) => part.part === "ending").at), "opening text must arrive before fixture ending");
  for (const event of events.filter((event) => event.type === "done")) {
    assert.deepEqual(event.after, event.before, "voice turn must not mutate shared session inference preferences");
  }
  const gatewayCall = async (method, params = {}) => {
    const result = await promisify(execFile)(cli, ["gateway", "call", method, "--params", JSON.stringify(params), "--json"], { env, timeout: 20000 });
    const value = JSON.parse(result.stdout);
    return value.result ?? value;
  };
  const productionStatus = await gatewayCall("openclaw_home_assistant.status");
  assert.equal(productionStatus.ready, true, JSON.stringify(productionStatus));
  const issued = await gatewayCall("openclaw_home_assistant.pairing.issue", { label: "Native HA integration proof" });
  const productionBase = `http://127.0.0.1:${gatewayPort}/plugins/openclaw-home-assistant/v1`;
  const productionClientResponse = await fetch(productionBase + "/pair", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairing_code: issued.pairing_code }),
  });
  const productionClient = await productionClientResponse.json();
  assert.equal(productionClientResponse.status, 200);
  assert.ok(productionClient.client_token);
  const productionHeaders = { authorization: "Bearer " + productionClient.client_token, "content-type": "application/json" };
  const control = (value) => ({ protocol_major: 1, profile_revision: productionClient.capabilities.profile_revision, ...value });
  const conversationResponse = await fetch(productionBase + "/conversations", { method: "POST", headers: productionHeaders,
    body: JSON.stringify(control({ ha_conversation_id: "native-ha-conversation", mode: "per_conversation" })) });
  const conversation = await conversationResponse.json();
  assert.equal(conversationResponse.status, 200, JSON.stringify(conversation));
  const turnRequest = control({ request_id: requestId(), conversation_handle: conversation.conversation_handle,
    text: "Use voice_proof and answer with the fixture text." });
  const nativeCallsBefore = calls.length;
  const productionTurnResponse = await fetch(productionBase + "/turns", { method: "POST", headers: productionHeaders,
    body: JSON.stringify(turnRequest), signal: AbortSignal.timeout(20000) });
  const productionFrames = (await productionTurnResponse.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(productionTurnResponse.status, 200, JSON.stringify(productionFrames));
  assert.equal(productionFrames.at(-1).type, "done", JSON.stringify(productionFrames));
  assert.equal(productionFrames.filter((frame) => frame.type === "text_delta").map((frame) => frame.text).join(""), "Opening sentence. This is the ending.");
  const productionRetry = await fetch(productionBase + "/turns", { method: "POST", headers: productionHeaders,
    body: JSON.stringify(turnRequest), signal: AbortSignal.timeout(10000) });
  assert.deepEqual((await productionRetry.text()).trim().split("\n").map((line) => JSON.parse(line)), productionFrames);
  assert.equal(calls.length, nativeCallsBefore + 2, "retry must not invoke model/tools again");
  const speechResponse = await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token },
    body: JSON.stringify({ kind: "speech" }), signal: AbortSignal.timeout(30000),
  });
  const speech = await speechResponse.json();
  await writeFile(join(root, "speech-proof.json"), JSON.stringify({ speech, speechCalls }, null, 2));
  assert.equal(speechResponse.status, 200, JSON.stringify(speech));
  assert.equal(speech.buffered.success, true, JSON.stringify(speech));
  assert.equal(speech.buffered.bytes, audio.length);
  assert.deepEqual(speech.genericSpeech, { success: true, provider: "openai", model: "fixture-tts", voice: "alloy" });
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
  const pairAudio = join(root, "paired-speech.wav");
  const pairRun = await promisify(execFile)(join(haRoot, ".venv/bin/python"), [join(haRoot, "tests/native_pair_proof.py")], {
    env: { PATH: process.env.PATH, VOICE_PROOF_URL: productionBase,
      VOICE_PROOF_TOKEN: productionClient.client_token, VOICE_PROOF_REVISION: productionClient.capabilities.profile_revision,
      VOICE_PROOF_OUTPUT: pairAudio }, timeout: 25000,
  });
  const pair = JSON.parse(pairRun.stdout);
  assert.equal(pair.early_audio, true);
  assert.ok(pair.bytes > 44, "the canonical WAV must include decoded sample data");
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
  const policyConversation = await (await fetch(productionBase + "/conversations", {
    method: "POST", headers: productionHeaders, body: JSON.stringify(control({ ha_conversation_id: "policy-proof", mode: "per_conversation" })),
  })).json();
  const deniedTurn = await fetch(productionBase + "/turns", { method: "POST", headers: productionHeaders,
    body: JSON.stringify(control({ request_id: requestId(), conversation_handle: policyConversation.conversation_handle,
      text: "denied-tool-proof: try the forbidden fixture tool" })), signal: AbortSignal.timeout(20000) });
  assert.equal(deniedTurn.status, 200);
  const deniedFrames = (await deniedTurn.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(deniedFrames.at(-1).type, "done");
  const fixtureRequest = async (kind) => await (await fetch(`http://127.0.0.1:${gatewayPort}/plugins/voice-proof`, {
    method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ kind }), signal: AbortSignal.timeout(10000),
  })).json();
  const policyProof = await fixtureRequest("policy_status");
  assert.equal(policyProof.forbiddenExecutions, 0);
  const deniedCalls = calls.filter((call) => call.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("denied-tool-proof")));
  assert.ok(deniedCalls.some((call) => call.messages.some((message) => message.role === "tool")), "denied tool call must receive a native error result");
  assert.ok(!JSON.stringify(deniedCalls).includes("FORBIDDEN_EXECUTED"));
  const lockBaseline = calls.length;
  const lockedProof = await fixtureRequest("host_locked_session");
  assert.equal(lockedProof.code, "session_model_locked", JSON.stringify(lockedProof));
  assert.equal(lockedProof.locked, true);
  assert.equal(calls.length, lockBaseline, "locked session cannot dispatch a model request");
  const scopeRun = await promisify(execFile)(process.execPath, [resolve("tests/gateway-scope-proof.mjs")], {
    env: { ...env, OPENCLAW_STATE_DIR: join(root, "scope-client"), VOICE_PROOF_GATEWAY_URL: `ws://127.0.0.1:${gatewayPort}` }, timeout: 15000,
  });
  const scopeProof = JSON.parse(scopeRun.stdout);
  assert.equal(scopeProof.admin_methods_denied, 5);
  const fullIssued = await gatewayCall("openclaw_home_assistant.pairing.issue", { label: "Full native HA pipeline proof" });
  const emissionBaseline = emissions.length;
  const fullRun = await promisify(execFile)(join(haRoot, ".venv/bin/python"), [join(haRoot, "tests/native_pipeline_proof.py")], {
    env: { PATH: process.env.PATH, VOICE_PROOF_URL: productionBase, VOICE_PROOF_PAIRING_CODE: fullIssued.pairing_code },
    timeout: 50000,
  });
  const nativePipeline = JSON.parse(fullRun.stdout);
  assert.equal(nativePipeline.status, "passed");
  const queryEnding = emissions.slice(emissionBaseline).find((item) => item.part === "ending");
  assert.ok(nativePipeline.first_audio < queryEnding.at, "native HA playback bytes must precede final model text");
  assert.ok(speechCalls.some((call) => call.kind === "stt" && call.model === "fixture-transcribe"), "explicit profile STT model must beat native default");
  assert.ok(speechCalls.some((call) => call.kind === "tts" && call.request.model === "fixture-tts" && call.request.voice === "alloy"), "profile TTS model/voice must beat native defaults");
  nativePipeline.early_audio = true;
  await writeFile(join(root, "native-pipeline-proof.json"), JSON.stringify(nativePipeline, null, 2));
  pair.production_plugin = true;
  await writeFile(join(root, "pair-proof.json"), JSON.stringify(pair, null, 2));
  console.log(JSON.stringify({ status: "passed", node: process.version, root, production: { ready: productionStatus.ready,
    normal_turn: true, retry_without_execution: true, paired_via_admin_rpc: true }, hostProbe, hostTurn, hostStt, calls: calls.length,
    models: calls.map((call) => call.model), reasoning: calls.map((call) => call.reasoning_effort),
    events: events.map(({ stack, ...event }) => event), emissions, speech, speechCalls, pair, nativePipeline, scopeProof, policyProof, lockedProof }, null, 2));
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
