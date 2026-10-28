import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFrames, readSpeechRequest, writeFrame } from "../src/protocol.mjs";
const collect = async (source) => { const all = []; for await (const value of source) all.push(value); return all; };
const input = async function* (...values) { yield* values.map((value) => Buffer.from(value)); };
const start = { type: "start", protocol_major: 1, request_id: "01234567-1234-1234-1234-012345678901", profile_revision: "r1", language: "en" };
const encode = (...frames) => frames.map((frame) => JSON.stringify(frame) + "\n").join("");

test("fragmented Unicode and multiple network-batched frames retain exact content", async () => {
  const raw = Buffer.from(encode({ text: "Hi 🐈" }, { text: "你好" }));
  async function* parts() { for (const byte of raw) yield Buffer.from([byte]); }
  assert.deepEqual(await collect(readFrames(parts())), [{ text: "Hi 🐈" }, { text: "你好" }]);
  assert.equal((await collect(readFrames(input(encode({ a: 1 }, { a: 2 })), 7))).length, 2);
});

test("malformed, oversized and truncated frames fail closed", async () => {
  for (const value of ["{}", "[]\n", "invalid\n", "\n"])
    await assert.rejects(collect(readFrames(input(value))));
  await assert.rejects(collect(readFrames(input("{", "\"long\":1}\n"), 8)), /frame_limit/);
});

test("speech request requires exact profile/version and prohibits model/session fields", async () => {
  for (const first of [{ ...start, model: "forbidden" }, { ...start, protocol_major: 2 }, { ...start, profile_revision: "other" }])
    await assert.rejects(readSpeechRequest(input(encode(first)), "r1"));
});

test("speech text is incremental and has exactly one correctly sequenced terminal", async () => {
  const { text } = await readSpeechRequest(input(encode(start, { type: "text", sequence: 1, text: "Hi." }, { type: "end", sequence: 2 })), "r1");
  assert.deepEqual(await collect(text), ["Hi."]);
  for (const frames of [
    [{ type: "text", sequence: 2, text: "bad" }],
    [{ type: "text", sequence: 1, text: "missing end" }],
    [{ type: "end", sequence: 1 }, { type: "end", sequence: 2 }],
  ]) {
    const stream = await readSpeechRequest(input(encode(start, ...frames)), "r1");
    await assert.rejects(collect(stream.text));
  }
});

test("writer waits for drain and does not leak listeners on close", async () => {
  class Output extends EventEmitter {
    write(value) { this.value = value; return false; }
  }
  const output = new Output();
  let done = false;
  const task = writeFrame(output, { type: "audio_chunk", bytes: Buffer.from("audio") }).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(JSON.parse(output.value).audio, Buffer.from("audio").toString("base64"));
  output.emit("drain");
  await task;
  assert.equal(output.listenerCount("close"), 0);
  const failing = writeFrame(output, { type: "other" });
  output.emit("close");
  await assert.rejects(failing, /output_closed/);
  assert.equal(output.listenerCount("drain"), 0);
});
