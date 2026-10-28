import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateFile } from "../src/state-file.mjs";
import { VoiceClients } from "../src/client-authority.mjs";

async function setup(options = {}) {
  const path = join(await mkdtemp(join(tmpdir(), "voice-auth-")), "state.json");
  const config = { state: new StateFile(path), agentId: "voice", profileId: "default", ...options };
  return { authority: new VoiceClients(config), config, path };
}

test("pairing is one-use and only credential hashes persist", async () => {
  const { authority, path } = await setup();
  const { pairing_code: code } = await authority.issue();
  const client = await authority.claim(code);
  assert.equal((await authority.authenticate(client.client_token, "tts")).id, client.client_id);
  await assert.rejects(authority.claim(code), /invalid_pairing/);
  const state = await readFile(path, "utf8");
  assert.ok(!state.includes(code));
  assert.ok(!state.includes(client.client_token));
  assert.ok(!(await authority.list())[0].tokenHash);
});

test("revocation and changed agent scope reject old clients immediately", async () => {
  const { authority, config } = await setup();
  const { pairing_code } = await authority.issue();
  const client = await authority.claim(pairing_code);
  const different = new VoiceClients({ ...config, agentId: "different" });
  await assert.rejects(different.authenticate(client.client_token, "tts"), /unauthorized/);
  await assert.rejects(authority.authenticate(client.client_token, "operator.admin"), /scope_denied/);
  assert.equal(await authority.revoke(client.client_id), true);
  await assert.rejects(authority.authenticate(client.client_token, "conversation"), /unauthorized/);
});

test("simultaneous claims cannot mint two credentials from one pairing", async () => {
  const { authority } = await setup();
  const { pairing_code } = await authority.issue();
  const values = await Promise.allSettled([authority.claim(pairing_code), authority.claim(pairing_code)]);
  assert.equal(values.filter((value) => value.status === "fulfilled").length, 1);
});

test("expired pairing and bounded client capacity fail without secret-bearing errors", async () => {
  let now = 0;
  const { authority } = await setup({ maxClients: 1, clock: () => now });
  const expired = await authority.issue();
  now = 300001;
  await assert.rejects(authority.claim(expired.pairing_code), /invalid_pairing/);
  const first = await authority.issue();
  await authority.claim(first.pairing_code);
  const second = await authority.issue();
  await assert.rejects(authority.claim(second.pairing_code), /client_capacity/);
});
