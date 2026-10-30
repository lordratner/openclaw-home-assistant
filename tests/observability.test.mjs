import test from "node:test";
import assert from "node:assert/strict";
import { Diagnostics, failureSummary, annotateFailure, safeFields } from "../src/observability.mjs";
import cases from "./fixtures/logging-contract-cases.json" with { type: "json" };

test("paired diagnostic classification contract is consistent across common failure kinds", () => {
  for (const value of cases) {
    const error = Object.assign(new Error("PRIVATE_ERROR"), { code: value.code, status: value.status, errorCode: value.provider_code });
    assert.equal(failureSummary(error).category, value.category, JSON.stringify(value));
  }
  const large = new AggregateError(Array.from({ length: 20 }, () => new AggregateError(
    Array.from({ length: 4 }, () => Object.assign(new Error("PRIVATE"), { status: 401 })), "PRIVATE")), "PRIVATE");
  assert.ok(Buffer.byteLength(JSON.stringify(failureSummary(large))) <= 1024);
  assert.equal(failureSummary(large).truncated, true);
  const closed = failureSummary(Object.assign(new Error("PRIVATE"), { closeCode: 1006 }));
  assert.equal(closed.transport_code, 1006);
  assert.equal(closed.category, "transport");
});

test("provider failures retain useful classifications without raw text or credentials", () => {
  const secret = "PRIVATE_AUDIO_TEXT_TOKEN_https://private.example";
  const auth = Object.assign(new Error(secret), { status: 401, code: secret });
  const safe = failureSummary(annotateFailure(auth, { stage: "stt_transcription", provider: "elevenlabs" }));
  assert.equal(safe.http_status, 401);
  assert.equal(safe.category, "authentication");
  assert.equal(safe.stage, "stt_transcription");
  assert.equal(safe.provider, "elevenlabs");
  assert.equal(safe.reason, "unknown_error");
  assert.ok(!JSON.stringify(safe).includes(secret));
  const noSpeech = failureSummary(new Error("insufficient_audio_activity " + secret));
  assert.equal(noSpeech.provider_code, "insufficient_audio_activity");
  assert.equal(noSpeech.category, "no_speech");
  assert.equal(noSpeech.classification_source, "known_token");
  assert.match(noSpeech.error_fingerprint, /^[a-f0-9]{16}$/);
  const grouped = failureSummary(new AggregateError([auth, new Error(secret)], secret));
  assert.equal(grouped.failure_count, 2);
  assert.equal(grouped.category, "authentication");
  assert.ok(!JSON.stringify(grouped).includes(secret));
  assert.deepEqual(safeFields({ message: secret, stack: secret, url: secret, reason: secret, causes: [{ token: secret }] }), { causes: [{}] });
  assert.equal(failureSummary({ get code() { throw new Error(secret); } }).reason, "unknown_error");
});

test("concurrent spans correlate requests without cross-talk and logs cannot break work", async () => {
  const lines = [], diag = new Diagnostics({ logger: { debug: (v) => lines.push(v), info: () => { throw new Error("logger failed"); } } });
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  await Promise.all(ids.map((request_id) => diag.trace("http", "request", async (span) => {
    span.phase("request_received");
    await new Promise((r) => setTimeout(r, 1));
    await diag.trace("storage", "transaction", async () => { assert.equal(diag.current().fields.request_id, request_id); });
  }, { request_id, trace_id: request_id, token: "PRIVATE" })));
  const events = diag.snapshot().recent;
  for (const id of ids) assert.ok(events.filter((e) => e.request_id === id).every((e) => e.trace_id === id));
  assert.equal(diag.current(), null);
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
  assert.ok(lines.length > 0);
});

test("operation/failure retention and repeated native log volume are bounded", async () => {
  const lines = [], diag = new Diagnostics({ limit: 5, failureLimit: 3, logger: { warn: (v) => lines.push(v) } });
  for (let i = 0; i < 100; i++) await assert.rejects(diag.trace("stt", "transcribe", () => { throw new Error("PRIVATE"); }));
  const data = diag.snapshot();
  assert.equal(data.recent.length, 5);
  assert.equal(data.failures.length, 3);
  assert.equal(lines.length, 9);
  data.failures[0].reason = "PRIVATE";
  assert.ok(!JSON.stringify(diag.snapshot()).includes("PRIVATE"));
  const sink = new Diagnostics({ logger: { info: async () => { throw new Error("sink failed"); } } });
  sink.start("stt", "job").phase("request_received");
  await new Promise((r) => setTimeout(r, 1));
});

test("diagnostic operation history remains readable when metadata-backed sections fail", async () => {
  const diagnostics = new Diagnostics();
  const result = await diagnostics.collect({ inference: async () => ({ effective: "configured" }),
    jobs: async () => { throw Object.assign(new Error("PRIVATE_STORAGE_PATH"), { code: "EIO" }); } });
  assert.deepEqual(result.unavailable_sections, ["jobs"]);
  assert.equal(result.values.inference.effective, "configured");
  assert.equal(diagnostics.snapshot().failures[0].system_code, "EIO");
  assert.ok(!JSON.stringify(diagnostics.snapshot()).includes("PRIVATE_STORAGE_PATH"));
});

test("successful native fallback retains failed attempts and actual provider without retrying or logging payload", async () => {
  const diagnostics = new Diagnostics();
  let calls = 0;
  const result = { success: true, provider: "openai", audioBuffer: Buffer.from("PRIVATE_AUDIO"),
    attempts: [{ outcome: "failed", provider: "elevenlabs", status: 503, error: "PRIVATE_PROVIDER_TOKEN" },
      { outcome: "succeeded", provider: "openai" }] };
  const host = diagnostics.instrument({ async buffer() { calls++; return result; } }, "speech_provider", ["buffer"]);
  assert.equal(await host.buffer("PRIVATE_TEXT"), result);
  assert.equal(calls, 1);
  const data = diagnostics.snapshot();
  assert.ok(data.failures.some((e) => e.provider === "elevenlabs" && e.http_status === 503));
  assert.ok(data.recent.some((e) => e.phase === "provider_fallback" && e.provider === "openai"));
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
});
