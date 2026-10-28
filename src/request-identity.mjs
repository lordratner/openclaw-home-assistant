/** UUIDv7 request identities provide bounded, non-replayable retention windows. */
import { createHash, randomBytes } from "node:crypto";

export function requestId(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) throw new TypeError("invalid_time");
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requestTime(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))
    throw new TypeError("invalid_request_id");
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}

export function fingerprint(value) {
  const encode = (item, depth = 0) => {
    if (depth > 16) throw new TypeError("request_too_deep");
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return "[" + item.map((v) => encode(v, depth + 1)).join(",") + "]";
    if (item && typeof item === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(item)))
      return "{" + Object.keys(item).sort().map((key) => JSON.stringify(key) + ":" + encode(item[key], depth + 1)).join(",") + "}";
    throw new TypeError("non_json_request");
  };
  return createHash("sha256").update(encode(value)).digest("hex");
}
