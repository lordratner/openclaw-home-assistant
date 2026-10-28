/** One canonical WAV/PCM stream across native provider/container boundaries.
 * Decoding is provider-neutral. No vendor SDK, repeated WAV headers, silent
 * format guessing, shell interpolation, or full-response audio buffering.
 */
import { spawn } from "node:child_process";
import { JobError } from "./jobs.mjs";
import { speechEvents } from "./speech-stream.mjs";

const formats = { mp3: "mp3", wav: "wav", flac: "flac", ogg: "ogg", opus: "ogg", aac: "aac", m4a: "mov", webm: "matroska", aiff: "aiff" };

export function streamWavHeader() {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(0xffffffff, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(0xffffffff, 40);
  return header;
}

/** Read bounded WAV metadata before choosing a raw decoder. FFmpeg's WAV
 * demuxer probes 64 KiB for SPDIF even for extensible PCM. Removing the WAV
 * wrapper avoids that wait WITHOUT guessing sample format from a vendor.
 * Other WAV codecs/containers still use the native container decoder.
 */
class WaveInput {
  pending = Buffer.alloc(0);
  ready = false;
  format = null;
  remaining = null;
  sampleBytes = 0;
  seen = 0;
  push(bytes) {
    if (this.ready) return this.payload(bytes);
    this.pending = Buffer.concat([this.pending, bytes]);
    const b = this.pending;
    if (b.length < 12) return Buffer.alloc(0);
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return this.fallback();
    this.format = null; // A fragmented header is reparsed from its bounded prefix.
    let offset = 12;
    while (offset + 8 <= b.length) {
      const kind = b.toString("ascii", offset, offset + 4);
      const size = b.readUInt32LE(offset + 4);
      if (kind === "data") {
        if (!this.format) throw new JobError("invalid_audio_header");
        this.ready = true;
        this.remaining = size === 0xffffffff ? null : size;
        this.pending = null;
        return this.payload(b.subarray(offset + 8));
      }
      if (offset + 8 + size + (size % 2) > 65536) throw new JobError("audio_header_limit");
      if (offset + 8 + size + (size % 2) > b.length) break;
      if (kind === "fmt ") {
        if (this.format || size < 16) throw new JobError("invalid_audio_header");
        let tag = b.readUInt16LE(offset + 8);
        const channels = b.readUInt16LE(offset + 10), rate = b.readUInt32LE(offset + 12);
        const align = b.readUInt16LE(offset + 20), bits = b.readUInt16LE(offset + 22);
        if (tag === 0xfffe) {
          if (size < 40 || b.readUInt16LE(offset + 24) < 22) throw new JobError("invalid_audio_header");
          if (b.subarray(offset + 36, offset + 48).toString("hex") !== "00001000800000aa00389b71" ||
              ![0, bits].includes(b.readUInt16LE(offset + 26))) return this.fallback();
          tag = b.readUInt32LE(offset + 32);
        }
        const raw = tag === 1 ? { 8: "u8", 16: "s16le", 24: "s24le", 32: "s32le" }[bits]
          : tag === 3 ? { 32: "f32le", 64: "f64le" }[bits] : undefined;
        if (!raw) return this.fallback();
        if (!channels || channels > 64 || !rate || rate > 768000 || align !== channels * bits / 8 ||
            b.readUInt32LE(offset + 16) !== rate * align) throw new JobError("invalid_audio_header");
        this.format = { raw, channels, rate };
        this.sampleBytes = align;
      }
      offset += 8 + size + (size % 2);
    }
    if (b.length > 65536) throw new JobError("audio_header_limit");
    return Buffer.alloc(0);
  }
  fallback() {
    this.ready = true;
    this.format = null;
    this.sampleBytes = 0;
    const bytes = this.pending;
    this.pending = null;
    return bytes;
  }
  payload(bytes) {
    if (this.remaining !== null) {
      bytes = bytes.subarray(0, this.remaining);
      this.remaining -= bytes.length;
    }
    this.seen += bytes.length;
    return bytes;
  }
  finish() {
    if (!this.ready || (this.remaining !== null && this.remaining !== 0) ||
        (this.sampleBytes && this.seen % this.sampleBytes)) throw new JobError("incomplete_audio_segment");
  }
}

async function write(input, bytes) {
  if (input.destroyed) throw new JobError("audio_decoder_closed");
  if (input.write(bytes)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { input.off("drain", drain); input.off("error", error); input.off("close", error); };
    const drain = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new JobError("audio_decoder_closed")); };
    input.once("drain", drain); input.once("error", error); input.once("close", error);
  });
}

function decoder(extension, signal, binary, pcm) {
  const format = formats[extension];
  if (!format) throw new JobError(extension === "pcm" ? "raw_audio_metadata_required" : "unsupported_audio_container");
  const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
    "-protocol_whitelist", "pipe", "-probesize", "32", "-analyzeduration", "0", "-blocksize", "4096", "-f", format,
    ...(pcm ? ["-f", pcm.raw, "-ar", String(pcm.rate), "-ac", String(pcm.channels)] : []),
    "-i", "pipe:0", "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "24000",
    "-c:a", "pcm_s16le", "-flush_packets", "1", "-f", "s16le", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdin.on("error", () => {});
  // Never forward provider-controlled decoder stderr or retain unbounded logs.
  child.stderr.resume();
  let killTimer;
  const kill = () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
  };
  const done = new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new JobError(error.code === "ENOENT" ? "audio_normalizer_unavailable" : "audio_decode_failed")));
    child.once("close", (code) => {
      clearTimeout(killTimer);
      signal.removeEventListener("abort", kill);
      code === 0 ? resolve() : reject(new JobError("audio_decode_failed"));
    });
  });
  done.catch(() => {});
  if (signal.aborted) kill(); else signal.addEventListener("abort", kill, { once: true });
  return { child, done, kill };
}

export async function* canonicalSpeech(text, { host, signal, binary = "ffmpeg", maxBytes = 32 * 1024 * 1024 }) {
  const local = new AbortController();
  const combined = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
  const source = speechEvents(text, { host, signal: combined, allowFormatChange: true });
  let current, pump;
  let sequence = 0, bytes = 0, segments = 0, started = false, mode;
  try {
    while (true) {
      combined.throwIfAborted();
      const next = await source.next();
      if (next.done) throw new JobError("incomplete_synthesis");
      const event = next.value;
      if (event.type === "done") {
        if (started) yield { type: "audio_end", sequence: ++sequence, segment: 0 };
        yield { type: "done", sequence: ++sequence, segments: started ? 1 : 0, provider_segments: segments, audio_bytes: bytes };
        return;
      }
      if (event.type !== "audio_start") throw new JobError("invalid_synthesis_sequence");
      mode ??= event.mode;
      const prefix = event.extension === "wav" ? new WaveInput() : null;
      let initial;
      if (prefix) {
        while (!prefix.ready) {
          const input = await source.next();
          if (input.done || input.value.segment !== event.segment || input.value.type !== "audio_chunk")
            throw new JobError("incomplete_audio_segment");
          initial = prefix.push(Buffer.from(input.value.bytes));
        }
      }
      current = decoder(event.extension, combined, binary, prefix?.format);
      const active = current;
      let decoded = 0;
      pump = (async () => {
        if (initial?.length) await write(active.child.stdin, initial);
        while (true) {
          combined.throwIfAborted();
          const input = await source.next();
          if (input.done || input.value.segment !== event.segment) throw new JobError("incomplete_audio_segment");
          if (input.value.type === "audio_end") {
            prefix?.finish();
            active.child.stdin.end(); return;
          }
          if (input.value.type !== "audio_chunk") throw new JobError("invalid_synthesis_sequence");
          const bytes = prefix ? prefix.push(Buffer.from(input.value.bytes)) : input.value.bytes;
          if (bytes.length) await write(active.child.stdin, bytes);
        }
      })();
      pump.catch((error) => { local.abort(error); active.kill(); });
      active.done.catch((error) => { local.abort(error); });
      for await (const chunk of active.child.stdout) {
        combined.throwIfAborted();
        if (!chunk.length) continue;
        decoded += chunk.length;
        const parts = !started ? Buffer.concat([streamWavHeader(), chunk]) : chunk;
        if (!started) {
          started = true;
          yield { type: "audio_start", sequence: ++sequence, segment: 0, extension: "wav",
            output_format: "pcm_s16le", sample_rate: 24000, channels: 1, sample_width: 2,
            mode, provider: event.provider, model: event.model, normalization: "native_container_to_pcm" };
        }
        for (let offset = 0; offset < parts.length; offset += 32768) {
          const part = parts.subarray(offset, offset + 32768);
          bytes += part.length;
          if (bytes > maxBytes) throw new JobError("audio_limit");
          yield { type: "audio_chunk", sequence: ++sequence, segment: 0, bytes: part };
        }
      }
      await pump; pump = null;
      await active.done;
      if (!decoded || decoded % 2) throw new JobError("empty_decoded_audio");
      current = null;
      segments++;
    }
  } finally {
    local.abort(new JobError("audio_stream_closed"));
    current?.kill();
    await pump?.catch(() => {});
    await current?.done.catch(() => {});
    await source.return();
  }
}
