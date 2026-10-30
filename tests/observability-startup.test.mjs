import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/plugin.mjs";

test("owner diagnostics remain available with a safe cause when service startup fails", async () => {
  const methods = new Map();
  let service;
  plugin.register({ id: "openclaw-home-assistant", logger: { warn() { throw new Error("PRIVATE_SINK_ERROR"); } }, on() {}, registerTool() {}, registerHttpRoute() {},
    runtime: { agent: { normalizeThinkingLevel: (v) => v } },
    registerGatewayMethod(name, handler, policy) { methods.set(name, { handler, policy }); },
    registerService(value) { service = value; } });
  await service.start({ config: { private: "PRIVATE_CONFIG_TOKEN", plugins: { entries: {} } } });
  const invoke = async (name, params) => {
    let result;
    await methods.get(name).handler({ params, respond(ok, data, error) { result = { ok, data, error }; } });
    return result;
  };
  const entry = methods.get("openclaw_home_assistant.diagnostics");
  assert.equal(entry.policy.scope, "operator.admin");
  const response = await invoke("openclaw_home_assistant.diagnostics", { limit: 10 });
  assert.equal(response.ok, true);
  assert.equal(response.data.ready, false);
  assert.equal(response.data.startup_code, "selected_agent_not_found");
  assert.ok(response.data.observability.failures.some((e) => e.operation === "startup"));
  assert.ok(!JSON.stringify(response).includes("PRIVATE_CONFIG_TOKEN"));
  assert.ok(!JSON.stringify(response).includes("PRIVATE_SINK_ERROR"));
  assert.ok(response.data.observability.stats.observer_failures > 0);
  assert.equal((await invoke("openclaw_home_assistant.status", {})).ok, false);
  assert.equal((await invoke("openclaw_home_assistant.diagnostics", { limit: 999 })).ok, false);
});
