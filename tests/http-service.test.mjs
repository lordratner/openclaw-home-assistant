import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HomeAssistantService, HTTP_PREFIX } from "../src/http-service.mjs";
import { StateFile } from "../src/state-file.mjs";
import { requestId } from "../src/request-identity.mjs";
import { AssistTools, ASSIST_BINDING } from "../src/assist-tools.mjs";

async function fixture(run) {
  let turns = 0, creations = 0;
  const sessions = new Map(), synthesis = [], receivedAudio = [], inferences = [];
  const wave = Buffer.alloc(44 + 14400);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
  const host = {
    profile: { id: "default", agentId: "selected-home-agent", revision: "r1", languages: ["en"], defaultLanguage: "en" },
    async createSession({ agentId, idempotencyKey }) {
      const key = `agent:${agentId}:${idempotencyKey}`;
      if (!sessions.has(key)) sessions.set(key, { key, sessionId: String(++creations), lifecycleRevision: "r1" });
      return sessions.get(key);
    },
    async inspectSession(_agent, key) { return sessions.get(key); },
    validateConversation(value) { if (value.model === "denied") throw new Error("model_not_allowed"); return value; },
    assertSessionModel() {},
    async runTurn({ text, emit, inference }) {
      turns++;
      inferences.push(inference);
      await emit({ type: "text_delta", message_id: 0, text: "Reply: " + text });
      return { result: { text: "Reply: " + text, continue_conversation: false }, terminal: { continue_conversation: false } };
    },
    speechHost() { return {
      stream: async () => ({ success: false, attempts: [{ outcome: "skipped", reasonCode: "unsupported_for_streaming" }] }),
      buffer: async (text) => { synthesis.push(text); return { success: true, outputFormat: "wav", fileExtension: ".wav", audioBuffer: wave }; },
    }; },
    async transcribe(source, { language, signal }) {
      assert.equal(language, "en");
      for await (const bytes of source) { signal.throwIfAborted(); receivedAudio.push(bytes); }
      return { text: "Final transcript", no_speech: false };
    },
    close() {},
  };
  const state = new StateFile(join(await mkdtemp(join(tmpdir(), "ha-http-")), "state.json"));
  let service = new HomeAssistantService({ host, state, jobsOptions: { maxJobMs: 3000, waitMs: 1000 } });
  const replaceProfile = async (revision) => {
    await service.stop();
    host.profile = { ...host.profile, revision };
    service = new HomeAssistantService({ host, state, jobsOptions: { maxJobMs: 3000, waitMs: 1000 } });
  };
  const server = createServer(async (request, response) => {
    try { if (!await service.handle(request, response)) { response.writeHead(404); response.end(); } }
    catch { response.destroy(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}${HTTP_PREFIX}`;
  const call = (path, { token, data, method = data === undefined ? "GET" : "POST" } = {}) => fetch(base + path, {
    method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(4000),
  });
  const pair = async () => {
    const code = await service.clients.issue("Synthetic HA");
    const response = await call("/pair", { data: { pairing_code: code.pairing_code } });
    assert.equal(response.status, 200);
    return response.json();
  };
  try { await run({ service, host, base, call, pair, synthesis, receivedAudio, inferences, replaceProfile, turns: () => turns }); }
  finally { await service.stop(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

const control = (data) => ({ protocol_major: 1, profile_revision: "r1", ...data });

test("unavailable optional TTS is rejected before upload while pairing and text conversation remain usable", async () => {
  await fixture(async ({ host, call, pair }) => {
    host.stageCapabilities = () => ({ conversation: { available: null }, stt: { available: null },
      tts: { available: false, reason: "audio_normalizer_unavailable" } });
    const client = await pair();
    const rejected = await call("/tts", { token: client.client_token, data: {} });
    assert.equal((await rejected.json()).code, "audio_normalizer_unavailable");
    const opened = await call("/conversations", { token: client.client_token,
      data: control({ ha_conversation_id: "text-with-native-ha-speech", mode: "persistent" }) });
    assert.equal(opened.status, 200);
    const { conversation_handle } = await opened.json();
    const reply = await call("/turns", { token: client.client_token,
      data: control({ request_id: requestId(), conversation_handle, text: "Text still works" }) });
    assert.equal(reply.status, 200);
    const events = (await reply.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.at(-1).type, "done");
  });
});

test("pre-admission HTTP errors retain route/status/reason without body or credentials", async () => {
  await fixture(async ({ service, call, pair }) => {
    const rejected = await call("/turns", { data: { text: "PRIVATE_USER_PROMPT" } });
    assert.equal(rejected.status, 401);
    let failure = service.diagnostics.snapshot().failures.find((v) => v.operation === "turns");
    assert.equal(failure.http_status, 401);
    assert.equal(failure.category, "authentication");
    assert.equal((await service.jobs.diagnostics()).length, 0);
    const client = await pair();
    const bad = await call("/conversations", { token: client.client_token,
      data: control({ ha_conversation_id: "PRIVATE_NATIVE_ID", mode: "wrong" }) });
    assert.equal(bad.status, 400);
    failure = service.diagnostics.snapshot().failures.find((v) => v.operation === "conversations");
    assert.equal(failure.http_status, 400);
    const serialized = JSON.stringify(service.diagnostics.snapshot());
    for (const privateValue of ["PRIVATE_USER_PROMPT", "PRIVATE_NATIVE_ID", client.client_token]) assert.ok(!serialized.includes(privateValue));
  });
});

test("profile recovery reopens a sticky ID, but never redispatches an admitted request", async () => {
  await fixture(async ({ call, pair, replaceProfile, turns }) => {
    const { client_token: token } = await pair();
    const data = control({ ha_conversation_id: "native-sticky-id", mode: "persistent" });
    const first = await (await call("/conversations", { token, data })).json();
    const accepted = control({ request_id: requestId(), conversation_handle: first.conversation_handle, text: "one action" });
    const original = await call("/turns", { token, data: accepted });
    const originalJob = original.headers.get("x-openclaw-job-id");
    await original.text();
    assert.equal(turns(), 1);
    await replaceProfile("clyde");
    const rejected = { ...accepted, request_id: requestId(), text: "next action" };
    const stale = await call("/turns", { token, data: rejected });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "profile_changed");
    assert.equal(turns(), 1);
    const fresh = await (await call("/conversations", { token, data: { ...data, profile_revision: "clyde" } })).json();
    assert.notEqual(fresh.conversation_handle, first.conversation_handle);
    const repaired = { ...rejected, profile_revision: "clyde", conversation_handle: fresh.conversation_handle };
    const response = await call("/turns", { token, data: repaired });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(turns(), 2);
    const replay = await call("/turns", { token, data: accepted });
    // A replaced process owner has durable receipts/results, not its old
    // in-memory output frames. The explicit recovery path must keep that job.
    assert.equal(replay.status, 409);
    const lostFrames = await replay.json();
    assert.equal(lostFrames.code, "replay_unavailable");
    assert.equal(lostFrames.job_id, originalJob);
    const recovered = await (await call(`/jobs/${originalJob}`, { token })).json();
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result_recoverable, true);
    const ambiguous = await call("/turns", { token, data: { ...repaired, request_id: accepted.request_id } });
    assert.equal(ambiguous.status, 409);
    assert.equal((await ambiguous.json()).code, "request_conflict");
    assert.equal(turns(), 2);
  });
});

test("native Assist tool results are authenticated and bound to their originating job", async () => {
  await fixture(async ({ host, call, pair }) => {
    host.assist = new AssistTools({ timeoutMs: 2000 });
    host.runTurn = async (params) => {
      const { target, assist: bundle, ...rest } = params;
      const owner = { ...rest, bundle, agentId: host.profile.agentId, sessionKey: target.key, sessionId: target.sessionId };
      const lease = host.assist.open(owner);
      try {
        const tool = host.assist.factory({ ...owner, toolBindings: { [ASSIST_BINDING]: lease.token } });
        const result = await tool.execute("test", { request: { tool_name: "intent__HassTurnOn", tool_args: {} } });
        await params.emit({ type: "text_delta", message_id: 0, text: result.content[0].text });
        return { result: { text: result.content[0].text }, terminal: {} };
      } finally { lease.close(); }
    };
    const client = await pair(), other = await pair(), token = client.client_token;
    const binding = await (await call("/conversations", { token, data: control({ ha_conversation_id: "assist", mode: "per_conversation" }) })).json();
    const input = control({ request_id: requestId(), conversation_handle: binding.conversation_handle, text: "Control fixture",
      assist: { prompt: "PRIVATE_NATIVE_HA_CONTEXT", tools: [{ name: "intent__HassTurnOn", description: "On", parameters: { type: "object" } }] } });
    const response = await call("/turns", { token, data: input });
    assert.equal(response.status, 200);
    let pending = "", count = 0;
    for await (const chunk of response.body) {
      pending += Buffer.from(chunk).toString();
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const event = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
        if (event.type === "tool_call") {
          count++;
          const path = `/jobs/${event.job_id}/tool-results`;
          const data = { call_id: event.call_id, data: { native: "ok" }, error: false };
          assert.equal((await call(path, { token: other.client_token, data })).status, 404);
          assert.equal((await call(path, { token, data: { ...data, call_id: "wrong" } })).status, 400);
          assert.equal((await call(`/jobs/${event.job_id}/tool-claim`, { token, data: { call_id: event.call_id } })).status, 200);
          assert.equal((await call(path, { token, data })).status, 200);
        }
      }
    }
    assert.equal(count, 1);
    // Replayed events do not invoke the OpenClaw tool again.
    const replay = await frames(await call("/turns", { token, data: input }));
    assert.equal(replay.filter((event) => event.type === "tool_call").length, 1);
    assert.equal(replay.at(-1).type, "done");
  });
});

async function frames(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
}

test("hot settings preserve handles, snapshot retries and omit content from diagnostics", async () => {
  await fixture(async ({ service, call, pair, inferences }) => {
    const client = await pair(), token = client.client_token;
    const binding = await (await call("/conversations", { token, data: control({ ha_conversation_id: "hot", mode: "persistent" }) })).json();
    const first = control({ request_id: requestId(), conversation_handle: binding.conversation_handle, text: "PRIVATE_TEST_PROMPT" });
    const original = await frames(await call("/turns", { token, data: first }));
    const settings = await service.inference.get();
    await service.updateInference({ expected_revision: settings.revision, patch: { model: "next/model", thinking: "medium", fast: true } });
    assert.deepEqual(await frames(await call("/turns", { token, data: first })), original);
    await frames(await call("/turns", { token, data: { ...first, request_id: requestId(), text: "second" } }));
    assert.equal(inferences.length, 2);
    assert.deepEqual(inferences[0].conversation, {});
    assert.deepEqual(inferences[1].conversation, { model: "next/model", thinking: "medium", fast: true });
    assert.equal(service.capabilities().profile_revision, binding.profile_revision);
    const diagnostic = await service.jobs.diagnostics();
    assert.equal(diagnostic.length, 2);
    const originalDiagnostic = diagnostic.find((job) => job.job_id === original[0].job_id);
    assert.equal(originalDiagnostic.inference?.revision, settings.revision, "receipt must retain its admission settings revision");
    assert.deepEqual(originalDiagnostic.inference.conversation, {});
    assert.ok(diagnostic.every((job) => Number.isFinite(job.timing.stages_ms.request_received)), "HTTP timing must survive the public admission wrapper");
    const originalStatus = await (await call(`/jobs/${original[0].job_id}`, { token })).json();
    assert.deepEqual(originalStatus.inference, originalDiagnostic.inference);
    assert.ok(diagnostic.every((job) => job.timing.stages_ms.job_completed >= job.timing.stages_ms.first_text));
    assert.equal(JSON.stringify(diagnostic).includes("PRIVATE_TEST_PROMPT"), false);
    assert.equal((await call("/inference", { token, data: { fast: true } })).status, 404);
  });
});

test("owner preference update checks the currently bound persistent target before committing", async () => {
  await fixture(async ({ service, host, call, pair }) => {
    const client = await pair(), token = client.client_token;
    await call("/conversations", { token, data: control({ ha_conversation_id: "locked", mode: "persistent" }) });
    const before = await service.inference.get();
    let checked;
    host.assertSessionModel = (key, conversation) => {
      checked = { key, conversation };
      throw new Error("session_model_locked");
    };
    await assert.rejects(service.updateInference({ expected_revision: before.revision, patch: { model: "next/model" } }), /session_model_locked/);
    assert.ok(checked.key.startsWith("agent:selected-home-agent:"));
    assert.equal(checked.conversation.model, "next/model");
    assert.deepEqual(await service.inference.get(), before);
  });
});

test("pairing, capabilities and closed input never accept client model or session target authority", async () => {
  await fixture(async ({ call, pair, turns }) => {
    assert.equal((await call("/capabilities")).status, 401);
    const client = await pair();
    const token = client.client_token;
    assert.equal(client.capabilities.agent.id, "selected-home-agent");
    assert.equal((await call("/capabilities", { token })).status, 200);
    assert.equal((await call("/pairing/issue", { token, data: {} })).status, 404);
    for (const extra of [{ session_key: "agent:other:private" }, { agent_id: "other" }, { model: "other/model" }]) {
      const denied = await call("/conversations", { token, data: control({ ha_conversation_id: "ha-1", mode: "persistent", ...extra }) });
      assert.equal(denied.status, 400);
    }
    assert.equal(turns(), 0);
  });
});

test("lost turn acknowledgment recovers the existing job even after the HA handle is closed", async () => {
  await fixture(async ({ call, pair, service, turns }) => {
    const client = await pair(), token = client.client_token;
    const conversation = await (await call("/conversations", { token, data: control({ ha_conversation_id: "ha-1", mode: "per_conversation" }) })).json();
    const input = control({ request_id: requestId(), conversation_handle: conversation.conversation_handle, text: "Test" });
    const original = await frames(await call("/turns", { token, data: input }));
    assert.equal(original.at(-1).type, "done");
    await service.bindings.close(client.client_id, conversation.conversation_handle);
    const retry = await frames(await call("/turns", { token, data: input }));
    assert.deepEqual(retry, original);
    assert.equal(turns(), 1);
    const conflict = await call("/turns", { token, data: { ...input, text: "Different" } });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "request_conflict");
    const other = await pair();
    const id = original[0].job_id;
    assert.equal((await call(`/jobs/${id}`, { token: other.client_token })).status, 404);
    assert.equal((await call(`/jobs/${id}/cancel`, { token: other.client_token, data: {} })).status, 404);
    assert.equal((await (await call(`/jobs/${id}`, { token })).json()).result.text, "Reply: Test");
  });
});

test("duplex TTS delivers first sentence audio while the text upload remains unfinished", async () => {
  await fixture(async ({ pair, base, synthesis }) => {
    const client = await pair();
    const outgoing = httpRequest(base + "/tts", { method: "POST", headers: {
      Authorization: "Bearer " + client.client_token, "Content-Type": "application/x-ndjson",
    } });
    const responsePromise = once(outgoing, "response");
    const send = (value) => outgoing.write(JSON.stringify(value) + "\n");
    const id = requestId();
    send(control({ type: "start", request_id: id, language: "en" }));
    send({ type: "text", sequence: 1, text: "Opening sentence." });
    const [response] = await responsePromise;
    assert.equal(response.statusCode, 200);
    let pending = "", endingSent = false;
    const received = [];
    for await (const chunk of response) {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const frame = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        received.push(frame);
        if (frame.type === "audio_chunk" && !endingSent) {
          assert.equal(synthesis.length, 1);
          endingSent = true;
          send({ type: "text", sequence: 2, text: " The ending." });
          send({ type: "end", sequence: 3 });
          outgoing.end();
        }
      }
    }
    assert.equal(endingSent, true);
    assert.equal(received.at(-1).type, "done");
    assert.equal(received.at(-1).segments, 1);
    assert.equal(received.at(-1).provider_segments, 2);
    assert.ok(received.filter((frame) => frame.type === "audio_chunk").length >= 2);
    // A duplicate unfinished upload is never accepted as a second synthesis.
    const duplicate = await fetch(base + "/tts", { method: "POST", headers: { Authorization: "Bearer " + client.client_token },
      body: JSON.stringify(control({ type: "start", request_id: id, language: "en" })) + "\n" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, "upload_already_admitted");
    assert.equal(synthesis.length, 2);
  });
});

test("STT accepts bounded ordered PCM and never starts an agent turn", async () => {
  await fixture(async ({ pair, base, receivedAudio, turns }) => {
    const client = await pair();
    const data = [
      control({ type: "start", request_id: requestId(), language: "en", encoding: "pcm_s16le", sample_rate: 16000, channels: 1 }),
      { type: "audio", sequence: 1, audio: Buffer.from([0, 1, 2, 3]).toString("base64") },
      { type: "end", sequence: 2 },
    ];
    const response = await fetch(base + "/stt", { method: "POST", headers: { Authorization: "Bearer " + client.client_token },
      body: data.map((frame) => JSON.stringify(frame) + "\n").join("") });
    const output = await frames(response);
    assert.equal(output.find((frame) => frame.type === "transcript").text, "Final transcript");
    assert.equal(output.at(-1).type, "done");
    assert.deepEqual(Buffer.concat(receivedAudio), Buffer.from([0, 1, 2, 3]));
    assert.equal(turns(), 0);
  });
});

test("STT forwards audio before upload ends and reports realtime only on the final transcript", async () => {
  await fixture(async ({ pair, base, service, turns }) => {
    let observed;
    const audioObserved = new Promise((resolve) => { observed = resolve; });
    const chunks = [];
    service.host.transcribe = async (input) => {
      for await (const chunk of input) { chunks.push(chunk); observed(); }
      return { text: "Complete final transcript", no_speech: false, mode: "realtime" };
    };
    const client = await pair();
    let outgoing;
    const responsePromise = new Promise((resolve, reject) => {
      outgoing = httpRequest(base + "/stt", { method: "POST",
        headers: { Authorization: "Bearer " + client.client_token, "Content-Type": "application/x-ndjson" } }, resolve);
      outgoing.on("error", reject);
    });
    const send = (frame) => outgoing.write(JSON.stringify(frame) + "\n");
    send(control({ type: "start", request_id: requestId(), language: "en", encoding: "pcm_s16le", sample_rate: 16000, channels: 1 }));
    send({ type: "audio", sequence: 1, audio: Buffer.alloc(320).toString("base64") });
    const response = await responsePromise;
    const output = (async () => { let text = ""; for await (const chunk of response) text += chunk;
      return text.trim().split("\n").map(JSON.parse); })();
    await Promise.race([audioObserved, output.then(() => { throw Error("request ended before audio streamed"); })]);
    assert.equal(outgoing.writableEnded, false);
    send({ type: "audio", sequence: 2, audio: Buffer.alloc(80).toString("base64") });
    send({ type: "end", sequence: 3 }); outgoing.end();
    const result = await output;
    const transcripts = result.filter((frame) => frame.type === "transcript");
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].final, true);
    assert.equal(transcripts[0].mode, "realtime");
    assert.deepEqual(chunks.map((chunk) => chunk.length), [320, 80]);
    assert.equal(turns(), 0);
  });
});

test("revoked clients cannot use further endpoints and active response authority is fenced", async () => {
  await fixture(async ({ pair, call, service }) => {
    const client = await pair();
    const lease = await service.clients.authorize(client.client_token, "tts");
    assert.equal(await service.clients.revoke(client.client_id), true);
    assert.equal(lease.signal.aborted, true);
    assert.throws(() => lease.assertCurrent());
    lease.release();
    assert.equal((await call("/capabilities", { token: client.client_token })).status, 401);
  });
});
