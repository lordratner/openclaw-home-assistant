/** Single-owner private metadata store. No provider credentials or transcript content.
 * Host adapter must allocate an exclusive plugin-owned directory. Cross-process
 * sharing is deliberately unsupported; use a host transactional store for that.
 */
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class StateFile {
  #tail = Promise.resolve();
  #path;
  constructor(path) { this.#path = path; }

  async #load() {
    let document;
    try { document = JSON.parse(await readFile(this.#path, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      document = { version: 1, state: {} };
    }
    if (document.version !== 1 || !document.state || Array.isArray(document.state) ||
        typeof document.state !== "object") throw new Error("invalid_voice_state");
    return document;
  }

  read(reader) {
    const operation = this.#tail.then(async () => reader((await this.#load()).state));
    this.#tail = operation.catch(() => {});
    return operation;
  }

  transaction(update) {
    const operation = this.#tail.then(async () => {
      const document = await this.#load();
      const result = await update(document.state);
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = this.#path + "." + randomUUID() + ".tmp";
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(document)); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, this.#path);
        const directory = await open(dirname(this.#path), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
      return result;
    });
    // A rejected transaction must not poison subsequent independent operations.
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
