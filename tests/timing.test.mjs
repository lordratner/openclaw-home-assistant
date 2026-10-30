import test from "node:test";
import assert from "node:assert/strict";
import { RunTiming } from "../src/timing.mjs";

test("timing is monotonic, first-occurrence, bounded and rejects arbitrary content fields", () => {
  let now = 100;
  const timing = new RunTiming(() => now);
  now = 110; timing.mark("first_text");
  now = 130; timing.mark("first_text");
  timing.observeModel("openai", "gpt-6-luna");
  for (let i = 0; i < 100; i++) { timing.segment("request", i); timing.segment("source_audio", i); }
  const result = timing.snapshot();
  assert.equal(result.stages_ms.first_text, 10);
  assert.equal(result.elapsed_ms, 30);
  assert.equal(result.segments.length, 16);
  assert.equal(result.synthesis_requests, 100);
  assert.equal(result.segments_truncated, true);
  assert.throws(() => timing.mark("private prompt"), /invalid_timing/);
  result.stages_ms.first_text = -1;
  assert.equal(timing.snapshot().stages_ms.first_text, 10);
});
