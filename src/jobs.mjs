/** Durable request receipts + bounded caller-owned stream replay. No agent retries.
 * All public principal parameters come from authenticated server authority.
 * State adapters must serialize across every owner sharing the namespace.
 */
import { randomUUID } from "node:crypto";
import { fingerprint, requestTime } from "./request-identity.mjs";

const terminalStates = new Set(["completed", "failed", "partial_failure", "cancelled", "interrupted"]);
const eventTypes = new Set(["phase", "text_delta", "model", "transcript", "audio_start", "audio_chunk", "audio_end"]);
const stores = globalThis[Symbol.for("openclaw-home-assistant.job-stores.v1")] ??= new Map();
const anonymousStores = globalThis[Symbol.for("openclaw-home-assistant.job-store-identities.v1")] ??= new WeakMap();
export class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class Jobs {
  #live;
  #scope;
  #storeKey;
  #owner = randomUUID();
  #closed = false;

  constructor({ state, agentId, profileId, clock = Date.now, retentionMs = 86400000,
    resultTtlMs = 3600000, maxRecords = 2048, maxActive = 16, maxPerClient = 4,
    maxRetained = 64, replayBytes = 1048576, resultBytes = 1048576,
    maxJobMs = 300000, waitMs = 30000 }) {
    if (!agentId || !profileId || [retentionMs, resultTtlMs, maxRecords, maxActive,
      maxPerClient, maxRetained, replayBytes, resultBytes, maxJobMs, waitMs].some((v) => !Number.isSafeInteger(v) || v < 1) || maxRetained < maxActive)
      throw new TypeError("invalid_job_limits");
    Object.assign(this, { state, clock, retentionMs, resultTtlMs, maxRecords, maxActive,
      maxPerClient, maxRetained, replayBytes, resultBytes, maxJobMs, waitMs });
    this.namespace = "jobs:" + fingerprint([agentId, profileId]);
    let stateIdentity = state.identity ?? anonymousStores.get(state);
    if (!stateIdentity) { stateIdentity = randomUUID(); anonymousStores.set(state, stateIdentity); }
    this.#storeKey = stateIdentity + "\0" + this.namespace;
    this.#scope = stores.get(this.#storeKey) ?? { live: new Map(), admissions: Promise.resolve(), owners: 0 };
    this.#scope.owners++;
    stores.set(this.#storeKey, this.#scope);
    this.#live = this.#scope.live;
  }

  admit({ principal, requestId, kind, payload, profileRevision, run }) {
    const operation = this.#scope.admissions.then(() => this.#admit({ principal, requestId, kind, payload, profileRevision, run }));
    this.#scope.admissions = operation.catch(() => {});
    return operation;
  }

  async lookup({ principal, requestId, kind, payload, profileRevision }) {
    const created = requestTime(requestId);
    if (created > this.clock() + 300000) throw new JobError("request_clock_skew");
    if (this.clock() - created > this.retentionMs) throw new JobError("request_expired");
    const key = fingerprint([principal, requestId]), digest = fingerprint({ kind, payload, profileRevision });
    return this.state.transaction((all) => {
      const records = all[this.namespace] ?? {};
      this.#pruneRecords(records);
      const record = records[key];
      if (!record) return null;
      if (record.digest !== digest) throw new JobError("request_conflict");
      this.#recover(record);
      return { ...this.#public(record), duplicate: true };
    });
  }

  async #admit({ principal, requestId, kind, payload, profileRevision, run }) {
    if (this.#closed) throw new JobError("backend_stopping");
    if (typeof principal !== "string" || !principal || !["turn", "stt", "tts"].includes(kind) ||
        typeof profileRevision !== "string" || !profileRevision || typeof run !== "function") throw new TypeError("invalid_admission");
    const created = requestTime(requestId), now = this.clock();
    if (created > now + 300000) throw new JobError("request_clock_skew");
    if (now - created > this.retentionMs) throw new JobError("request_expired");
    const key = fingerprint([principal, requestId]);
    const digest = fingerprint({ kind, payload, profileRevision });
    const receipt = await this.state.transaction((all) => {
      const records = all[this.namespace] ??= {};
      this.#pruneRecords(records);
      const existing = records[key];
      if (existing) {
        if (existing.digest !== digest) throw new JobError("request_conflict");
        this.#recover(existing);
        return { ...this.#public(existing), duplicate: true };
      }
      const active = [...this.#live.values()].filter((job) => !job.terminal);
      if (active.length >= this.maxActive || active.filter((job) => job.record.principal === principal).length >= this.maxPerClient)
        throw new JobError("job_capacity");
      this.#reap();
      if (Object.keys(records).length >= this.maxRecords) throw new JobError("receipt_capacity");
      const record = { id: randomUUID(), principal, requestId, kind, digest, profileRevision,
        createdAt: now, expiresAt: created + this.retentionMs + 300000, status: "accepted", lastSequence: 0 };
      records[key] = record;
      return { ...this.#public(record), duplicate: false };
    });
    if (!receipt.duplicate) {
      const record = await this.#record(principal, receipt.job_id);
      const job = { key, record, run, owner: this.#owner, controller: new AbortController(), journal: [],
        bytes: 0, sequence: 0, floor: 1, subscribers: new Set(), waiters: new Set(),
        terminal: false, streamClosed: false, producedOutput: false, started: false, emitTail: Promise.resolve(), settled: null };
      job.controller.signal.addEventListener("abort", () => this.#notify(job), { once: true });
      this.#live.set(record.id, job);
    }
    return receipt;
  }

  async #record(principal, id) {
    return this.state.read((all) => {
      const record = Object.values(all[this.namespace] ?? {}).find((value) => value.id === id && value.principal === principal);
      if (!record) throw new JobError("job_not_found");
      return structuredClone(record);
    });
  }

  async status(principal, id) {
    return this.state.transaction((all) => {
      const records = all[this.namespace] ?? {};
      this.#pruneRecords(records);
      const record = Object.values(records).find((value) => value.id === id && value.principal === principal);
      if (!record) throw new JobError("job_not_found");
      this.#recover(record);
      return this.#public(record);
    });
  }

  #recover(record) {
    if (!terminalStates.has(record.status) && !this.#live.has(record.id)) {
      record.status = "interrupted";
      record.code = "execution_outcome_unknown";
      record.cancellation_confirmed = false;
    }
  }

  #public(record) {
    const hasResult = record.result !== undefined && record.resultExpiresAt > this.clock();
    return { job_id: record.id, request_id: record.requestId, kind: record.kind,
      status: record.status, profile_revision: record.profileRevision, expires_at: record.expiresAt,
      partial_output: record.partialOutput === true,
      result_recoverable: hasResult,
      stream_replay_available: this.#live.has(record.id),
      ...(hasResult ? { result: structuredClone(record.result) } : {}),
      ...(record.code ? { code: record.code } : {}),
      ...(record.cancellation_confirmed === undefined ? {} : { cancellation_confirmed: record.cancellation_confirmed }) };
  }

  #pruneRecords(records) {
    const now = this.clock();
    for (const [key, value] of Object.entries(records)) {
      this.#recover(value);
      if (terminalStates.has(value.status) && value.expiresAt < now) delete records[key];
      else if (value.resultExpiresAt <= now) delete value.result;
    }
    let size = Object.values(records).reduce((sum, value) => sum + (value.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(value.result))), 0);
    for (const value of Object.values(records).sort((a, b) => a.createdAt - b.createdAt)) {
      if (size <= this.resultBytes) break;
      if (value.result !== undefined) { size -= Buffer.byteLength(JSON.stringify(value.result)); delete value.result; }
    }
  }

  #reap() {
    const completed = [...this.#live.values()].filter((job) => job.terminal).sort((a, b) => a.record.createdAt - b.record.createdAt);
    for (const job of completed) {
      if (this.#live.size < this.maxRetained && this.clock() - job.record.createdAt < this.resultTtlMs) continue;
      if (job.subscribers.size) continue;
      this.#live.delete(job.record.id);
    }
    if (this.#live.size >= this.maxRetained) throw new JobError("replay_capacity");
  }

  start(principal, id) {
    const job = this.#owned(principal, id);
    if (job.started || job.terminal) return false;
    if (this.#closed && !job.controller.signal.aborted) throw new JobError("backend_stopping");
    job.started = true;
    job.settled = this.#execute(job);
    // #execute handles work errors; storage failure remains observable on wait().
    job.settled.catch(() => {});
    return true;
  }

  #owned(principal, id) {
    const job = this.#live.get(id);
    if (!job || job.record.principal !== principal) throw new JobError("job_not_found");
    return job;
  }

  async #commit(job, patch) {
    await this.state.transaction((all) => {
      const record = all[this.namespace]?.[job.key];
      if (!record || record.id !== job.record.id) throw new JobError("job_receipt_lost");
      if (terminalStates.has(record.status) && patch.status === "cancel_requested") {
        job.record = structuredClone(record); return;
      }
      if (terminalStates.has(record.status) && patch.status !== record.status) throw new JobError("job_already_terminal");
      if (patch.status === "completed") {
        if (record.status === "cancel_requested") throw new JobError("cancel_requested");
        job.controller.signal.throwIfAborted();
      }
      Object.assign(record, patch);
      this.#pruneRecords(all[this.namespace]);
      job.record = structuredClone(record);
    });
  }

  async #execute(job) {
    const timer = setTimeout(() => job.controller.abort(new JobError("job_timeout")), this.maxJobMs);
    try {
      job.controller.signal.throwIfAborted();
      await this.#commit(job, { status: "running" });
      await this.#emit(job, { type: "phase", phase: "running" });
      const output = await job.run({ signal: job.controller.signal, emit: (event) => this.#emit(job, event) });
      await job.emitTail;
      job.controller.signal.throwIfAborted();
      const serialized = JSON.stringify(output?.result ?? null);
      if (Buffer.byteLength(serialized) > 65536) throw new JobError("result_limit");
      await this.#commit(job, { status: "completed", lastSequence: job.sequence,
        ...(output?.result === undefined ? {} : { result: JSON.parse(serialized), resultExpiresAt: this.clock() + this.resultTtlMs }) });
      job.terminal = true;
      // Work completion and delivery completion are different. A slow/closed
      // subscriber can recover the persisted result without dispatching again.
      await this.#append(job, { ...output?.terminal, type: "done" }).catch(() => {});
    } catch (error) {
      await job.emitTail.catch(() => {});
      const aborted = job.controller.signal.aborted;
      const reason = job.controller.signal.reason;
      const cancelled = aborted && reason instanceof JobError && reason.code === "cancel_requested" || error instanceof JobError && error.code === "cancel_requested";
      const code = cancelled ? "cancelled_remote_stop_unconfirmed" : aborted && reason instanceof JobError ? reason.code : error instanceof JobError ? error.code : "job_failed";
      await this.#commit(job, { status: cancelled ? "cancelled" : job.producedOutput ? "partial_failure" : "failed", code,
        lastSequence: job.sequence, partialOutput: job.producedOutput,
        ...(aborted || cancelled ? { cancellation_confirmed: false } : {}) });
      job.terminal = true;
      await this.#append(job, { type: cancelled ? "cancelled" : "error", code }, true).catch(() => {});
    } finally {
      clearTimeout(timer);
      job.run = null;
      job.streamClosed = true;
      this.#notify(job);
      if (!this.#scope.owners) {
        this.#live.delete(job.record.id);
        if (!this.#live.size && stores.get(this.#storeKey) === this.#scope) stores.delete(this.#storeKey);
      }
    }
  }

  #emit(job, event) {
    const operation = job.emitTail.then(async () => {
      job.controller.signal.throwIfAborted();
      if (job.terminal || !eventTypes.has(event?.type)) throw new JobError("invalid_job_event");
      await this.#append(job, event);
    });
    job.emitTail = operation;
    operation.catch((error) => { if (!job.controller.signal.aborted) job.controller.abort(error); });
    return operation;
  }

  async #append(job, event, force = false) {
    const { bytes, ...value } = event;
    const frame = JSON.parse(JSON.stringify({ ...value,
      ...(bytes ? { audio: Buffer.from(bytes).toString("base64") } : {}),
      protocol_major: 1, job_id: job.record.id, request_id: job.record.requestId,
      profile_revision: job.record.profileRevision, sequence: job.sequence + 1 }));
    const size = Buffer.byteLength(JSON.stringify(frame)) + 1;
    if (size > Math.min(65536, this.replayBytes) || job.sequence >= 65536) throw new JobError("event_limit");
    while (job.bytes + size > this.replayBytes) {
      const oldest = job.journal[0];
      if (!oldest) throw new JobError("event_limit");
      if (!force && [...job.subscribers].some((sub) => sub.cursor < oldest.frame.sequence)) {
        await this.#changed(job, job.controller.signal);
        continue;
      }
      job.journal.shift(); job.bytes -= oldest.size; job.floor = oldest.frame.sequence + 1;
    }
    job.sequence++;
    if (["text_delta", "transcript", "audio_chunk"].includes(frame.type)) job.producedOutput = true;
    job.journal.push({ frame, size }); job.bytes += size;
    this.#notify(job);
  }

  #notify(job) { for (const wake of [...job.waiters]) wake(); }

  #changed(job, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); job.waiters.delete(wake); signal?.removeEventListener("abort", abort); };
      const wake = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new JobError("slow_consumer")); }, this.waitMs);
      job.waiters.add(wake); signal?.addEventListener("abort", abort, { once: true });
    });
  }

  events(principal, id, after = 0, signal) {
    signal?.throwIfAborted();
    const job = this.#owned(principal, id);
    if (job.controller.signal.aborted) throw new JobError("job_output_cancelled");
    if (!Number.isSafeInteger(after) || after < 0 || after > job.sequence) throw new JobError("invalid_resume_sequence");
    if (after < job.floor - 1) throw new JobError("replay_gap");
    if (job.subscribers.size >= 2) throw new JobError("subscriber_capacity");
    const sub = { cursor: after, closed: false };
    job.subscribers.add(sub);
    const close = () => { sub.closed = true; job.subscribers.delete(sub); this.#notify(job); };
    return {
      [Symbol.asyncIterator]() { return this; },
      next: async () => {
        try { while (!sub.closed) {
          signal?.throwIfAborted();
          if (job.controller.signal.aborted) throw new JobError("job_output_cancelled");
          if (sub.cursor < job.floor - 1) { close(); throw new JobError("replay_gap"); }
          const next = job.journal.find((item) => item.frame.sequence > sub.cursor);
          if (next) { sub.cursor = next.frame.sequence; this.#notify(job); return { done: false, value: structuredClone(next.frame) }; }
          if (job.streamClosed) { close(); return { done: true, value: undefined }; }
          await this.#changed(job, signal);
        } } catch (error) { close(); throw error; }
        return { done: true, value: undefined };
      },
      return: async () => { close(); return { done: true, value: undefined }; },
    };
  }

  async cancel(principal, id) {
    const job = this.#live.get(id);
    if (!job) return this.status(principal, id);
    if (job.record.principal !== principal) throw new JobError("job_not_found");
    if (job.terminal || terminalStates.has(job.record.status)) return this.status(principal, id);
    // Fence output and signal the owned runner before waiting for storage I/O.
    job.controller.abort(new JobError("cancel_requested"));
    await this.#commit(job, { status: "cancel_requested", cancellation_confirmed: false });
    if (job.record.status !== "cancel_requested") return this.#public(job.record);
    job.controller.abort(new JobError("cancel_requested"));
    if (!job.started) this.start(principal, id);
    this.#notify(job);
    return this.#public(job.record);
  }

  async cancelOwner(principal) {
    return Promise.allSettled([...this.#live.values()]
      .filter((job) => job.record.principal === principal && !job.terminal)
      .map((job) => this.cancel(principal, job.record.id)));
  }

  async wait(principal, id) {
    const job = this.#owned(principal, id);
    if (!job.started) throw new JobError("job_not_started");
    await job.settled;
    return this.status(principal, id);
  }

  async stop() {
    if (this.#closed) return [...this.#live.values()].filter((job) => job.owner === this.#owner && !job.terminal).map((job) => job.record.id);
    this.#closed = true;
    await this.#scope.admissions;
    for (const job of this.#live.values()) {
      if (job.owner === this.#owner && !job.terminal) await this.cancel(job.record.principal, job.record.id);
    }
    this.#scope.owners--;
    if (!this.#scope.owners) {
      for (const job of this.#live.values()) if (job.terminal && !job.subscribers.size) this.#live.delete(job.record.id);
      if (!this.#live.size && stores.get(this.#storeKey) === this.#scope) stores.delete(this.#storeKey);
    }
    // Do not falsely announce remote/provider completion or wait indefinitely.
    return [...this.#live.values()].filter((job) => job.owner === this.#owner && !job.terminal).map((job) => job.record.id);
  }
}
