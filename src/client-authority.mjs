/** Plugin-scoped client identities, not OC owner/operator or provider credentials.
 * Only an authenticated owner/admin adapter may expose issue/list/revoke.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const compare = (a, b) => typeof a === "string" && /^[a-f0-9]{64}$/.test(a) &&
  timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

export class ClientAuthorityError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class VoiceClients {
  #leases = new Map();
  #revocations = new Set();
  #closed = false;
  constructor({ state, agentId, profileId, clock = Date.now, maxClients = 16 }) {
    if (!agentId || !profileId || !Number.isInteger(maxClients) || maxClients < 1)
      throw new TypeError("invalid_authority_config");
    Object.assign(this, { state, agentId, profileId, clock, maxClients });
    this.namespace = "clients:" + digest(JSON.stringify([agentId, profileId]));
  }

  async issue(label = "Home Assistant") {
    if (this.#closed) throw new ClientAuthorityError("backend_stopping");
    if (typeof label !== "string" || !label.trim() || label.length > 80)
      throw new ClientAuthorityError("invalid_client_label");
    const code = secret();
    const expires = this.clock() + 300_000;
    await this.state.transaction((all) => {
      const scope = all[this.namespace] ??= { pairs: {}, clients: {} };
      for (const [hash, pair] of Object.entries(scope.pairs)) {
        if (pair.expires <= this.clock()) delete scope.pairs[hash];
      }
      if (Object.keys(scope.pairs).length >= 8) throw new ClientAuthorityError("pairing_capacity");
      scope.pairs[digest(code)] = { label: label.trim(), expires };
    });
    return { pairing_code: code, expires_at: expires };
  }

  async claim(code) {
    if (this.#closed) throw new ClientAuthorityError("backend_stopping");
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code))
      throw new ClientAuthorityError("invalid_pairing");
    const token = secret(), principal = randomUUID();
    await this.state.transaction((all) => {
      const scope = all[this.namespace];
      const pair = scope?.pairs[digest(code)];
      if (!pair || pair.expires <= this.clock()) throw new ClientAuthorityError("invalid_pairing");
      if (Object.keys(scope.clients).length >= this.maxClients) throw new ClientAuthorityError("client_capacity");
      delete scope.pairs[digest(code)];
      scope.clients[principal] = { tokenHash: digest(token), label: pair.label,
        createdAt: this.clock(), scopes: ["conversation", "stt", "tts"] };
    });
    return { client_id: principal, client_token: token, agent_id: this.agentId };
  }

  async authenticate(token, scope) {
    if (this.#closed) throw new ClientAuthorityError("unauthorized");
    if (!["conversation", "stt", "tts", "capabilities"].includes(scope))
      throw new ClientAuthorityError("scope_denied");
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new ClientAuthorityError("unauthorized");
    return this.state.read((all) => {
      const hash = digest(token);
      const client = Object.entries(all[this.namespace]?.clients ?? {})
        .find(([, value]) => compare(value.tokenHash, hash));
      if (!client || scope !== "capabilities" && !client[1].scopes.includes(scope))
        throw new ClientAuthorityError("unauthorized");
      return Object.freeze({ id: client[0], agentId: this.agentId, profileId: this.profileId });
    });
  }

  async list() {
    return this.state.read((all) => Object.entries(all[this.namespace]?.clients ?? {})
      .map(([id, value]) => ({ client_id: id, label: value.label, created_at: value.createdAt })));
  }

  async authorize(token, scope) {
    const identity = await this.authenticate(token, scope);
    const leases = this.#leases.get(identity.id) ?? new Set();
    if (leases.size >= 16) throw new ClientAuthorityError("client_request_capacity");
    const controller = new AbortController();
    leases.add(controller); this.#leases.set(identity.id, leases);
    const release = () => { leases.delete(controller); if (!leases.size) this.#leases.delete(identity.id); };
    try {
      // Close the authenticate/register race with a durable revocation.
      await this.authenticate(token, scope);
      if (this.#closed) throw new ClientAuthorityError("unauthorized");
      controller.signal.throwIfAborted();
    } catch (error) { release(); throw error; }
    return Object.freeze({ ...identity, signal: controller.signal, release,
      assertCurrent: () => controller.signal.throwIfAborted() });
  }

  onRevoke(listener) { this.#revocations.add(listener); return () => this.#revocations.delete(listener); }

  async revoke(principal) {
    const revoked = await this.state.transaction((all) => {
      const scope = all[this.namespace];
      if (!scope || !Object.hasOwn(scope.clients, principal)) return false;
      delete scope.clients[principal];
      return true;
    });
    if (revoked) {
      for (const controller of this.#leases.get(principal) ?? []) controller.abort(new ClientAuthorityError("client_revoked"));
      await Promise.allSettled([...this.#revocations].map((listener) => listener(principal)));
    }
    return revoked;
  }

  close() {
    this.#closed = true;
    for (const leases of this.#leases.values()) for (const controller of leases)
      controller.abort(new ClientAuthorityError("backend_stopping"));
    this.#leases.clear(); this.#revocations.clear();
  }
}
