/** Private plugin metadata and bounded job recovery results, never provider keys
 * or complete agent histories. Writers serialize across instances/generations
 * in the same process. The host must own the state directory exclusively across
 * processes (normal Gateway ownership); cross-process sharing is unsupported.
 */
import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const queueKey = Symbol.for("openclaw-home-assistant.state-queues.v1");
const queues = globalThis[queueKey] ??= new Map();

export class StateFile {
  #queue;
  #path;
  #maxBytes;
  constructor(path, { maxBytes = 8 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("invalid_state_limit");
    this.#path = resolve(path);
    this.#maxBytes = maxBytes;
    this.#queue = queues.get(this.#path) ?? { tail: Promise.resolve() };
    queues.set(this.#path, this.#queue);
  }
  get identity() { return this.#path; }

  async #load() {
    let document;
    try {
      if ((await stat(this.#path)).size > this.#maxBytes) throw new Error("voice_state_capacity");
      document = JSON.parse(await readFile(this.#path, "utf8"));
    }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      document = { version: 1, state: {} };
    }
    if (document.version !== 1 || !document.state || Array.isArray(document.state) ||
        typeof document.state !== "object") throw new Error("invalid_voice_state");
    return document;
  }

  read(reader) {
    const operation = this.#queue.tail.then(async () => reader((await this.#load()).state));
    this.#queue.tail = operation.catch(() => {});
    return operation;
  }

  transaction(update) {
    const operation = this.#queue.tail.then(async () => {
      const document = await this.#load();
      const result = await update(document.state);
      const serialized = JSON.stringify(document);
      if (Buffer.byteLength(serialized) > this.#maxBytes) throw new Error("voice_state_capacity");
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = this.#path + "." + randomUUID() + ".tmp";
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(serialized); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, this.#path);
        const directory = await open(dirname(this.#path), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
      return result;
    });
    // A rejected transaction must not poison subsequent independent operations.
    this.#queue.tail = operation.catch(() => {});
    return operation;
  }
}
