/** Closed, credential-free configuration for one Home Assistant agent profile. */
import { fingerprint } from "./request-identity.mjs";
export class ProfileError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const object = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new ProfileError("invalid_profile_fields");
  return value;
};
const optional = (value, max = 512) => {
  if (value === undefined || value === "inherit") return undefined;
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > max)
    throw new ProfileError("invalid_profile_value");
  return value;
};
const pick = (value, keys) => Object.fromEntries(keys.flatMap((key) => value?.[key] === undefined ? [] : [[key, value[key]]]));

export function resolveProfile(raw, { cfg, agentIds, normalizeThinking }) {
  object(raw, ["agentId", "persistentSession", "conversation", "stt", "tts", "languages", "defaultLanguage"]);
  const agentId = optional(raw.agentId, 128);
  if (!agentId || !agentIds.includes(agentId)) throw new ProfileError("selected_agent_not_found");
  const conversation = object(raw.conversation ?? {}, ["model", "thinking", "fast"]);
  const stt = object(raw.stt ?? {}, ["provider", "model", "language"]);
  const tts = object(raw.tts ?? {}, ["provider", "model", "voice"]);
  if (optional(stt.model) && !optional(stt.provider)) throw new ProfileError("stt_provider_required_for_model");
  const model = optional(conversation.model);
  const thinking = optional(conversation.thinking, 32);
  if (thinking && normalizeThinking(thinking) !== thinking) throw new ProfileError("invalid_thinking_level");
  const fast = conversation.fast === "inherit" ? undefined : conversation.fast;
  if (fast !== undefined && ![true, false, "auto", "ultrafast"].includes(fast)) throw new ProfileError("invalid_fast_mode");
  const languages = raw.languages ?? ["en"];
  if (!Array.isArray(languages) || !languages.length || languages.length > 100 ||
      languages.some((value) => typeof value !== "string" || value.length > 32 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)))
    throw new ProfileError("invalid_languages");
  const defaultLanguage = raw.defaultLanguage ?? languages[0];
  if (!languages.includes(defaultLanguage)) throw new ProfileError("invalid_default_language");
  const persistentSession = optional(raw.persistentSession);
  if (persistentSession && !persistentSession.startsWith("agent:" + agentId + ":"))
    throw new ProfileError("persistent_agent_mismatch");
  const profile = { id: "default", agentId, ...(persistentSession ? { persistentSession } : {}),
    conversation: { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}), ...(fast === undefined ? {} : { fast }) },
    stt: Object.fromEntries(["provider", "model", "language"].flatMap((key) => optional(stt[key]) ? [[key, stt[key]]] : [])),
    tts: Object.fromEntries(["provider", "model", "voice"].flatMap((key) => optional(tts[key]) ? [[key, tts[key]]] : [])),
    languages: [...new Set(languages)], defaultLanguage };
  // Hash only voice-relevant, non-secret authored settings, not resolved keys.
  const nativeFacts = {
    agent: pick(cfg.agents?.entries?.[agentId], ["model", "voiceModel", "thinkingDefault", "fastMode"]),
    defaults: pick(cfg.agents?.defaults, ["model", "voiceModel", "thinkingDefault", "fastMode"]),
    tts: { ...pick(cfg.tts, ["provider", "persona"]), providers: Object.fromEntries(
      Object.entries(cfg.tts?.providers ?? {}).map(([id, value]) => [id, pick(value,
        ["model", "modelId", "voice", "voiceId", "responseFormat", "outputFormat", "speed", "languageCode"])])) },
    audio: pick(cfg.tools?.media?.audio, ["enabled", "preferredModel", "language"]),
    audioModels: (cfg.tools?.media?.models ?? []).map((value) => pick(value, ["provider", "model", "capabilities"])),
  };
  profile.revision = fingerprint({ schema: 1, profile, nativeFacts });
  Object.freeze(profile.conversation); Object.freeze(profile.stt); Object.freeze(profile.tts); Object.freeze(profile.languages);
  return Object.freeze(profile);
}
