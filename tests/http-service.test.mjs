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

async function fixture(run) {
  let turns = 0, creations = 0;
  const sessions = new Map(), synthesis = [], receivedAudio = [];
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
    async runTurn({ text, emit }) {
      turns++;
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
  const service = new HomeAssistantService({ host, state, jobsOptions: { maxJobMs: 3000, waitMs: 1000 } });
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
  try { await run({ service, host, base, call, pair, synthesis, receivedAudio, turns: () => turns }); }
  finally { await service.stop(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

const control = (data) => ({ protocol_major: 1, profile_revision: "r1", ...data });
async function frames(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
}

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
