import test from "node:test";
import assert from "node:assert/strict";
import { ReplyProjection } from "../src/reply-projection.mjs";

test("stream snapshots plus final delivery produce each word exactly once", async () => {
  const events = [];
  const projection = new ReplyProjection(async (event) => events.push(event));
  await projection.start();
  await projection.partial({ text: "Opening." });
  await projection.partial({ text: "Opening. Ending" });
  await projection.final({ text: "Opening. Ending." }, { kind: "final" });
  assert.equal(events.map((event) => event.text).join(""), "Opening. Ending.");
  assert.equal((await projection.result()).text, "Opening. Ending.");
});

test("tool/reasoning/fallback notices never enter speech or final text", async () => {
  const projection = new ReplyProjection(async () => {});
  await projection.final({ text: "raw tool result" }, { kind: "tool" });
  await projection.final({ text: "model changed", isFallbackNotice: true }, { kind: "final" });
  await projection.partial({ text: "hidden reasoning", isReasoning: true });
  await projection.final({ text: "Answer" }, { kind: "final" });
  assert.equal((await projection.result()).text, "Answer");
});

test("multiple native messages retain boundaries without replaying delayed block acknowledgments", async () => {
  const events = [];
  const projection = new ReplyProjection(async (event) => events.push(event));
  await projection.partial({ text: "Checking." });
  await projection.start();
  await projection.partial({ text: "Answer." });
  await projection.final({ text: "Checking." }, { kind: "block" });
  await projection.final({ text: "Answer." }, { kind: "final" });
  assert.deepEqual(events.map((event) => event.message_id), [0, 1]);
  assert.equal((await projection.result()).text, "Checking.\n\nAnswer.");
});

test("a revision that would retract already-emitted speech fails instead of replaying", async () => {
  const events = [];
  const projection = new ReplyProjection(async (event) => events.push(event));
  await projection.partial({ text: "Original answer" });
  await assert.rejects(projection.partial({ text: "Replacement answer", replace: true }), /non_monotonic_reply/);
  assert.deepEqual(events.map((event) => event.text), ["Original answer"]);
});

test("buffered Unicode answers are wire-chunked without losing characters", async () => {
  const events = [];
  const projection = new ReplyProjection(async (event) => events.push(event));
  const answer = "Words 🐈 你好. ".repeat(1200);
  await projection.final({ text: answer }, { kind: "final" });
  assert.ok(events.every((event) => Buffer.byteLength(event.text) <= 8192));
  assert.equal(events.map((event) => event.text).join(""), answer);
  assert.equal((await projection.result()).text, answer);
});
