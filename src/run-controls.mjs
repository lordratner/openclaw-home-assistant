/** Exact owned-run inference controls. No session metadata is mutated. */
export class VoiceRunControls {
  #runs = new Map();

  admit({ runId, agentId, sessionKey, model, thinking, fast }) {
    for (const [key, value] of Object.entries({ runId, agentId, sessionKey })) {
      if (typeof value !== "string" || !value || value.trim() !== value) {
        throw new TypeError(key + " must be a non-empty canonical string");
      }
    }
    if (this.#runs.has(runId)) throw new Error("run_already_admitted");
    if (model !== undefined &&
        (!model || typeof model.provider !== "string" || !model.provider ||
         typeof model.id !== "string" || !model.id)) {
      throw new TypeError("model must be an already resolved provider/id");
    }
    if (thinking !== undefined && (typeof thinking !== "string" || !thinking)) {
      throw new TypeError("thinking must be a host-validated preference");
    }
    if (fast !== undefined && ![true, false, "auto", "ultrafast"].includes(fast)) {
      throw new TypeError("invalid fast preference");
    }
    const lease = Object.freeze({ runId });
    const controller = new AbortController();
    const entry = {
      lease, agentId, sessionKey, controller,
      model: model && Object.freeze({ ...model }), thinking, fast,
    };
    this.#runs.set(runId, entry);
    return Object.freeze({
      lease,
      replyOptions: Object.freeze({
        runId,
        abortSignal: controller.signal,
        ...(thinking === undefined ? {} : { thinkingLevelOverride: thinking }),
        ...(fast === undefined ? {} : { fastModeOverride: fast }),
      }),
    });
  }

  beforeModelResolve(_event, context) {
    const entry = this.#runs.get(context?.runId);
    if (!entry || entry.controller.signal.aborted ||
        context.agentId !== entry.agentId ||
        context.sessionKey !== entry.sessionKey || !entry.model) return undefined;
    return { providerOverride: entry.model.provider, modelOverride: entry.model.id };
  }

  cancel(lease, reason = "voice_cancelled") {
    const entry = this.#runs.get(lease?.runId);
    if (!entry || entry.lease !== lease) return false;
    entry.controller.abort(new Error(reason));
    return true;
  }

  release(lease) {
    const entry = this.#runs.get(lease?.runId);
    if (!entry || entry.lease !== lease) return false;
    this.#runs.delete(lease.runId);
    return true;
  }

  close() {
    for (const entry of this.#runs.values()) entry.controller.abort(new Error("plugin_closed"));
    this.#runs.clear();
  }

  get activeCount() { return this.#runs.size; }
}
