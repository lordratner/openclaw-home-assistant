import test from "node:test";
import assert from "node:assert/strict";
import { resolveProfile } from "../src/profile.mjs";

const context = (cfg = {}) => ({ cfg, agentIds: ["main", "home"],
  normalizeThinking: (value) => ["off", "low", "medium", "high"].includes(value) ? value : undefined });

test("explicit agent is mandatory and missing agents never fall back to main", () => {
  assert.throws(() => resolveProfile({}, context()), /selected_agent_not_found/);
  assert.throws(() => resolveProfile({ agentId: "missing" }, context()), /selected_agent_not_found/);
  assert.equal(resolveProfile({ agentId: "home" }, context()).agentId, "home");
});

test("closed settings reject credentials, unsupported effort, and cross-agent targets", () => {
  for (const extra of [{ apiKey: "not-accepted" }, { conversation: { thinking: "not-real" } },
    { conversation: { fast: "maybe" } }, { persistentSession: "agent:main:shared" },
    { tts: { apiKey: "not-accepted" } }]) {
    assert.throws(() => resolveProfile({ agentId: "home", ...extra }, context()));
  }
});

test("false fast and inherited fields remain distinct in an immutable profile", () => {
  const profile = resolveProfile({ agentId: "home", conversation: { model: "inherit", thinking: "low", fast: false },
    tts: { provider: "unfamiliar-provider", model: "custom", voice: "native-voice-id" } }, context());
  assert.equal(profile.conversation.fast, false);
  assert.equal(profile.conversation.model, undefined);
  assert.equal(profile.tts.provider, "unfamiliar-provider");
  assert.throws(() => { profile.conversation.thinking = "high"; }, TypeError);
});

test("revision follows effective voice/model settings, not provider key rotation", () => {
  const cfg = (voice, apiKey) => ({ tts: { provider: "custom", providers: { custom: { voice, apiKey } } } });
  const a = resolveProfile({ agentId: "home" }, context(cfg("voice-a", "key-a")));
  const b = resolveProfile({ agentId: "home" }, context(cfg("voice-a", "key-b")));
  const c = resolveProfile({ agentId: "home" }, context(cfg("voice-b", "key-b")));
  assert.equal(a.revision, b.revision);
  assert.notEqual(a.revision, c.revision);
  assert.ok(!JSON.stringify(a).includes("key-a"));
});

test("language declarations are bounded and default must be a configured language", () => {
  const profile = resolveProfile({ agentId: "home", languages: ["en", "de-DE"], defaultLanguage: "de-DE" }, context());
  assert.equal(profile.defaultLanguage, "de-DE");
  assert.throws(() => resolveProfile({ agentId: "home", languages: ["en"], defaultLanguage: "de" }, context()), /invalid_default_language/);
  assert.throws(() => resolveProfile({ agentId: "home", languages: ["bad-value-with-too-many-sections-long"] }, context()), /invalid_languages/);
});
