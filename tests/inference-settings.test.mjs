import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceSettings, normalizeConversation } from "../src/inference-settings.mjs";
import { StateFile } from "../src/state-file.mjs";

async function fixture() {
  const path = join(await mkdtemp(join(tmpdir(), "voice-inference-")), "state.json");
  const options = { state: new StateFile(path), agentId: "voice", profileId: "default",
    defaults: { model: "p/a", thinking: "high", fast: false },
    validate: async (value) => {
      const normalized = normalizeConversation(value, (v) => ["low", "medium", "high"].includes(v) ? v : undefined);
      if (normalized.model && !["p/a", "p/b"].includes(normalized.model)) throw new Error("model_not_allowed");
      return normalized;
    } };
  return { options, settings: new InferenceSettings(options) };
}

test("owner update persists; old snapshot remains immutable; null resets bootstrap and inherit omits override", async () => {
  const { settings, options } = await fixture();
  const before = await settings.snapshot();
  const updated = await settings.update({ expected_revision: before.revision, patch: { model: "p/b", thinking: "medium", fast: true } });
  assert.equal(updated.source, "owner_override");
  assert.deepEqual(before.conversation, { model: "p/a", thinking: "high", fast: false });
  assert.throws(() => { before.conversation.model = "p/b"; });
  const reconstructed = new InferenceSettings({ ...options, state: new StateFile(options.state.identity) });
  assert.deepEqual((await reconstructed.snapshot()).conversation, { model: "p/b", thinking: "medium", fast: true });
  const inherited = await reconstructed.update({ expected_revision: updated.revision, patch: { model: "inherit", thinking: null, fast: false } });
  assert.deepEqual((await settings.snapshot()).conversation, { thinking: "high", fast: false });
  const reset = await settings.update({ expected_revision: inherited.revision, patch: { model: null, fast: null } });
  assert.equal(reset.source, "bootstrap");
  assert.deepEqual(reset.effective, reset.defaults);
  assert.notEqual(reset.revision, before.revision, "revision prevents ABA stale writers");
});

test("concurrent stale writers cannot clobber each other", async () => {
  const { settings } = await fixture();
  const { revision } = await settings.get();
  const results = await Promise.allSettled([
    settings.update({ expected_revision: revision, patch: { fast: true } }),
    settings.update({ expected_revision: revision, patch: { thinking: "low" } }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /stale_inference/);
});

test("invalid, disallowed and locked-target updates leave durable state unchanged", async () => {
  const { settings } = await fixture();
  const before = await settings.get();
  for (const patch of [{ model: "p/denied" }, { fast: "on" }, { thinking: "unlimited" }, { agentId: "other" }, { model: "secret\nvalue" }]) {
    await assert.rejects(settings.update({ expected_revision: before.revision, patch }));
    assert.deepEqual(await settings.get(), before);
  }
  await assert.rejects(settings.update({ expected_revision: before.revision, patch: { model: "p/b" } },
    { validateTarget: () => { throw new Error("session_model_locked"); } }), /session_model_locked/);
  assert.deepEqual(await settings.get(), before);
});

test("agent scopes cannot share owner overrides", async () => {
  const { settings, options } = await fixture();
  await settings.update({ expected_revision: (await settings.get()).revision, patch: { model: "p/b" } });
  assert.equal((await new InferenceSettings({ ...options, agentId: "other" }).get()).source, "bootstrap");
});
