/** Explicit, ephemeral listening intent. Never controls a microphone directly. */
import { randomUUID } from "node:crypto";
import { JobError } from "./jobs.mjs";
import { Diagnostics } from "./observability.mjs";

export const CONTINUATION_BINDING = "openclaw-home-assistant-continuation";
export const CONTINUATION_TOOL = "voice_conversation";

export class VoiceContinuation {
  #runs = new Map();
  constructor({ diagnostics = new Diagnostics() } = {}) { this.diagnostics = diagnostics; }

  open({ agentId, sessionKey, sessionId, runId, signal }) {
    const token = randomUUID();
    const entry = { agentId, sessionKey, sessionId, runId, signal, continuing: false };
    this.#runs.set(token, entry);
    return { token,
      continuing: () => this.#runs.get(token) === entry && !signal.aborted && entry.continuing,
      close: () => this.#runs.delete(token),
    };
  }

  prompt(_event, ctx) {
    const entry = [...this.#runs.values()].find((run) => !run.signal.aborted &&
      run.runId === ctx.runId && run.agentId === ctx.agentId && run.sessionKey === ctx.sessionKey &&
      (!ctx.sessionId || run.sessionId === ctx.sessionId));
    if (!entry) return;
    return { appendSystemContext: "This is a Home Assistant voice turn. " +
      "Before asking a clarification or other question that requires the user's reply, call " +
      "voice_conversation with {continue_conversation:true}, then speak the question in your final answer. " +
      "Discover the current tool by its voice_conversation suffix (code-mode may namespace it as openclaw__voice_conversation). " +
      "This tells HA to listen for the answer after playback; asking a question in text alone does not. " +
      "Continuation defaults to false on EVERY turn, including a follow-up. For a completed answer or " +
      "an explicit stop/end request, leave it false (or set false to undo a true decision made this turn). " +
      "Do not request more listening for rhetorical/quoted questions or gratuitous 'anything else?' prompts. " +
      "This tool changes only this response's listening intent, not device permissions or conversation history. " +
      "If it is unavailable or denied, do not claim you will keep listening; tell the user to repeat the wake word." };
  }

  factory(ctx) {
    const token = ctx.toolBindings?.[CONTINUATION_BINDING];
    const entry = this.#runs.get(token);
    if (!entry || entry.signal.aborted || ctx.agentId !== entry.agentId ||
        ctx.sessionKey !== entry.sessionKey || ctx.sessionId !== entry.sessionId) return null;
    return { name: CONTINUATION_TOOL, label: "Voice conversation follow-up",
      description: "Set whether HA should listen for the user's answer after this voice reply. " +
        "Call with true BEFORE a clarification/question that needs an answer, then speak that question. " +
        "Defaults to false on each turn. False cancels a prior true for this turn. " +
        "Does not execute HA actions, grant permissions, or change session history.",
      parameters: { type: "object", additionalProperties: false, required: ["continue_conversation"],
        properties: { continue_conversation: { type: "boolean",
          description: "True only when this reply needs a spoken answer; false for completion or stop." } } },
      execute: (_id, params, signal) => this.diagnostics.trace("continuation", "decision", async (span) => {
        ctx.assertInvocationCurrent?.();
        if (this.#runs.get(token) !== entry || entry.signal.aborted || signal?.aborted)
          throw new JobError("voice_turn_closed");
        if (!params || typeof params !== "object" || Array.isArray(params) ||
            Object.keys(params).length !== 1 || typeof params.continue_conversation !== "boolean")
          throw new JobError("invalid_voice_continuation");
        entry.continuing = params.continue_conversation;
        span.phase("listening_intent", { continuing: entry.continuing });
        const data = { continue_conversation: entry.continuing };
        return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
      }),
    };
  }

  close() { this.#runs.clear(); }
}
