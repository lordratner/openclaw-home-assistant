import test from "node:test";
import assert from "node:assert/strict";
import { VoiceContinuation, CONTINUATION_BINDING } from "../src/voice-continuation.mjs";

function fixture() {
  const bridge = new VoiceContinuation();
  const controller = new AbortController();
  const owner = { agentId: "voice", sessionKey: "agent:voice:test", sessionId: "physical", runId: "turn" };
  const lease = bridge.open({ ...owner, signal: controller.signal });
  const ctx = { ...owner, toolBindings: { [CONTINUATION_BINDING]: lease.token }, assertInvocationCurrent() {} };
  return { bridge, controller, owner, lease, ctx, tool: bridge.factory(ctx) };
}

test("only the bound voice turn can set explicit continuation; a follow-up starts false", async () => {
  const { bridge, controller, owner, lease, ctx, tool } = fixture();
  assert.equal(lease.continuing(), false);
  for (const field of ["agentId", "sessionKey", "sessionId"])
    assert.equal(bridge.factory({ ...ctx, [field]: "other" }), null);
  assert.equal(bridge.factory({ ...ctx, toolBindings: {} }), null);
  assert.equal(bridge.prompt({}, { ...owner, runId: "other" }), undefined);
  assert.equal(bridge.prompt({}, { ...owner, sessionId: "other" }), undefined);
  assert.match(bridge.prompt({}, owner).appendSystemContext, /EVERY turn/);
  await tool.execute("clarify", { continue_conversation: true });
  assert.equal(lease.continuing(), true);
  const next = bridge.open({ ...owner, runId: "next", signal: controller.signal });
  assert.equal(next.continuing(), false, "do not inherit the previous listening decision");
  const nextCtx = { ...ctx, toolBindings: { [CONTINUATION_BINDING]: next.token } };
  await bridge.factory(nextCtx).execute("clarify-again", { continue_conversation: true });
  await tool.execute("stop", { continue_conversation: false });
  assert.equal(lease.continuing(), false);
  assert.equal(next.continuing(), true, "one turn cannot overwrite another's decision");
  lease.close();
  assert.equal(bridge.factory(ctx), null);
  await assert.rejects(tool.execute("late", { continue_conversation: true }), /voice_turn_closed/);
  bridge.close();
  assert.equal(next.continuing(), false);
});

test("malformed inputs, canceled invocations and stale host context cannot reopen listening", async () => {
  const { bridge, controller, owner, lease, ctx, tool } = fixture();
  for (const value of [undefined, null, [], {}, { continue_conversation: "true" },
    { continue_conversation: 1 }, { continue_conversation: true, extra: "x" }])
    await assert.rejects(tool.execute("invalid", value), /invalid_voice_continuation/);
  assert.equal(lease.continuing(), false);
  const stale = bridge.factory({ ...ctx, assertInvocationCurrent() { throw Error("stale context"); } });
  await assert.rejects(stale.execute("stale", { continue_conversation: true }), /stale context/);
  await assert.rejects(tool.execute("canceled", { continue_conversation: true }, AbortSignal.abort()), /voice_turn_closed/);
  await tool.execute("valid", { continue_conversation: true });
  controller.abort();
  assert.equal(lease.continuing(), false);
  assert.equal(bridge.factory(ctx), null);
  assert.equal(bridge.prompt({}, owner), undefined);
  await assert.rejects(tool.execute("late", { continue_conversation: true }), /voice_turn_closed/);
  lease.close();
});
