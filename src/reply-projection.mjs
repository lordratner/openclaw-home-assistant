/** Ordered speakable-text projection. Never exposes reasoning/tool diagnostics. */
import { JobError } from "./jobs.mjs";

export class ReplyProjection {
  #tail = Promise.resolve();
  #messages = [];
  #current = null;
  #emit;
  #bytes = 0;
  #notices = new Set();
  #errorReply = false;
  constructor(emit, { diagnostics } = {}) { this.#emit = emit; this.diagnostics = diagnostics; }
  get errorReply() { return this.#errorReply; }
  #notice(payload, info) {
    const reason = payload.isReasoning ? "reasoning_filtered" : payload.isFallbackNotice ? "fallback_notice_filtered" : info?.kind === "tool" ? "tool_result_filtered" : null;
    if (reason && !this.#notices.has(reason)) {
      this.#notices.add(reason);
      this.diagnostics?.event("projection", "filter", "suppressed", { reason });
    }
    if (payload.isError === true && !this.#errorReply && !reason) {
      this.#errorReply = true;
      this.diagnostics?.event("conversation", "native_reply", "failed", { reason: "native_reply_error", error_reply: true }, "warn");
    }
  }
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
      this.#notice(payload);
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
      this.#notice(payload, info);
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
  async result({ continueConversation = false } = {}) {
    await this.#tail;
    const text = this.#messages.map((message) => message.text).join("\n\n");
    return { text, continue_conversation: continueConversation === true && !!text.trim() };
  }
}
