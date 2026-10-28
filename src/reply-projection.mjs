/** Ordered speakable-text projection. Never exposes reasoning/tool diagnostics. */
import { JobError } from "./jobs.mjs";

export class ReplyProjection {
  #tail = Promise.resolve();
  #messages = [];
  #current = null;
  #emit;
  #bytes = 0;
  constructor(emit) { this.#emit = emit; }
  #enqueue(operation) {
    const task = this.#tail.then(operation);
    this.#tail = task;
    return task;
  }
  start() { return this.#enqueue(() => { this.#current = null; }); }
  async #append(text) {
    if (!text) return;
    this.#bytes += Buffer.byteLength(text);
    if (this.#bytes > 65536) throw new JobError("reply_text_limit");
    if (!this.#current) {
      this.#current = { id: this.#messages.length, text: "" };
      this.#messages.push(this.#current);
    }
    this.#current.text += text;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 2048, text.length);
      if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      await this.#emit({ type: "text_delta", message_id: this.#current.id, text: text.slice(offset, end) });
      offset = end;
    }
  }
  partial(payload) {
    return this.#enqueue(async () => {
      if (payload.isReasoning || payload.isFallbackNotice) return;
      const text = payload.text;
      if (typeof text !== "string") {
        if (typeof payload.delta === "string") await this.#append(payload.delta);
        return;
      }
      const previous = this.#current?.text ?? "";
      if (!text.startsWith(previous)) throw new JobError("non_monotonic_reply");
      await this.#append(text.slice(previous.length));
    });
  }
  final(payload, info) {
    return this.#enqueue(async () => {
      if (payload.isReasoning || payload.isFallbackNotice || info?.kind === "tool") return;
      const text = payload.text;
      if (typeof text !== "string" || !text.trim()) return;
      const current = this.#current?.text ?? "";
      if (current && text.startsWith(current)) { await this.#append(text.slice(current.length)); return; }
      // Final/block delivery can acknowledge a message after a later native
      // message has started. Do not read the completed snapshot a second time.
      if (this.#messages.some((message) => message.text === text)) return;
      const accumulated = this.#messages.map((message) => message.text).join("\n\n");
      if (accumulated === text) return;
      if (!current) { await this.#append(text); return; }
      throw new JobError("reply_projection_conflict");
    });
  }
  async result() {
    await this.#tail;
    return { text: this.#messages.map((message) => message.text).join("\n\n"),
      continue_conversation: false };
  }
}
