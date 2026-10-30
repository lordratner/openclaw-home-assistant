/** Public, credential-free stage facts. Unknown is not a provider access test. */
export function languageFacts(profile, stage) {
  const settings = profile[stage] ?? {};
  const languages = [...(settings.languages ?? profile.languages)];
  return { languages, default_language: settings.defaultLanguage ?? profile.defaultLanguage,
    languages_source: "configured" };
}

export function stageFacts({ profile, normalizer, streamStt, batchStt, audioEnabled = true,
  conversation = true, conversationReason = "native_conversation_unavailable", speechProvider, speechConfigured, speechStreaming }) {
  const base = { verified: false, verification: "not_tested", available: null, state: "unknown" };
  const blocked = (reason) => ({ available: false, state: "unavailable", reason });
  const stt = { ...base, ...languageFacts(profile, "stt"),
    modes: [...(streamStt ? ["realtime"] : []), ...(batchStt ? ["batch"] : [])],
    strategy: "auto", batch_selection: profile.stt?.batch?.provider ? "explicit" : profile.stt?.batch ? "native_policy" : "primary_or_native_policy",
    reason: "native_selection_unverified", input: { encoding: "pcm_s16le", sample_rate: 16000, channels: 1 },
    ...(!audioEnabled ? blocked("audio_disabled_by_policy") :
      !batchStt && !streamStt ? blocked("native_stt_unavailable") : {}) };
  const tts = { ...base, ...languageFacts(profile, "tts"), input: "incremental_text", orchestration: "sentence",
    strategy: "auto", output: "capability_dependent", output_formats: ["wav"],
    audio_format: { encoding: "pcm_s16le", sample_rate: 24000, channels: 1, sample_width: 2 },
    fallback: "automatic_capability_only", normalizer_available: normalizer ?? null,
    configured: speechConfigured ?? null, progressive: speechStreaming ?? null,
    ...(speechProvider ? { provider: speechProvider } : {}),
    ...(normalizer === false ? blocked("audio_normalizer_unavailable") :
      speechConfigured === false ? blocked("speech_provider_not_configured") :
      speechConfigured === true ? { state: "configured", reason: "provider_access_unverified" } :
      { reason: "native_selection_unverified" }) };
  return { conversation: { ...base, supported_languages: "*", streaming: "native_or_final",
    tools: "native_agent_policy", ...(!conversation ? blocked(conversationReason) :
      { state: "configured", reason: "provider_access_unverified" }) }, stt, tts };
}
