/** Provider-neutral sentence synthesis through OC's own speech capability API.
 * Native incremental-text providers can be added as a host-adapter strategy.
 * This adapter supports progressive audio per sentence, then buffered sentence
 * fallback. It never replays a partially delivered segment or an agent turn.
 */
export class SpeechStreamError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function checkAbort(signal) { signal?.throwIfAborted(); }
function* boundedBytes(bytes, limit) {
  for (let offset = 0; offset < bytes.length; offset += limit)
    yield bytes.subarray(offset, Math.min(offset + limit, bytes.length));
}

export async function* sentenceSegments(textStream, { maxText = 65536, maxSegment = 600,
  signal } = {}) {
  if (!Number.isInteger(maxSegment) || maxSegment < 16 || !Number.isInteger(maxText) || maxText < maxSegment)
    throw new TypeError("invalid_text_limits");
  let pending = "", total = 0;
  for await (const text of textStream) {
    checkAbort(signal);
    if (typeof text !== "string") throw new SpeechStreamError("invalid_text_chunk");
    total += Buffer.byteLength(text, "utf8");
    if (total > maxText) throw new SpeechStreamError("text_limit");
    pending += text;
    while (pending) {
      const boundary = /[.!?。！？](?:["'”’)]*)(?:\s+|$)|\n/.exec(pending);
      let end = boundary ? boundary.index + boundary[0].length : 0;
      if (!end || end > maxSegment) {
        if (pending.length < maxSegment) break;
        const space = pending.lastIndexOf(" ", maxSegment);
        end = space >= Math.floor(maxSegment / 2) ? space + 1 : maxSegment;
        // Do not split a UTF-16 surrogate pair at a forced length boundary.
        if (/^[\uDC00-\uDFFF]/.test(pending.slice(end))) end--;
      }
      const segment = pending.slice(0, end);
      pending = pending.slice(end);
      if (segment.trim()) yield segment;
    }
  }
  checkAbort(signal);
  if (pending.trim()) yield pending;
}

function unsupported(result) {
  return result?.success === false && result.attempts?.length > 0 &&
    result.attempts.every((attempt) => attempt.outcome === "skipped" &&
      attempt.reasonCode === "unsupported_for_streaming");
}

export async function* speechEvents(textStream, { host, signal, maxAudioBytes = 32 * 1024 * 1024,
  maxChunkBytes = 32768, textLimits = {} }) {
  if (!Number.isInteger(maxAudioBytes) || maxAudioBytes < 1 ||
      !Number.isInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 32768)
    throw new TypeError("invalid_audio_limits");
  let sequence = 0, segment = 0, totalAudio = 0, format;
  let streamingUnsupported = false;
  for await (const text of sentenceSegments(textStream, { ...textLimits, signal })) {
    checkAbort(signal);
    let result, reader;
    const segmentStartBytes = totalAudio;
    try {
      if (!streamingUnsupported) {
        result = await host.stream(text);
        checkAbort(signal);
        if (unsupported(result)) {
          await result.release?.();
          result = undefined;
          streamingUnsupported = true;
        } else if (!result?.success) throw new SpeechStreamError("synthesis_failed");
      }
      const mode = streamingUnsupported ? "sentence_buffered" : "sentence_progressive";
      if (streamingUnsupported) result = await host.buffer(text);
      checkAbort(signal);
      if (!result?.success) throw new SpeechStreamError("synthesis_failed");
      if (!result.outputFormat || !result.fileExtension) throw new SpeechStreamError("missing_audio_format");
      const nextFormat = JSON.stringify([result.outputFormat, result.fileExtension]);
      if (format && format !== nextFormat) throw new SpeechStreamError("audio_format_changed");
      format = nextFormat;
      yield { type: "audio_start", sequence: ++sequence, segment, mode,
        output_format: result.outputFormat, extension: result.fileExtension.replace(/^\./, ""),
        provider: result.provider, model: result.providerModel };
      const emitBytes = function* (bytes) {
        if (!(bytes instanceof Uint8Array)) throw new SpeechStreamError("invalid_audio_chunk");
        totalAudio += bytes.length;
        if (totalAudio > maxAudioBytes) throw new SpeechStreamError("audio_limit");
        for (const part of boundedBytes(bytes, maxChunkBytes)) {
          checkAbort(signal);
          yield { type: "audio_chunk", sequence: ++sequence, segment, bytes: part };
        }
      };
      if (streamingUnsupported) {
        yield* emitBytes(result.audioBuffer);
      } else {
        if (!result.audioStream) throw new SpeechStreamError("missing_audio_stream");
        reader = result.audioStream.getReader();
        const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          while (true) {
            checkAbort(signal);
            const part = await reader.read();
            checkAbort(signal);
            if (part.done) break;
            yield* emitBytes(part.value);
          }
        } finally { signal?.removeEventListener("abort", cancel); }
      }
      if (totalAudio === segmentStartBytes) throw new SpeechStreamError("empty_audio");
      yield { type: "audio_end", sequence: ++sequence, segment };
      segment++;
    } finally {
      // Stream ownership is released on success, failure and early consumer close.
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else await result?.audioStream?.cancel().catch(() => {});
      await result?.release?.();
    }
  }
  checkAbort(signal);
  yield { type: "done", sequence: ++sequence, segments: segment, audio_bytes: totalAudio };
}
