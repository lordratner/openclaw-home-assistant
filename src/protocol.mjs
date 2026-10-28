/** Bounded NDJSON speech contract, protocol major 1 (pre-release). */
export class ProtocolError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function* readFrames(input, maxLineBytes = 65536) {
  let pending = Buffer.alloc(0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of input) {
    // One incoming network chunk can contain many valid frames. Bound the
    // unfinished frame, not an arbitrary TCP batch of complete frames.
    let rest = Buffer.from(chunk);
    while (rest.length) {
      const end = rest.indexOf(10);
      const part = end < 0 ? rest : rest.subarray(0, end);
      if (pending.length + part.length > maxLineBytes) throw new ProtocolError("frame_limit");
      pending = Buffer.concat([pending, part]);
      if (end < 0) break;
      let frame;
      try { frame = JSON.parse(decoder.decode(pending)); }
      catch { throw new ProtocolError("invalid_json"); }
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new ProtocolError("invalid_frame");
      yield frame;
      pending = Buffer.alloc(0);
      rest = rest.subarray(end + 1);
    }
  }
  if (pending.length) throw new ProtocolError("truncated_frame");
}

function closed(frame, names) {
  if (Object.keys(frame).some((key) => !names.includes(key))) throw new ProtocolError("unexpected_field");
}

export async function readSpeechRequest(input, profileRevision) {
  const frames = readFrames(input)[Symbol.asyncIterator]();
  const { value: first, done } = await frames.next();
  if (done) throw new ProtocolError("missing_start");
  closed(first, ["type", "protocol_major", "request_id", "profile_revision", "language"]);
  if (first.type !== "start" || first.protocol_major !== 1 || first.profile_revision !== profileRevision ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(first.request_id) ||
      typeof first.language !== "string" || !first.language || first.language.length > 32)
    throw new ProtocolError("invalid_start");

  async function* text() {
    let sequence = 0, total = 0, ended = false;
    for await (const frame of { [Symbol.asyncIterator]: () => frames }) {
      if (ended) throw new ProtocolError("frame_after_end");
      if (frame.sequence !== ++sequence) throw new ProtocolError("input_sequence");
      if (frame.type === "end") { closed(frame, ["type", "sequence"]); ended = true; continue; }
      closed(frame, ["type", "sequence", "text"]);
      if (frame.type !== "text" || typeof frame.text !== "string" || Buffer.byteLength(frame.text, "utf8") > 8192)
        throw new ProtocolError("invalid_text");
      total += Buffer.byteLength(frame.text, "utf8");
      if (total > 65536) throw new ProtocolError("text_limit");
      yield frame.text;
    }
    if (!ended) throw new ProtocolError("missing_end");
  }
  return { header: first, text: text() };
}

export async function writeFrame(output, event) {
  if (output.destroyed || output.writableEnded) throw new ProtocolError("output_closed");
  const { bytes, ...value } = event;
  const line = JSON.stringify(bytes ? { ...value, audio: Buffer.from(bytes).toString("base64") } : value) + "\n";
  if (Buffer.byteLength(line) > 65536) throw new ProtocolError("frame_limit");
  if (output.write(line)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { output.off("drain", drain); output.off("close", close); output.off("error", error); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new ProtocolError("output_closed")); };
    const error = () => { cleanup(); reject(new ProtocolError("output_failed")); };
    output.once("drain", drain); output.once("close", close); output.once("error", error);
  });
}
