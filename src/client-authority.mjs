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
  constructor({ state, agentId, profileId, clock = Date.now, maxClients = 16 }) {
    if (!agentId || !profileId || !Number.isInteger(maxClients) || maxClients < 1)
      throw new TypeError("invalid_authority_config");
    Object.assign(this, { state, agentId, profileId, clock, maxClients });
    this.namespace = "clients:" + digest(JSON.stringify([agentId, profileId]));
  }

  async issue(label = "Home Assistant") {
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

  async revoke(principal) {
    return this.state.transaction((all) => {
      const scope = all[this.namespace];
      if (!scope?.clients[principal]) return false;
      delete scope.clients[principal];
      return true;
    });
  }
}
