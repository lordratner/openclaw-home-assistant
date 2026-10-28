import test from "node:test";
import assert from "node:assert/strict";
import { OpenClawHost } from "../src/openclaw-host.mjs";
import { VoiceRunControls } from "../src/run-controls.mjs";

// Contract-level negative. Native locked harness creation has a separate gate;
// this does not pretend a mocked session record is native lock acceptance.
test("host rejects conflicting locked model before dispatch and leaves session preferences intact", async () => {
  const target = { key: "agent:fixture:locked", sessionId: "physical" };
  const entry = Object.freeze({ modelSelectionLocked: true, providerOverride: "native", modelOverride: "locked" });
  let dispatches = 0;
  const host = Object.assign(Object.create(OpenClawHost.prototype), {
    profile: { agentId: "fixture", conversation: {} }, storePath: "unused",
    controls: new VoiceRunControls(), observers: new Map(), model: () => ({ provider: "native", id: "other" }),
    inspectSession: async () => target,
    api: { runtime: {
      agent: { session: { runWithWorkAdmission: async (_options, run) => run(new AbortController().signal), getSessionEntry: () => entry } },
      channel: { inbound: { dispatch: async () => { dispatches++; } } },
    } },
  });
  await assert.rejects(host.runTurn({ target, principal: "client", conversationId: "ha-chat", text: "Do not run",
    runId: "locked-proof", signal: new AbortController().signal, emit: async () => {} }), /session_model_locked/);
  assert.equal(dispatches, 0);
  assert.equal(entry.modelOverride, "locked");
  assert.equal(host.observers.size, 0);
  host.close();
});
