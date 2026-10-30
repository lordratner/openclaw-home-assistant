/** Offline metadata/distribution checks; no install, network or runtime mutation. */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const pkg = json("package.json"), manifest = json("openclaw.plugin.json");
assert.equal(pkg.version, manifest.version);
assert.equal(manifest.id, "openclaw-home-assistant");
assert.ok(manifest.configSchema.required.includes("agentId"));
assert.equal(manifest.configSchema.additionalProperties, false);
assert.ok(pkg.files.includes("src/"));
assert.ok(!pkg.files.some((name) => /node_modules|tests|^\./.test(name)));
for (const file of readdirSync(resolve(root, "src")).filter((name) => name.endsWith(".mjs"))) {
  const source = readFileSync(resolve(root, "src", file), "utf8");
  assert.ok(!/from\s+["']openclaw\/dist\//.test(source), "private OC runtime import: " + file);
  assert.ok(!/from\s+["'](?:elevenlabs|openai|@anthropic-ai\/sdk)["']/.test(source), "private vendor dependency: " + file);
}
console.log(JSON.stringify({ result: "PASS", version: pkg.version, checks: ["metadata", "required-agent", "closed-schema", "distribution-allowlist", "public-sdk-only"] }));
