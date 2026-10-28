import test from "node:test";
import assert from "node:assert/strict";
import { VoiceRunControls } from "../src/run-controls.mjs";

const input = (runId, extras = {}) => ({
  runId, agentId: "voice-agent", sessionKey: "agent:voice-agent:shared",
  model: { provider: "provider-a", id: "model/a" }, thinking: "low", fast: false,
  ...extras,
});
const context = (runId, extras = {}) => ({
  runId, agentId: "voice-agent", sessionKey: "agent:voice-agent:shared", ...extras,
});

test("different runs sharing a persistent session retain independent model controls", () => {
  const registry = new VoiceRunControls();
  const session = Object.freeze({ model: "existing", thinking: "high", fast: true });
  registry.admit(input("a"));
  registry.admit(input("b", { model: { provider: "provider-b", id: "other" } }));
  assert.deepEqual(registry.beforeModelResolve({}, context("a")),
    { providerOverride: "provider-a", modelOverride: "model/a" });
  assert.deepEqual(registry.beforeModelResolve({}, context("b")),
    { providerOverride: "provider-b", modelOverride: "other" });
  assert.equal(registry.beforeModelResolve({}, context("nonvoice")), undefined);
  assert.deepEqual(session, { model: "existing", thinking: "high", fast: true });
});

test("run id alone cannot cross agent or session boundaries", () => {
  const registry = new VoiceRunControls();
  registry.admit(input("a"));
  assert.equal(registry.beforeModelResolve({}, context("a", { agentId: "other" })), undefined);
  assert.equal(registry.beforeModelResolve({}, context("a", { sessionKey: "other" })), undefined);
  assert.equal(registry.beforeModelResolve({}, {}), undefined);
});

test("explicit fast false and thinking override reach one-turn reply options", () => {
  const registry = new VoiceRunControls();
  const admitted = registry.admit(input("a"));
  assert.equal(admitted.replyOptions.fastModeOverride, false);
  assert.equal(admitted.replyOptions.thinkingLevelOverride, "low");
  assert.equal(admitted.replyOptions.runId, "a");
  assert.equal(admitted.replyOptions.abortSignal.aborted, false);
});

test("inheritance omits overrides rather than writing session preferences", () => {
  const registry = new VoiceRunControls();
  const admitted = registry.admit(input("a", { model: undefined, thinking: undefined, fast: undefined }));
  assert.equal("fastModeOverride" in admitted.replyOptions, false);
  assert.equal("thinkingLevelOverride" in admitted.replyOptions, false);
  assert.equal(registry.beforeModelResolve({}, context("a")), undefined);
});

test("cancel fences late model resolution and aborts only the owned run", () => {
  const registry = new VoiceRunControls();
  const a = registry.admit(input("a"));
  const b = registry.admit(input("b"));
  assert.equal(registry.cancel(a.lease), true);
  assert.equal(a.replyOptions.abortSignal.aborted, true);
  assert.equal(b.replyOptions.abortSignal.aborted, false);
  assert.equal(registry.beforeModelResolve({}, context("a")), undefined);
  assert.equal(registry.cancel({ runId: "b" }), false);
});

test("release is lease-bound, idempotent and removes all late authority", () => {
  const registry = new VoiceRunControls();
  const a = registry.admit(input("a"));
  assert.equal(registry.release({ runId: "a" }), false);
  assert.equal(registry.release(a.lease), true);
  assert.equal(registry.release(a.lease), false);
  assert.equal(registry.beforeModelResolve({}, context("a")), undefined);
});

test("caller mutation cannot change admitted model", () => {
  const registry = new VoiceRunControls();
  const model = { provider: "provider-a", id: "original" };
  registry.admit(input("a", { model }));
  model.id = "mutated";
  assert.equal(registry.beforeModelResolve({}, context("a")).modelOverride, "original");
});

test("duplicate admission and malformed controls are rejected", () => {
  const registry = new VoiceRunControls();
  registry.admit(input("a"));
  assert.throws(() => registry.admit(input("a")), /already_admitted/);
  assert.throws(() => registry.admit(input("b", { fast: "fastest" })), /invalid fast/);
  assert.throws(() => registry.admit(input("b", { runId: " " })), /canonical/);
});

test("plugin close aborts and clears all runs", () => {
  const registry = new VoiceRunControls();
  const a = registry.admit(input("a"));
  registry.close();
  assert.equal(a.replyOptions.abortSignal.aborted, true);
  assert.equal(registry.activeCount, 0);
});
