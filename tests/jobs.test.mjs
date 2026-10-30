import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Jobs } from "../src/jobs.mjs";
import { StateFile } from "../src/state-file.mjs";
import { requestId, requestTime, fingerprint } from "../src/request-identity.mjs";
import { Diagnostics, annotateFailure, failureSummary } from "../src/observability.mjs";

const collect = async (source) => { const values = []; for await (const value of source) values.push(value); return values; };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("corrupt plugin metadata is classified as storage without preserving its contents", async () => {
  const fixture = await setup();
  await writeFile(fixture.path, "{PRIVATE_BROKEN_METADATA");
  await assert.rejects(fixture.jobs.diagnostics(), (error) => {
    const summary = failureSummary(error);
    assert.equal(summary.reason, "invalid_voice_state_json");
    assert.equal(summary.category, "storage");
    assert.ok(!JSON.stringify(summary).includes("PRIVATE"));
    return true;
  });
});

test("native STT failure classification survives durable restart without raw vendor error", async () => {
  const diagnostics = new Diagnostics();
  const fixture = await setup({ diagnostics });
  let calls = 0;
  const input = fixture.input(async ({ timing }) => {
    calls++;
    timing.mark("transcription_started");
    throw annotateFailure(Object.assign(new Error("PRIVATE_AUDIO_TOKEN_URL"), { status: 401 }),
      { stage: "stt_transcription", provider: "elevenlabs" });
  }, { kind: "stt" });
  const receipt = await fixture.jobs.admit(input);
  fixture.jobs.start("client-a", receipt.job_id);
  const status = await fixture.jobs.wait("client-a", receipt.job_id);
  assert.equal(status.code, "job_failed");
  assert.equal(status.failure.category, "authentication");
  assert.equal(status.failure.http_status, 401);
  assert.equal(status.failure.stage, "stt_transcription");
  assert.equal(typeof fixture.jobs.diagnostics, "function");
  assert.equal((await fixture.jobs.diagnostics())[0].failure.provider, "elevenlabs");
  const restoredPath = join(await mkdtemp(join(tmpdir(), "ha-error-restart-")), "state.json");
  await copyFile(fixture.path, restoredPath);
  const restored = new Jobs({ ...fixture.options, state: new StateFile(restoredPath) });
  assert.deepEqual((await restored.status("client-a", receipt.job_id)).failure, status.failure);
  assert.equal(calls, 1);
  assert.ok(!(await readFile(restoredPath, "utf8")).includes("PRIVATE_AUDIO_TOKEN_URL"));
  assert.ok(!JSON.stringify(diagnostics.snapshot()).includes("PRIVATE_AUDIO_TOKEN_URL"));
});

test("receipt write failure remains observable even when the failure receipt cannot commit", async () => {
  let data = {}, fail = false, calls = 0;
  const diagnostics = new Diagnostics();
  const state = { identity: "synthetic-write-failure", async read(fn) { return fn(data); },
    async transaction(fn) {
      if (fail) throw Object.assign(new Error("PRIVATE_DISK_PATH"), { code: "EIO" });
      const next = structuredClone(data), value = await fn(next); data = next; return value;
    } };
  const fixture = await setup({ state, diagnostics });
  const receipt = await fixture.jobs.admit(fixture.input(async () => { calls++; }));
  fail = true;
  fixture.jobs.start("client-a", receipt.job_id);
  await assert.rejects(fixture.jobs.wait("client-a", receipt.job_id));
  assert.equal(calls, 0);
  assert.ok(diagnostics.snapshot().failures.some((e) => e.operation === "persistence" && e.category === "storage"));
  assert.ok(!JSON.stringify(diagnostics.snapshot()).includes("PRIVATE_DISK_PATH"));
});

test("job timeout keeps a specific classification and never claims confirmed remote cancellation", async () => {
  const f = await setup({ maxJobMs: 5 });
  const receipt = await f.jobs.admit(f.input(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })));
  f.jobs.start("client-a", receipt.job_id);
  const status = await f.jobs.wait("client-a", receipt.job_id);
  assert.equal(status.failure.category, "timeout");
  assert.equal(status.failure.reason, "job_timeout");
  assert.equal(status.cancellation_confirmed, false);
});
async function setup(overrides = {}) {
  const path = join(await mkdtemp(join(tmpdir(), "ha-jobs-")), "state.json");
  let now = 1000000;
  const options = { state: new StateFile(path), agentId: "selected", profileId: "default", clock: () => now,
    waitMs: 1000, maxJobMs: 5000, ...overrides };
  return { path, options, jobs: new Jobs(options), now: (value) => { now = value; },
    input: (run, extra = {}) => ({ principal: "client-a", requestId: requestId(now), kind: "turn",
      payload: { text: "Synthetic prompt" }, profileRevision: "r1", run, ...extra }) };
}

test("lost acknowledgments and concurrent retries dispatch exactly once", async () => {
  const fixture = await setup();
  let calls = 0;
  const input = fixture.input(async ({ emit }) => {
    calls++;
    await emit({ type: "text_delta", text: "Opening. " });
    await emit({ type: "text_delta", text: "Ending." });
    return { result: { text: "Opening. Ending." }, terminal: { continue_conversation: false } };
  });
  const [a, b] = await Promise.all([fixture.jobs.admit(input), fixture.jobs.admit(input)]);
  assert.equal(a.job_id, b.job_id);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  const stream = fixture.jobs.events("client-a", a.job_id);
  fixture.jobs.start("client-a", a.job_id);
  const frames = await collect(stream);
  const status = await fixture.jobs.wait("client-a", a.job_id);
  assert.equal(calls, 1);
  assert.equal(status.status, "completed");
  assert.equal(status.result.text, "Opening. Ending.");
  assert.deepEqual(frames.map((frame) => frame.sequence), [1, 2, 3, 4]);
  assert.equal(frames.at(-1).type, "done");
  assert.equal((await fixture.jobs.admit(input)).job_id, a.job_id);
  assert.equal(fixture.jobs.start("client-a", a.job_id), false);
  const replay = await collect(fixture.jobs.events("client-a", a.job_id, 2));
  assert.deepEqual(replay.map((frame) => frame.sequence), [3, 4]);
  assert.equal(calls, 1);
});

test("request conflicts and caller boundaries reject before work", async () => {
  const f = await setup();
  const input = f.input(async () => ({ result: "ok" }));
  const job = await f.jobs.admit(input);
  await assert.rejects(f.jobs.admit({ ...input, payload: { text: "Different" } }), /request_conflict/);
  await assert.rejects(f.jobs.status("client-b", job.job_id), /job_not_found/);
  await assert.rejects(f.jobs.cancel("client-b", job.job_id), /job_not_found/);
  assert.throws(() => f.jobs.events("client-b", job.job_id), /job_not_found/);
  await f.jobs.cancel("client-a", job.job_id);
  await f.jobs.wait("client-a", job.job_id);
});

test("cancel acknowledges output fencing without pretending an unabortable provider stopped", async () => {
  const f = await setup();
  const entered = deferred(), release = deferred();
  let providerFinished = false;
  const job = await f.jobs.admit(f.input(async ({ emit }) => {
    await emit({ type: "text_delta", text: "Before cancellation." });
    entered.resolve();
    await release.promise;
    providerFinished = true;
    await emit({ type: "text_delta", text: "Must not escape" });
  }));
  f.jobs.start("client-a", job.job_id);
  await entered.promise;
  const ack = await f.jobs.cancel("client-a", job.job_id);
  assert.equal(ack.status, "cancel_requested");
  assert.equal(ack.cancellation_confirmed, false);
  assert.equal(providerFinished, false);
  release.resolve();
  const status = await f.jobs.wait("client-a", job.job_id);
  assert.equal(status.status, "cancelled");
  assert.equal(status.cancellation_confirmed, false);
  assert.throws(() => f.jobs.events("client-a", job.job_id), /job_output_cancelled/);
});

test("durable accepted work without its old execution owner is interrupted, never replayed", async () => {
  const f = await setup();
  let calls = 0;
  const input = f.input(async () => { calls++; });
  const receipt = await f.jobs.admit(input);
  const recoveredPath = join(await mkdtemp(join(tmpdir(), "ha-job-restart-")), "state.json");
  await copyFile(f.path, recoveredPath); // Snapshot at the simulated process loss.
  const restarted = new Jobs({ ...f.options, state: new StateFile(recoveredPath) });
  const duplicate = await restarted.admit(input);
  assert.equal(duplicate.job_id, receipt.job_id);
  assert.equal(duplicate.status, "interrupted");
  assert.equal(duplicate.code, "execution_outcome_unknown");
  assert.equal(calls, 0);
  assert.throws(() => restarted.start("client-a", receipt.job_id), /job_not_found/);
});

test("completed result survives owner reconstruction without storing the input prompt", async () => {
  const f = await setup();
  const job = await f.jobs.admit(f.input(async () => ({ result: { text: "Recovered reply" } })));
  f.jobs.start("client-a", job.job_id);
  await f.jobs.wait("client-a", job.job_id);
  const path = join(await mkdtemp(join(tmpdir(), "ha-result-restart-")), "state.json");
  await copyFile(f.path, path);
  const reconstructed = new Jobs({ ...f.options, state: new StateFile(path) });
  const status = await reconstructed.status("client-a", job.job_id);
  assert.equal(status.result.text, "Recovered reply");
  assert.equal(status.stream_replay_available, false);
  assert.ok(!(await readFile(f.path, "utf8")).includes("Synthetic prompt"));
});

test("an expired timestamped request cannot run again after receipt reclamation", async () => {
  const f = await setup({ retentionMs: 100, resultTtlMs: 10 });
  let calls = 0;
  const input = f.input(async () => { calls++; return { result: "done" }; });
  const receipt = await f.jobs.admit(input);
  f.jobs.start("client-a", receipt.job_id);
  await f.jobs.wait("client-a", receipt.job_id);
  f.now(1000101);
  await assert.rejects(f.jobs.admit(input), /request_expired/);
  const status = await f.jobs.status("client-a", receipt.job_id);
  assert.equal(status.result_recoverable, false);
  assert.equal(status.status, "completed");
  assert.equal(calls, 1);
});

test("slow subscribed consumers apply backpressure, not silent frame loss", async () => {
  const f = await setup({ replayBytes: 700 });
  let emitted = 0;
  const job = await f.jobs.admit(f.input(async ({ emit }) => {
    for (let i = 0; i < 8; i++) { await emit({ type: "text_delta", text: "x".repeat(80), index: i }); emitted++; }
    return { result: { text: "complete" } };
  }));
  const stream = f.jobs.events("client-a", job.job_id);
  f.jobs.start("client-a", job.job_id);
  // Observe the real producer reaching its bounded window, then drain.
  await delay(30);
  assert.ok(emitted < 8);
  const frames = await collect(stream);
  await f.jobs.wait("client-a", job.job_id);
  assert.deepEqual(frames.filter((frame) => frame.type === "text_delta").map((frame) => frame.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(frames.at(-1).type, "done");
});

test("evicted stream output reports a replay gap while preserving completed result", async () => {
  const f = await setup({ replayBytes: 700 });
  const job = await f.jobs.admit(f.input(async ({ emit }) => {
    for (let i = 0; i < 8; i++) await emit({ type: "text_delta", text: "x".repeat(80) });
    return { result: { text: "Recovered final answer" } };
  }));
  const neverStartedReader = f.jobs.events("client-a", job.job_id);
  await neverStartedReader.return();
  f.jobs.start("client-a", job.job_id);
  const status = await f.jobs.wait("client-a", job.job_id);
  assert.throws(() => f.jobs.events("client-a", job.job_id, 0), /replay_gap/);
  assert.equal(status.result.text, "Recovered final answer");
});

test("capacity rejects new work but does not reject an existing retry", async () => {
  const f = await setup({ maxActive: 1, maxPerClient: 1, maxRetained: 1 });
  const input = f.input(async () => {});
  const a = await f.jobs.admit(input);
  const duplicate = await f.jobs.admit(input);
  assert.equal(duplicate.job_id, a.job_id);
  await assert.rejects(f.jobs.admit(f.input(async () => {})), /job_capacity/);
  await f.jobs.stop();
  await f.jobs.wait("client-a", a.job_id);
});

test("errors after partial output have safe terminal status and never echo raw exceptions", async () => {
  const f = await setup();
  const job = await f.jobs.admit(f.input(async ({ emit }) => {
    await emit({ type: "text_delta", text: "Some output" });
    throw new Error("DO_NOT_ECHO_TEST_SECRET");
  }));
  const stream = f.jobs.events("client-a", job.job_id);
  f.jobs.start("client-a", job.job_id);
  const frames = await collect(stream);
  const status = await f.jobs.wait("client-a", job.job_id);
  assert.equal(status.status, "partial_failure");
  assert.equal(status.partial_output, true);
  assert.equal(frames.at(-1).code, "job_failed");
  assert.ok(!JSON.stringify(frames).includes("DO_NOT_ECHO_TEST_SECRET"));
  assert.ok(!(await readFile(f.path, "utf8")).includes("DO_NOT_ECHO_TEST_SECRET"));
});

test("same-process metadata owners serialize transactions and enforce file capacity", async () => {
  const f = await setup();
  const second = new StateFile(f.path);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? second : f.options.state)
    .transaction(async (value) => { const before = value.count ?? 0; await Promise.resolve(); value.count = before + 1; })));
  assert.equal(await second.read((value) => value.count), 20);
  const limited = new StateFile(f.path, { maxBytes: 128 });
  await assert.rejects(limited.transaction((value) => { value.tooLarge = "x".repeat(200); }), /voice_state_capacity/);
  assert.equal(await second.read((value) => value.tooLarge), undefined);
});

test("request identity normalizes object order and rejects old/invalid/future IDs", async () => {
  assert.equal(requestTime(requestId(123456789)), 123456789);
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
  const f = await setup();
  await assert.rejects(f.jobs.admit(f.input(async () => {}, { requestId: "not-a-request" })), /invalid_request_id/);
  await assert.rejects(f.jobs.admit(f.input(async () => {}, { requestId: requestId(1300001) })), /request_clock_skew/);
});

test("same-process generation owners share receipts, active limits and replay without cancelling each other's new work", async () => {
  const f = await setup({ maxActive: 1 });
  const second = new Jobs({ ...f.options, state: new StateFile(f.path) });
  let calls = 0;
  const input = f.input(async () => { calls++; return { result: "same" }; });
  const [a, b] = await Promise.all([f.jobs.admit(input), second.admit(input)]);
  assert.equal(a.job_id, b.job_id);
  assert.equal(b.status, "accepted");
  await assert.rejects(second.admit(f.input(async () => {})), /job_capacity/);
  second.start("client-a", a.job_id);
  assert.equal((await second.wait("client-a", a.job_id)).status, "completed");
  assert.equal(calls, 1);
  await f.jobs.stop();
  const next = await second.admit(f.input(async () => ({ result: "new owner" })));
  second.start("client-a", next.job_id);
  assert.equal((await second.wait("client-a", next.job_id)).result, "new owner");
  await second.stop();
});
