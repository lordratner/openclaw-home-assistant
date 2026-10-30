import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionBindings } from "../src/session-bindings.mjs";
import { StateFile } from "../src/state-file.mjs";
import { Diagnostics } from "../src/observability.mjs";

test("binding reuse and profile rotation have safe milestones without native identity", async () => {
  const fixture = await setup(), diagnostics = new Diagnostics();
  const before = new SessionBindings({ ...fixture.options, diagnostics });
  await before.open(request("PRIVATE_NATIVE_HA_ID", "persistent"));
  await before.open(request("PRIVATE_NATIVE_HA_ID", "persistent"));
  const after = new SessionBindings({ ...fixture.options, profileRevision: "new", diagnostics });
  await after.open(request("PRIVATE_NATIVE_HA_ID", "persistent"));
  const data = diagnostics.snapshot();
  assert.ok(data.recent.some((e) => e.phase === "reused"));
  assert.ok(data.recent.some((e) => e.phase === "rotated" && e.reason === "profile_changed"));
  assert.ok(!JSON.stringify(data).includes("PRIVATE_NATIVE_HA_ID"));
  assert.ok(!JSON.stringify(data).includes([...fixture.sessions.keys()][0]));
});

async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), "voice-state-")), "state.json");
  const sessions = new Map();
  let created = 0;
  const host = {
    async createSession({ agentId, idempotencyKey }) {
      const key = "agent:" + agentId + ":voice:" + idempotencyKey;
      if (!sessions.has(key)) sessions.set(key, { key, sessionId: String(++created), lifecycleRevision: "r1" });
      return sessions.get(key);
    },
    async inspectSession(agentId, key) { return key.startsWith("agent:" + agentId + ":") ? sessions.get(key) : undefined; },
  };
  const options = { agentId: "voice", profileId: "default", profileRevision: "revision-1", state: new StateFile(path), host };
  return { path, host, sessions, options, bindings: new SessionBindings(options), created: () => created };
}
const request = (id, mode = "per_conversation", principal = "client-a") => ({ principal, haConversationId: id, mode });

test("persistent mode atomically creates once and survives process-owner reconstruction", async () => {
  const fixture = await setup();
  const values = await Promise.all(Array.from({ length: 8 }, (_, i) => fixture.bindings.open(request(String(i), "persistent"))));
  assert.equal(fixture.created(), 1);
  assert.equal(new Set(values.map((value) => value.conversation_handle)).size, 8);
  const restarted = new SessionBindings({ ...fixture.options, state: new StateFile(fixture.path) });
  await restarted.open(request("after-restart", "persistent"));
  assert.equal(fixture.created(), 1);
  assert.equal((await stat(fixture.path)).mode & 0o777, 0o600);
});

test("fresh conversation reuses on follow-up but separates histories and callers", async () => {
  const { bindings, created } = await setup();
  const a = await bindings.open(request("a"));
  assert.deepEqual(await bindings.open(request("a")), a);
  const b = await bindings.open(request("b"));
  const other = await bindings.open(request("a", "per_conversation", "client-b"));
  assert.notEqual(a.conversation_handle, b.conversation_handle);
  assert.notEqual(a.conversation_handle, other.conversation_handle);
  assert.equal(created(), 3);
  await assert.rejects(bindings.resolve("client-b", a.conversation_handle), /conversation_not_found/);
});

test("missing or reset persistent history never silently creates a replacement", async () => {
  const { bindings, sessions, created } = await setup();
  const a = await bindings.open(request("a", "persistent"));
  const target = [...sessions.values()][0];
  sessions.set(target.key, { ...target, sessionId: "replacement" });
  await assert.rejects(bindings.resolve("client-a", a.conversation_handle), /session_missing_or_replaced/);
  await assert.rejects(bindings.open(request("b", "persistent")), /session_missing_or_replaced/);
  assert.equal(created(), 1);
});

test("selected agent and profile revisions cannot reinterpret old handles", async () => {
  const fixture = await setup();
  const a = await fixture.bindings.open(request("a"));
  const changed = new SessionBindings({ ...fixture.options, agentId: "different" });
  await assert.rejects(changed.resolve("client-a", a.conversation_handle), /conversation_not_found/);
  const revised = new SessionBindings({ ...fixture.options, profileRevision: "revision-2" });
  await assert.rejects(revised.resolve("client-a", a.conversation_handle), /profile_changed/);
});

test("conversation mode cannot be changed by a follow-up or retry", async () => {
  const { bindings } = await setup();
  await bindings.open(request("a"));
  await assert.rejects(bindings.open(request("a", "persistent")), /conversation_mode_conflict/);
});

test("capacity and idle expiry are bounded without deleting OC history", async () => {
  const fixture = await setup();
  let now = 0;
  const bindings = new SessionBindings({ ...fixture.options, maxBindings: 1, idleTtlMs: 100, clock: () => now });
  const a = await bindings.open(request("a"));
  await assert.rejects(bindings.open(request("b")), /conversation_capacity/);
  now = 101;
  await assert.rejects(bindings.resolve("client-a", a.conversation_handle), /conversation_expired/);
  await bindings.open(request("b"));
  assert.equal(fixture.sessions.size, 2);
});

test("failed metadata commit path rolls back and corrupt state is not replaced", async () => {
  const { path, options } = await setup();
  const state = new StateFile(path);
  await state.transaction((value) => { value.marker = "original"; });
  await assert.rejects(state.transaction((value) => { value.marker = "bad"; throw new Error("rollback"); }));
  assert.equal(JSON.parse(await readFile(path)).state.marker, "original");
  await writeFile(path, "corrupt");
  await assert.rejects(new SessionBindings(options).open(request("a")));
  assert.equal(await readFile(path, "utf8"), "corrupt");
});

test("explicit target missing or cross-agent cannot become an automatic binding", async () => {
  const { options } = await setup();
  const bindings = new SessionBindings({ ...options, persistentSession: "agent:other:foreign" });
  await assert.rejects(bindings.open(request("a", "persistent")), /invalid_session_target/);
});

test("proven native rollover preserves the logical persistent target but ends old HA conversations", async () => {
  const { bindings, sessions, created } = await setup();
  const first = await bindings.open(request("before", "persistent"));
  const original = [...sessions.values()][0];
  sessions.set(original.key, { ...original, sessionId: "rolled", lifecycleRevision: "r2", previousSessionId: original.sessionId });
  const next = await bindings.open(request("after", "persistent"));
  assert.equal((await bindings.resolve("client-a", next.conversation_handle)).target.sessionId, "rolled");
  await assert.rejects(bindings.resolve("client-a", first.conversation_handle), /persistent_binding_changed/);
  assert.equal(created(), 1);
});

test("owner rebind is stale-safe and never changes a fresh conversation's target", async () => {
  const { bindings, host, sessions } = await setup();
  const persistent = await bindings.open(request("persistent", "persistent"));
  const fresh = await bindings.open(request("fresh"));
  const prior = await bindings.describePersistent(true);
  const target = await host.createSession({ agentId: "voice", idempotencyKey: "different" });
  await bindings.rebindPersistent({ expectedRevision: prior.binding_revision, sessionKey: target.key });
  await assert.rejects(bindings.rebindPersistent({ expectedRevision: prior.binding_revision, sessionKey: target.key }), /stale_persistent_binding/);
  await assert.rejects(bindings.resolve("client-a", persistent.conversation_handle), /persistent_binding_changed/);
  assert.ok(await bindings.resolve("client-a", fresh.conversation_handle));
  assert.equal(sessions.size, 3);
});

for (const mode of ["persistent", "per_conversation"]) {
  test(`same native HA ID recovers voice changes and expiry without replacing ${mode} history`, async () => {
    const fixture = await setup();
    let now = 0;
    const options = { ...fixture.options, maxBindings: 1, idleTtlMs: 100, clock: () => now };
    const firstOwner = new SessionBindings(options);
    const first = await firstOwner.open(request("sticky-satellite", mode));
    const target = (await firstOwner.resolve("client-a", first.conversation_handle)).target;
    const newOwner = new SessionBindings({ ...options, profileRevision: "clyde" });
    await assert.rejects(newOwner.resolve("client-a", first.conversation_handle), /profile_changed/);
    const next = await newOwner.open(request("sticky-satellite", mode));
    assert.notEqual(next.conversation_handle, first.conversation_handle);
    assert.deepEqual((await newOwner.resolve("client-a", next.conversation_handle)).target, target);
    assert.deepEqual(await newOwner.open(request("sticky-satellite", mode)), next);
    await assert.rejects(newOwner.resolve("client-a", first.conversation_handle), /conversation_not_found/);
    now = 101;
    const reopened = await newOwner.open(request("sticky-satellite", mode));
    assert.notEqual(reopened.conversation_handle, next.conversation_handle);
    assert.deepEqual((await newOwner.resolve("client-a", reopened.conversation_handle)).target, target);
    assert.equal(fixture.created(), 1);
    await assert.rejects(newOwner.resolve("client-b", reopened.conversation_handle), /conversation_not_found/);
  });
}

test("stale transport recovery cannot repair a missing, changed, or rebound native target", async () => {
  for (const mismatch of ["missing", "replaced", "rebound", "configured"]) {
    const fixture = await setup();
    const before = await fixture.bindings.open(request("sticky", "persistent"));
    const original = [...fixture.sessions.values()][0];
    if (mismatch === "missing") fixture.sessions.delete(original.key);
    if (mismatch === "replaced") fixture.sessions.set(original.key, { ...original, sessionId: "different" });
    if (mismatch === "rebound") {
      const owner = await fixture.bindings.describePersistent();
      const other = await fixture.host.createSession({ agentId: "voice", idempotencyKey: "another" });
      await fixture.bindings.rebindPersistent({ expectedRevision: owner.binding_revision, sessionKey: other.key });
    }
    const bytes = await readFile(fixture.path, "utf8");
    const changed = new SessionBindings({ ...fixture.options, profileRevision: "clyde",
      ...(mismatch === "configured" ? { persistentSession: "agent:voice:another" } : {}) });
    await assert.rejects(changed.open(request("sticky", "persistent")),
      /session_missing_or_replaced|persistent_binding_changed/);
    assert.equal(await readFile(fixture.path, "utf8"), bytes);
    await assert.rejects(changed.open(request("sticky", "per_conversation")), /conversation_mode_conflict/);
    assert.ok(before.conversation_handle);
  }
});

test("concurrent reopen rotates a stale handle once, with no new native session", async () => {
  const fixture = await setup();
  await fixture.bindings.open(request("sticky", "persistent"));
  const changed = new SessionBindings({ ...fixture.options, profileRevision: "clyde" });
  const reopened = await Promise.all(Array.from({ length: 8 }, () => changed.open(request("sticky", "persistent"))));
  assert.equal(new Set(reopened.map((r) => r.conversation_handle)).size, 1);
  assert.equal(fixture.created(), 1);
});
