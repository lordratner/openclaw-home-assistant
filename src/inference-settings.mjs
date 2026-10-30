/** Owner-managed next-turn preferences. Never mutates agent/session defaults. */
import { fingerprint } from "./request-identity.mjs";

export class SettingsError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fields = ["model", "thinking", "fast"];
export function normalizeConversation(raw = {}, normalizeThinking = (value) => value) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some((key) => !fields.includes(key))) throw new SettingsError("invalid_inference_settings");
  const result = {};
  for (const key of fields) {
    const value = raw[key];
    if (value === undefined || value === "inherit") continue;
    if (key === "fast") {
      if (![true, false, "auto", "ultrafast"].includes(value)) throw new SettingsError("invalid_fast_mode");
    } else if (typeof value !== "string" || !value || value.trim() !== value ||
        value.length > (key === "model" ? 512 : 32) || /[\x00-\x1f\x7f]/.test(value)) {
      throw new SettingsError("invalid_inference_settings");
    } else if (key === "thinking" && normalizeThinking(value) !== value) {
      throw new SettingsError("invalid_thinking_level");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

export class InferenceSettings {
  constructor({ state, agentId, profileId, defaults = {}, validate = async (value) => value }) {
    this.state = state;
    this.defaults = { model: "inherit", thinking: "inherit", fast: "inherit", ...defaults };
    this.namespace = "inference:" + fingerprint([agentId, profileId]);
    this.validate = validate;
  }
  #view(record) {
    if (record && (record.version !== 1 || !Number.isSafeInteger(record.generation) || record.generation < 1 ||
        !record.overrides || typeof record.overrides !== "object" || Array.isArray(record.overrides) ||
        Object.keys(record.overrides).some((key) => !fields.includes(key)))) throw new SettingsError("invalid_inference_state");
    const overrides = record?.overrides ?? {};
    const effective = { ...this.defaults, ...overrides };
    normalizeConversation(effective);
    return { revision: fingerprint({ defaults: this.defaults, overrides, generation: record?.generation ?? 0 }),
      defaults: { ...this.defaults }, overrides: { ...overrides }, effective,
      source: Object.keys(overrides).length ? "owner_override" : "bootstrap", applies_to: "next_admitted_turn" };
  }
  async get() { return this.state.read((all) => this.#view(all[this.namespace])); }
  async snapshot() {
    const view = await this.get();
    const conversation = await this.validate(normalizeConversation(view.effective));
    return Object.freeze({ revision: view.revision, conversation: Object.freeze({ ...conversation }) });
  }
  async update({ expected_revision, patch }, { validateTarget } = {}) {
    if (typeof expected_revision !== "string" || !patch || typeof patch !== "object" || Array.isArray(patch) ||
        !Object.keys(patch).length || Object.keys(patch).some((key) => !fields.includes(key)))
      throw new SettingsError("invalid_inference_update");
    return this.state.transaction(async (all) => {
      const current = this.#view(all[this.namespace]);
      if (expected_revision !== current.revision) throw new SettingsError("stale_inference_settings");
      const overrides = { ...current.overrides };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete overrides[key];
        else overrides[key] = value;
      }
      const candidate = { version: 1, generation: (all[this.namespace]?.generation ?? 0) + 1, overrides };
      const view = this.#view(candidate);
      const conversation = await this.validate(normalizeConversation(view.effective));
      // Callers must not re-enter StateFile from this callback.
      await validateTarget?.(conversation, all);
      all[this.namespace] = candidate;
      return view;
    });
  }
}
