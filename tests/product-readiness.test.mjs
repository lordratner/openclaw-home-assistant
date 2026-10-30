import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageFacts } from "../src/stage-readiness.mjs";
import { OpenClawHost } from "../src/openclaw-host.mjs";
import { HomeAssistantService } from "../src/http-service.mjs";
import { StateFile } from "../src/state-file.mjs";
import { resolveProfile } from "../src/profile.mjs";

const profile = { id: "default", agentId: "voice", revision: "r1", conversation: {}, stt: {}, tts: {}, languages: ["en"], defaultLanguage: "en" };

test("missing normalizer blocks only TTS; configured does not falsely verify account access", () => {
  const stages = stageFacts({ profile, normalizer: false, streamStt: false, batchStt: true,
    speechProvider: "unfamiliar", speechConfigured: true });
  assert.equal(stages.tts.available, false);
  assert.equal(stages.tts.reason, "audio_normalizer_unavailable");
  assert.notEqual(stages.conversation.available, false);
  assert.deepEqual(stages.stt.modes, ["batch"]);
  assert.equal(stages.stt.verified, false);
  const ready = stageFacts({ profile, normalizer: true, batchStt: true, speechConfigured: true });
  assert.equal(ready.tts.state, "configured");
  assert.equal(ready.tts.verified, false);
  assert.equal(ready.tts.available, null);
});

test("missing conversation hook grant leaves speech/control capability available", () => {
  const facts = stageFacts({ profile, normalizer: true, batchStt: true,
    conversation: false, conversationReason: "conversation_hook_grant_required", speechConfigured: true });
  assert.equal(facts.conversation.available, false);
  assert.equal(facts.conversation.reason, "conversation_hook_grant_required");
  assert.notEqual(facts.stt.available, false);
  assert.notEqual(facts.tts.available, false);
});

test("real missing-ffmpeg preparation succeeds in degraded mode without breaking control startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "ha-ready-"));
  const host = Object.assign(Object.create(OpenClawHost.prototype), { tempRoot: root });
  const old = process.env.PATH;
  try { process.env.PATH = ""; await host.prepare(); assert.equal(host.normalizerAvailable, false); }
  finally { process.env.PATH = old; await rm(root, { recursive: true, force: true }); }
});

test("stable backend/profile identity survives credentials/profile revision changes and separates agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "ha-identity-"));
  const state = new StateFile(join(root, "state.json"));
  const make = (agentId = "voice", revision = "r1") => new HomeAssistantService({
    state, host: { profile: { ...profile, agentId, revision }, close() {} } });
  try {
    const first = make(); await first.initialize();
    const [one, two] = [make("voice", "r2"), make()];
    await Promise.all([one.initialize(), two.initialize()]);
    assert.deepEqual(first.capabilities().service, one.capabilities().service);
    assert.deepEqual(first.capabilities().service, two.capabilities().service);
    const other = make("other"); await other.initialize();
    assert.equal(first.identity.instance_id, other.identity.instance_id);
    assert.notEqual(first.identity.profile_id, other.identity.profile_id);
    const client = await first.clients.claim((await first.clients.issue()).pairing_code);
    assert.equal((await one.clients.authenticate(client.client_token, "conversation")).id, client.client_id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("identity corruption fails closed and does not publish a replacement identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "ha-identity-bad-"));
  const state = new StateFile(join(root, "state.json"));
  await state.transaction((all) => { all["service_identity:v1"] = { instance_id: "invalid", profiles: {} }; });
  const service = new HomeAssistantService({ state, host: { profile, close() {} } });
  try { await assert.rejects(service.initialize(), /invalid_service_identity/); assert.equal(service.identity, undefined); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("stage languages validate independently and preserve the legacy default", () => {
  const p = resolveProfile({ agentId: "voice", stt: { languages: ["de-DE"] },
    tts: { languages: ["en", "fr-FR"], defaultLanguage: "fr-FR" } },
  { cfg: {}, agentIds: ["voice"], normalizeThinking: (v) => v });
  const stages = stageFacts({ profile: p, normalizer: true, batchStt: true });
  assert.equal(stages.stt.default_language, "de-DE");
  assert.equal(stages.tts.default_language, "fr-FR");
  assert.equal(p.defaultLanguage, "en");
  assert.throws(() => resolveProfile({ agentId: "voice", stt: { batch: { model: "orphan" } } },
    { cfg: {}, agentIds: ["voice"], normalizeThinking: (v) => v }), /stt_provider_required_for_model/);
});

test("crash cleanup removes old generated audio only, retaining recent work, unrelated files and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "ha-cleanup-"));
  const outside = await mkdtemp(join(tmpdir(), "ha-outside-"));
  try {
    for (const name of ["stt-abcdef", "stt-recent", "unrelated"]) await mkdir(join(root, name));
    await writeFile(join(root, "stt-abcdef", "utterance.wav"), "old private audio");
    await writeFile(join(outside, "keep"), "outside");
    await symlink(outside, join(root, "stt-linked"));
    const old = new Date(Date.now() - 172800000); await utimes(join(root, "stt-abcdef"), old, old);
    await OpenClawHost.prototype.cleanStaleAudio.call({ tempRoot: root });
    await assert.rejects(lstat(join(root, "stt-abcdef")), { code: "ENOENT" });
    assert.ok((await lstat(join(root, "stt-recent"))).isDirectory());
    assert.ok((await lstat(join(root, "unrelated"))).isDirectory());
    assert.equal(await readFile(join(outside, "keep"), "utf8"), "outside");
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
