/** OC-owned session routing. Host operations must enforce the selected agent policy.
 * A state transaction is durable before a handle is returned. History itself stays OC-owned.
 */
import { createHash, randomUUID } from "node:crypto";

const hash = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const requireId = (value) => {
  if (typeof value !== "string" || !value || value.length > 512 || value.trim() !== value)
    throw new TypeError("invalid_identity");
};
const sameTarget = (a, b) => a && b && a.key === b.key && a.sessionId === b.sessionId &&
  a.lifecycleRevision === b.lifecycleRevision;

export class SessionBindingError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class SessionBindings {
  constructor({ agentId, profileId, profileRevision, persistentSession, state, host,
    maxBindings = 1024, idleTtlMs = 900_000, clock = Date.now }) {
    [agentId, profileId, profileRevision].forEach(requireId);
    if (!Number.isInteger(maxBindings) || maxBindings < 1 || idleTtlMs <= 0) throw new TypeError("invalid_limits");
    Object.assign(this, { agentId, profileId, profileRevision, persistentSession,
      state, host, maxBindings, idleTtlMs, clock });
    // Revision changes invalidate handles, but cannot silently rebind the persistent history.
    this.namespace = hash("voice-v1", agentId, profileId);
  }

  async open({ principal, haConversationId, mode }) {
    [principal, haConversationId].forEach(requireId);
    if (!["persistent", "per_conversation"].includes(mode)) throw new SessionBindingError("invalid_mode");
    return this.state.transaction(async (all) => {
      const scope = all[this.namespace] ??= { persistent: null, conversations: {} };
      const key = hash(principal, haConversationId);
      let binding = scope.conversations[key];
      if (binding) {
        if (binding.mode !== mode) throw new SessionBindingError("conversation_mode_conflict");
        if (binding.mode === "persistent" && !sameTarget(binding.target, scope.persistent))
          throw new SessionBindingError("persistent_binding_changed");
        await this.#assertBinding(binding);
        binding.expires = this.clock() + this.idleTtlMs;
        return this.#public(binding);
      }
      // Only expired handles are reclaimed; never delete an OC session/transcript.
      for (const [id, value] of Object.entries(scope.conversations)) {
        if (value.expires <= this.clock()) delete scope.conversations[id];
      }
      if (Object.keys(scope.conversations).length >= this.maxBindings)
        throw new SessionBindingError("conversation_capacity");
      let target;
      if (mode === "persistent") {
        target = scope.persistent;
        if (target && this.persistentSession && target.key !== this.persistentSession) {
          // An explicit owner config selection is a new target, not a reason
          // to create a replacement or rewrite anyone's native session.
          target = await this.host.inspectSession(this.agentId, this.persistentSession);
          this.#validateTarget(target);
          scope.persistent = structuredClone(target);
        }
        if (!target) {
          target = this.persistentSession
            ? await this.host.inspectSession(this.agentId, this.persistentSession)
            : await this.host.createSession({ agentId: this.agentId,
              idempotencyKey: hash(this.namespace, "persistent"), label: "Voice persistent" });
          this.#validateTarget(target);
          scope.persistent = structuredClone(target);
        }
        const current = await this.host.inspectSession(this.agentId, target.key);
        if (current && current.key === target.key && current.previousSessionId === target.sessionId && current.sessionId !== target.sessionId) {
          // Proven native reset/rollover lineage, same logical target. Existing
          // HA conversations retain their old physical target and must end.
          target = current;
          this.#validateTarget(target);
          scope.persistent = structuredClone(target);
        }
      } else {
        target = await this.host.createSession({ agentId: this.agentId,
          idempotencyKey: hash(this.namespace, principal, haConversationId), label: "Voice conversation" });
        this.#validateTarget(target);
      }
      binding = { handle: randomUUID(), principal, haConversationId, mode,
        profileRevision: this.profileRevision, target: structuredClone(target),
        expires: this.clock() + this.idleTtlMs };
      await this.#assertBinding(binding);
      scope.conversations[key] = binding;
      return this.#public(binding);
    });
  }

  async resolve(principal, handle) {
    [principal, handle].forEach(requireId);
    return this.state.transaction(async (all) => {
      const scope = all[this.namespace];
      const binding = Object.values(scope?.conversations ?? {})
        .find((value) => value.handle === handle && value.principal === principal);
      if (!binding) throw new SessionBindingError("conversation_not_found");
      if (binding.mode === "persistent" && !sameTarget(binding.target, scope.persistent))
        throw new SessionBindingError("persistent_binding_changed");
      await this.#assertBinding(binding);
      binding.expires = this.clock() + this.idleTtlMs;
      // Internal only: transport callers must receive #public(), never raw OC keys.
      return structuredClone(binding);
    });
  }

  async close(principal, handle) {
    return this.state.transaction(async (all) => {
      const scope = all[this.namespace];
      if (!scope) return false;
      const found = Object.entries(scope.conversations)
        .find(([, value]) => value.handle === handle && value.principal === principal);
      if (!found) return false;
      delete scope.conversations[found[0]];
      return true;
    });
  }

  async describePersistent(includeTarget = false) {
    const target = await this.state.read((all) => all[this.namespace]?.persistent ?? null);
    if (!target) return { status: this.persistentSession ? "explicit_unvalidated" : "auto_pending", binding_revision: "unbound",
      ...(includeTarget && this.persistentSession ? { session_key: this.persistentSession } : {}) };
    const current = await this.host.inspectSession(this.agentId, target.key);
    return { status: sameTarget(target, current) ? "bound" : current?.previousSessionId === target.sessionId ? "rollover_pending" : "rebind_required",
      binding_revision: hash(target.key, target.sessionId, target.lifecycleRevision),
      ...(includeTarget ? { session_key: target.key } : {}) };
  }

  async rebindPersistent({ expectedRevision, sessionKey }) {
    if (this.persistentSession && sessionKey !== this.persistentSession)
      throw new SessionBindingError("configured_persistent_target_mismatch");
    return this.state.transaction(async (all) => {
      const scope = all[this.namespace] ??= { persistent: null, conversations: {} };
      const prior = scope.persistent;
      const revision = prior ? hash(prior.key, prior.sessionId, prior.lifecycleRevision) : "unbound";
      if (expectedRevision !== revision) throw new SessionBindingError("stale_persistent_binding");
      const target = await this.host.inspectSession(this.agentId, sessionKey);
      this.#validateTarget(target);
      scope.persistent = structuredClone(target);
      return { status: "bound", session_key: target.key,
        binding_revision: hash(target.key, target.sessionId, target.lifecycleRevision) };
    });
  }

  #validateTarget(target) {
    if (!target || typeof target.sessionId !== "string" || !target.sessionId ||
        typeof target.lifecycleRevision !== "string" || !target.lifecycleRevision ||
        !target.key?.startsWith("agent:" + this.agentId + ":"))
      throw new SessionBindingError("invalid_session_target");
  }

  async #assertBinding(binding) {
    if (binding.profileRevision !== this.profileRevision)
      throw new SessionBindingError("profile_changed");
    if (binding.expires <= this.clock()) throw new SessionBindingError("conversation_expired");
    this.#validateTarget(binding.target);
    const current = await this.host.inspectSession(this.agentId, binding.target.key);
    if (!sameTarget(current, binding.target)) throw new SessionBindingError("session_missing_or_replaced");
  }

  #public(binding) {
    return { conversation_handle: binding.handle, mode: binding.mode,
      profile_revision: binding.profileRevision, agent_id: this.agentId };
  }
}
