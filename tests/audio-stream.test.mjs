import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { canonicalSpeech } from "../src/audio-stream.mjs";
import { Diagnostics, failureSummary } from "../src/observability.mjs";

const collect = async (source) => { const values = []; for await (const value of source) values.push(value); return values; };
const text = async function* () { yield "First. Second."; };
const unsupported = async () => ({ success: false, attempts: [{ outcome: "skipped", reasonCode: "unsupported_for_streaming" }] });
const encode = (format, rate) => {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
    "-ar", String(rate), "-ac", "1", "-f", format, "pipe:1"]);
  assert.equal(result.status, 0);
  return result.stdout;
};

test("decoder startup/exit failure records a safe reason without stderr or binary path", async () => {
  const diagnostics = new Diagnostics();
  const host = { stream: unsupported, buffer: async () => ({ success: true,
    fileExtension: ".wav", outputFormat: "wav", audioBuffer: encode("wav", 16000) }) };
  let summary;
  await assert.rejects(async () => {
    try { await collect(canonicalSpeech(text(), { host, binary: "/nonexistent/PRIVATE_BINARY", diagnostics })); }
    catch (error) { summary = failureSummary(error); throw error; }
  });
  assert.equal(summary.reason, "audio_normalizer_unavailable");
  assert.equal(summary.stage, "normalization");
  assert.ok(diagnostics.snapshot().recent.some((e) => e.operation === "decoder"));
  assert.ok(!JSON.stringify(diagnostics.snapshot()).includes("PRIVATE_BINARY"));
});

test("different self-describing source containers become one continuous correctly sampled WAV stream", async () => {
  const buffers = [encode("wav", 16000), encode("flac", 48000)];
  let request = 0;
  const events = await collect(canonicalSpeech(text(), { host: { stream: unsupported, buffer: async () => {
    const index = request++;
    return { success: true, fileExtension: index ? ".flac" : ".wav", outputFormat: index ? "flac" : "wav", audioBuffer: buffers[index] };
  } } }));
  assert.equal(events.filter((event) => event.type === "audio_start").length, 1);
  assert.equal(events.filter((event) => event.type === "audio_end").length, 1);
  assert.equal(events.at(-1).provider_segments, 2);
  const audio = Buffer.concat(events.filter((event) => event.type === "audio_chunk").map((event) => event.bytes));
  assert.equal(audio.subarray(0, 4).toString(), "RIFF");
  const decoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: audio });
  assert.equal(decoded.status, 0);
  assert.equal(decoded.stdout.length, 28800); // 0.6s * 24kHz * PCM16, no repeated headers/padding.
});

test("first canonical audio does not wait for the next sentence input", async () => {
  const buffer = encode("wav", 24000);
  let release;
  const gate = new Promise((done) => { release = done; });
  let endingSupplied = false;
  async function* input() { yield "Opening."; await gate; endingSupplied = true; yield " Ending."; }
  const host = { stream: unsupported, buffer: async () => ({ success: true, fileExtension: ".wav", outputFormat: "wav", audioBuffer: buffer }) };
  const stream = canonicalSpeech(input(), { host });
  assert.equal((await stream.next()).value.type, "audio_start");
  const first = (await stream.next()).value;
  assert.equal(first.type, "audio_chunk");
  assert.ok(first.bytes.length > 44);
  assert.equal(endingSupplied, false);
  release();
  const rest = await collect(stream);
  assert.equal(rest.at(-1).type, "done");
});

test("unlabelled raw PCM is not guessed and malformed encoded audio cannot complete", async () => {
  const host = (extension) => ({ stream: unsupported, buffer: async () => ({ success: true, fileExtension: "." + extension,
    outputFormat: extension, audioBuffer: Buffer.from("not a valid audio file") }) });
  await assert.rejects(collect(canonicalSpeech(text(), { host: host("pcm") })), /raw_audio_metadata_required/);
  await assert.rejects(collect(canonicalSpeech(text(), { host: host("mp3") })), /audio_decode_failed|audio_decoder_closed/);
});

test("canonical decoding is progressive before provider EOF and closes owned transport on consumer cancellation", { timeout: 8000 }, async () => {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-ar", "24000", "-ac", "1", "-f", "wav", "pipe:1"]);
  assert.equal(result.status, 0);
  let releaseEnding;
  const gate = new Promise((resolve) => { releaseEnding = resolve; });
  let ending = false, cancelled = 0, released = 0;
  let chunks = 0;
  const provider = new ReadableStream({
    async pull(controller) {
      if (chunks++ === 0) controller.enqueue(result.stdout.subarray(0, 60000));
      else { await gate; ending = true; controller.enqueue(result.stdout.subarray(60000)); controller.close(); }
    },
    cancel() { cancelled++; releaseEnding(); },
  });
  const host = { stream: async () => ({ success: true, outputFormat: "wav", fileExtension: ".wav", audioStream: provider,
    release: async () => { released++; } }) };
  const source = canonicalSpeech((async function* () { yield "Opening."; })(), { host, signal: AbortSignal.timeout(6000) });
  try {
    assert.equal((await source.next()).value.type, "audio_start");
    const chunk = (await source.next()).value;
    assert.ok(chunk.bytes.length > 44);
    assert.equal(ending, false, "the provider ending must still be withheld");
    await source.return();
    assert.equal(cancelled, 1);
    assert.equal(released, 1);
  } finally { releaseEnding(); await source.return(); }
});

test("fragmented WAV headers preserve declared PCM and float formats and skip finite-data trailers", async () => {
  for (const codec of ["pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"]) {
    const encoded = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=0.2",
      "-ar", "16000", "-ac", "2", "-c:a", codec, "-f", "wav", "pipe:1"]);
    assert.equal(encoded.status, 0, codec);
    const buffer = encoded.stdout;
    const data = buffer.indexOf(Buffer.from("data"));
    assert.ok(data >= 0);
    buffer.writeUInt32LE(buffer.length - data - 8, data + 4);
    const trailer = Buffer.from("JUNK\x04\0\0\0abcd");
    let offset = 0;
    const framed = Buffer.concat([buffer, trailer]);
    const provider = new ReadableStream({ pull(controller) {
      // Split fmt fields and the data boundary across multiple provider reads.
      if (offset === framed.length) { controller.close(); return; }
      const end = Math.min(framed.length, offset + (offset < data + 8 ? 7 : 1001));
      controller.enqueue(framed.subarray(offset, end)); offset = end;
    } });
    const events = await collect(canonicalSpeech((async function* () { yield "One."; })(), {
      host: { stream: async () => ({ success: true, fileExtension: ".wav", outputFormat: "wav", audioStream: provider }) },
    }));
    const normalized = Buffer.concat(events.filter((event) => event.type === "audio_chunk").map((event) => event.bytes));
    const expected = spawnSync("ffmpeg", ["-v", "error", "-f", "wav", "-i", "pipe:0", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"], { input: buffer });
    assert.equal(expected.status, 0, codec);
    assert.deepEqual(normalized.subarray(44), expected.stdout, codec);
  }
});

test("WAV metadata limits, inconsistent sample declarations and truncated data fail closed", async () => {
  const original = encode("wav", 24000);
  const data = original.indexOf(Buffer.from("data"));
  const malformed = [];
  const oversized = Buffer.from(original); oversized.writeUInt32LE(65536, 16); malformed.push([oversized, /audio_header_limit/]);
  const wrongAlign = Buffer.from(original); wrongAlign.writeUInt16LE(4, 32); malformed.push([wrongAlign, /invalid_audio_header/]);
  const truncated = Buffer.from(original); truncated.writeUInt32LE(original.length, data + 4); malformed.push([truncated, /incomplete_audio_segment/]);
  malformed.push([original.subarray(0, original.length - 1), /incomplete_audio_segment/]);
  for (const [audioBuffer, error] of malformed) {
    await assert.rejects(collect(canonicalSpeech((async function* () { yield "One."; })(), { host: {
      stream: unsupported, buffer: async () => ({ success: true, fileExtension: ".wav", outputFormat: "wav", audioBuffer }),
    } })), error);
  }
});
