/** Invoked only by the disposable harness. Never loads a cached owner identity. */
import assert from "node:assert/strict";
import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

let resolveHello, rejectHello;
const ready = new Promise((resolve, reject) => { resolveHello = resolve; rejectHello = reject; });
const client = new GatewayClient({ url: process.env.VOICE_PROOF_GATEWAY_URL,
  token: process.env.OPENCLAW_GATEWAY_TOKEN, clientName: "cli", mode: "cli",
  scopes: ["operator.read"], deviceIdentity: null,
  hostDeps: { loadDeviceAuthToken: () => null, storeDeviceAuthToken: () => {}, clearDeviceAuthToken: () => {} },
  onHelloOk: resolveHello, onConnectError: rejectHello,
});
const timeout = setTimeout(() => rejectHello(new Error("scope proof connection timeout")), 10000);
try {
  client.start();
  const hello = await ready;
  assert.ok(!hello.auth?.scopes?.includes("operator.admin"));
  for (const [method, params] of [
    ["openclaw_home_assistant.status", {}],
    ["openclaw_home_assistant.inference.get", {}],
    ["openclaw_home_assistant.inference.update", { expected_revision: "denied", patch: { fast: true } }],
    ["openclaw_home_assistant.diagnostics", {}],
    ["openclaw_home_assistant.pairing.issue", { label: "must not issue" }],
    ["openclaw_home_assistant.clients.list", {}],
    ["openclaw_home_assistant.clients.revoke", { client_id: "00000000-0000-4000-8000-000000000000" }],
    ["openclaw_home_assistant.persistent.rebind", { expected_revision: "must-not-bind", session_key: "must-not-bind" }],
  ]) {
    await assert.rejects(client.request(method, params), /scope|permission|unauthorized|forbidden/i, method);
  }
  console.log(JSON.stringify({ status: "passed", admin_methods_denied: 8, cached_device_auth: false }));
} finally { clearTimeout(timeout); client.stop(); }
