import test from "node:test";
import assert from "node:assert/strict";
import { speechEvents, sentenceSegments } from "../src/speech-stream.mjs";
import { Diagnostics, failureSummary } from "../src/observability.mjs";
import { canonicalSpeech } from "../src/audio-stream.mjs";

const chunks = async function* (...values) { yield* values; };
const collect = async (source) => { const all = []; for await (const value of source) all.push(value); return all; };
const unsupported = () => ({ success: false, attempts: [{ outcome: "skipped", reasonCode: "unsupported_for_streaming" }] });
const buffered = () => ({ success: true, audioBuffer: Buffer.from("sound"), fileExtension: ".mp3", outputFormat: "mp3", provider: "unfamiliar" });

test("failed native synthesis attempts survive normalization wrappers as safe provider diagnostics", async () => {
  const diag = new Diagnostics();
  const host = { stream: async () => ({ success: false, attempts: [{ outcome: "failed", provider: "elevenlabs",
    status: 401, error: "PRIVATE_AUDIO_TOKEN_URL", reasonCode: "provider_error" }] }) };
  let failure;
  await assert.rejects(async () => {
    try { await collect(canonicalSpeech(chunks("PRIVATE_SPOKEN_TEXT"), { host, diagnostics: diag })); }
    catch (error) { failure = failureSummary(error); throw error; }
  });
  assert.equal(failure.category, "authentication");
  assert.equal(failure.http_status, 401);
  assert.equal(failure.stage, "synthesis_request");
  assert.equal(failure.provider, "elevenlabs");
  assert.ok(!JSON.stringify(failure).includes("PRIVATE"));
});

test("cleanup failures are logged without masking the provider's primary failure", async () => {
  const diag = new Diagnostics();
  const primary = Object.assign(new Error("PRIVATE_PROVIDER_TOKEN"), { status: 429 });
  let released = 0;
  const host = { stream: async () => ({ ...buffered(), audioStream: new ReadableStream({
    start(controller) { controller.error(primary); },
  }), release: async () => { released++; throw Object.assign(new Error("PRIVATE_DISK_PATH"), { code: "EIO" }); } }) };
  await assert.rejects(collect(speechEvents(chunks("Hello."), { host, diagnostics: diag })), (e) => e === primary);
  assert.equal(released, 1);
  assert.equal(failureSummary(primary).http_status, 429);
  assert.ok(diag.snapshot().failures.some((e) => e.phase === "cleanup_failed" && e.system_code === "EIO"));
  assert.ok(!JSON.stringify(diag.snapshot()).includes("PRIVATE"));
});

test("best-effort reader cancellation failure stays nonfatal and is no longer silent", async () => {
  let reads = 0;
  const diag = new Diagnostics();
  const host = { stream: async () => ({ ...buffered(), audioStream: { getReader() { return {
    async read() { return reads++ ? { done: true } : { value: Buffer.from("audio"), done: false }; },
    async cancel() { throw new Error("PRIVATE_CANCEL_ERROR"); }, releaseLock() {},
  }; } } }) };
  const result = await collect(speechEvents(chunks("Hello."), { host, diagnostics: diag }));
  assert.equal(result.at(-1).type, "done");
  assert.ok(diag.snapshot().failures.some((e) => e.operation === "provider_release"));
});

test("first sentence audio is produced before final text is supplied", async () => {
  let release;
  const gate = new Promise((done) => { release = done; });
  let finalSupplied = false;
  const text = async function* () {
    yield "The opening sentence.";
    await gate;
    finalSupplied = true;
    yield " This is the delayed ending.";
  };
  const stream = speechEvents(text(), { host: { stream: unsupported, buffer: buffered } });
  assert.equal((await stream.next()).value.mode, "sentence_buffered");
  assert.equal((await stream.next()).value.type, "audio_chunk");
  assert.equal(finalSupplied, false);
  release();
  const rest = await collect(stream);
  assert.equal(rest.at(-1).segments, 2);
});

test("unfamiliar progressive provider stays progressive and releases exactly once", async () => {
  let releases = 0, bufferedCalls = 0;
  const host = {
    async stream() { return { ...buffered(), audioStream: new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("one")); controller.close(); },
    }), release: async () => { releases++; } }; },
    async buffer() { bufferedCalls++; return buffered(); },
  };
  const events = await collect(speechEvents(chunks("Hello."), { host }));
  assert.equal(events[0].mode, "sentence_progressive");
  assert.equal(releases, 1);
  assert.equal(bufferedCalls, 0);
});

test("unsupported streaming falls back, API failure does not trigger a replay", async () => {
  let calls = 0;
  const host = { stream: () => ({ success: false, attempts: [{ outcome: "failed", reasonCode: "provider_error" }] }),
    buffer: () => { calls++; return buffered(); } };
  await assert.rejects(collect(speechEvents(chunks("Hello."), { host })), /synthesis_failed/);
  assert.equal(calls, 0);
});

test("abort during a buffered request suppresses returned late audio", async () => {
  const controller = new AbortController();
  const host = { stream: unsupported, async buffer() { controller.abort(); return buffered(); } };
  await assert.rejects(collect(speechEvents(chunks("Hello."), { host, signal: controller.signal })), /abort/i);
});

test("consumer close cancels stream transport and releases ownership", async () => {
  let cancelled = 0, released = 0;
  const host = { async stream() { return { ...buffered(), audioStream: new ReadableStream({
    pull(c) { c.enqueue(Buffer.from("part")); }, cancel() { cancelled++; },
  }), release: async () => { released++; } }; } };
  const stream = speechEvents(chunks("Hello."), { host });
  await stream.next();
  await stream.next();
  await stream.return();
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test("audio chunk/window and text limits fail closed without silent truncation", async () => {
  const host = { stream: unsupported, buffer: buffered };
  const events = await collect(speechEvents(chunks("Hello."), { host, maxChunkBytes: 2 }));
  assert.deepEqual(events.filter((e) => e.type === "audio_chunk").map((e) => e.bytes.length), [2, 2, 1]);
  await assert.rejects(collect(speechEvents(chunks("Hello."), { host, maxAudioBytes: 2 })), /audio_limit/);
  await assert.rejects(collect(sentenceSegments(chunks("x".repeat(20)), { maxText: 16, maxSegment: 16 })), /text_limit/);
});

test("audio format cannot change midway through a logical response", async () => {
  let calls = 0;
  const host = { stream: unsupported, buffer: () => ({ ...buffered(),
    fileExtension: ++calls === 1 ? ".mp3" : ".wav" }) };
  await assert.rejects(collect(speechEvents(chunks("First. Second."), { host })), /audio_format_changed/);
});

test("segmentation preserves ordinary text and flushes unpunctuated final input", async () => {
  const original = "Hello world. Another question? Final words without punctuation";
  const segments = await collect(sentenceSegments(chunks(original.slice(0, 6), original.slice(6))));
  assert.equal(segments.join(""), original);
  assert.equal(segments.length, 3);
});

test("empty synthesis is a failure and Unicode budgets count UTF-8 bytes", async () => {
  const host = { stream: unsupported, buffer: () => ({ ...buffered(), audioBuffer: Buffer.alloc(0) }) };
  await assert.rejects(collect(speechEvents(chunks("Hello."), { host })), /empty_audio/);
  await assert.rejects(collect(sentenceSegments(chunks("🐈".repeat(5)), { maxText: 16, maxSegment: 16 })), /text_limit/);
});

test("fragmented decimal and title do not produce premature sentence audio", async () => {
  const segments = await collect(sentenceSegments(chunks("Dr.", " Smith paid 3.", "14 dollars. Next!", " 中文。")));
  assert.equal(segments[0], "Dr. Smith paid 3.14 dollars. ");
  assert.equal(segments.join(""), "Dr. Smith paid 3.14 dollars. Next! 中文。");
  assert.equal((await collect(sentenceSegments(chunks("Final number 3.")))).join(""), "Final number 3.");
});
