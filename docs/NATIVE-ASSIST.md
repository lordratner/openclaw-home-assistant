# Native Home Assistant Assist bridge

## Architecture and HA guidance

This paired integration consumes HA's **Assist LLM API**. It is not an MCP client or an SSH controller.

1. Keep `prefer_local_intents` on the chosen HA pipeline for deterministic local handling. The integration does not change any pipeline selection or flags.
2. For forwarded requests, call `ChatLog.async_provide_llm_data(user_input.as_llm_context(DOMAIN), selected_apis, ..., extra_system_prompt)`.
3. Forward the resulting current system prompt and native tools, serialized with HA's `probatio.to_openapi` and API custom serializer. No separate exposed-device list or hand-built intent schema.
4. OpenClaw's public plugin SDK requires statically declared tool names. The declared `home_assistant` tool carries a per-turn `request` union of native `tool_name` / `tool_args` schemas. It is an adapter, not a replacement permission policy. The agent's usual tool policy still applies; grant this plugin/tool to an agent whose allowlist otherwise excludes it.
5. Return tool calls over the paired job stream. HA obtains a one-time pending-call claim, inserts `llm.ToolInput` into its native ChatLog delta stream, and lets HA validate, authorize and execute. Return its native `ToolResultContent.result` to the waiting OpenClaw tool.
6. Stream final agent speech through the existing conversation/TTS path.

The prompt tells the agent to use native HA tools first for home state and actions. Owner-granted MCP, SSH and other tools are independent, remain subject to OpenClaw policy, and are not implemented or selected by this bridge. A native authorization/exposure denial or uncertain action outcome is not permission to bypass HA. Preference is agent guidance, not a claim to sandbox arbitrary owner-granted tools.

### Exact-schema discovery (plugin dev.4)

Some model-facing tool renderers omit nested argument details even though the
runtime retains and validates the original native schema. Never interpret
`tool_args: unknown` as accepting arbitrary arguments. The same turn-bound
`home_assistant` tool accepts **exactly one** of:

- `{describe: "<current native tool name>"}`: returns that tool's current
  `{name, description, parameters}` unchanged as JSON; no HA execution event,
  claim, effect, or action-budget consumption.
- `{request: {tool_name: "<current native tool name>", tool_args: {...}}}`:
  unchanged native execution path, including the original per-tool union schema.

Discovery uses the same agent/session/incarnation lease, cancellation and stale
invocation checks as execution. It cannot describe unselected tools or revive a
closed turn. Do not combine `describe` and `request`. Read the schema when a
renderer omits detail; for example native intent `domain` is an array, whereas
the live-context filter may accept either a string or an array. Do not copy MCP
argument types. No HA integration update or protocol change is required.

For a persistent voice agent with old MCP examples, inspect the current tool
catalog before home requests. The presence of the turn-bound native tool, not
an old conversation's tool list, establishes its availability. The exact
namespace belongs to the host; suffix discovery avoids bare-name mismatches.
Ordinary model choice still requires real-agent acceptance testing; synthetic
round trips do not establish that behavioral result.

HA ChatLog retains native tool traces; OpenClaw remains the agent-history owner. Only the current HA system context is forwarded, not a duplicate complete chat history. This is a native tool-execution callback, not resubmission of natural language to the same Assist conversation agent (which would recurse).

### Clarification and follow-up listening (plugin dev.5)

Spoken questions alone do not instruct a satellite to listen again. The separate
turn-bound `voice_conversation({continue_conversation: true})` tool records that
the final voice reply needs an answer. It is available on HA-originated voice
turns even when Device control is disabled; it does not grant device control.
The normal OpenClaw tool policy still applies. An explicit tool allowlist must
permit `voice_conversation` (or this plugin); never change that policy silently.

The turn prompt requires this call before a clarification, followed by the
spoken question. Listening defaults to false on every new turn, including a
follow-up. Completed answers, stop requests and quoted/rhetorical questions do
not request more listening. Calling with false reverses a true decision within
the same turn. An empty reply always returns false. The bridge does not infer
intent from question marks, embed control markers in speech, or enable an
unbounded microphone mode.

The decision uses the existing `continue_conversation` boolean in both the
terminal event and durable result, including retry/recovery. HA's conversation
entity passes it to `ConversationResult`; HA and the satellite own re-listening.
The tool is fenced by the opaque run binding, agent/session/incarnation, host
invocation check, cancellation and lease closure. No continuation decision is
inherited from persistent chat history. No HA update or protocol change is
needed. The model must actually choose the tool; an isolated deterministic
proof cannot establish real-model behavior or physical microphone rearming.

Guidance:
- https://contributors.home-assistant.io/core/entities/conversation/
- https://contributors.home-assistant.io/core/internals/llm-api/

Checked against HA 2026.10.4 and OpenClaw 2026.10.3, using existing local test environments. No provider-specific SDK or OpenClaw core changes.

## Configuration

In HA integration options select **Home Assistant control → Device control** (`llm_hass_api: ["assist"]`). Leave it empty for an agent without native home access. Existing entries are not silently granted control. The current bridge deliberately offers only Assist, not HA's administrative API.

The companion plugin must advertise `assist_tools.version=1`; selecting control against an older plugin fails before agent dispatch, without falling back to MCP. The native tool is available only in an active HA-originated turn with an opaque runtime binding matching agent, session and session incarnation. It is absent from unrelated chats and cannot be retained after the turn. Persistent transcripts do not preserve its execution authority.

## Protocol 1.1 additions

- Capabilities: `assist_tools: {version: 1, max_calls: 20, execution: "home_assistant", transport: "job_events"}`.
- Optional `assist: {prompt, tools: [{name, description, parameters}]}` in `POST /turns`. Included in immutable request fingerprint; never stored as raw context in durable job receipts/diagnostics. May appear in normal agent/model context and HA/OC conversation traces.
- Job event `tool_call: {call_id, tool_name, tool_args}`. It has the standard job/request/revision/sequence envelope.
- `POST /jobs/{job_id}/tool-claim` with `{call_id}`: requires the authenticated owning client, a running turn and pending unclaimed call. Returns `{claimed:true}` exactly once. HA MUST claim before effect execution; failed/lost claim acknowledgment must not execute the action.
- `POST /jobs/{job_id}/tool-results` with `{call_id, data, error}`: requires the owning active call; exact duplicate results are idempotent while the turn remains active, conflicting results fail. Model receives native data and error classification.
- Replayed events in the same HA turn reuse the recorded result, never execute again. A fresh process must not execute old events: no durable pending-action reconstruction is provided. The usual job result recovery is output recovery, not action replay.
- A claim is admission, not atomic completion: cancellation after HA has admitted an effect cannot undo it. No exactly-once physical-action guarantee is claimed across crashes. Uncertain actions are never automatically retried. Pairing revocation, cancellation, session invalidation and turn close fence future calls.
- Limits: 256 tool definitions; 128 KiB prompt; 1 MiB bundle; 32 KiB arguments; 60,000-byte result; 20 calls; 60-second tool wait (within existing 5-minute job lifetime). Oversized bundles fail closed; results exceeding the bound return an explicit error advising against repetition.

## Verification and release boundary

The local matrix uses real HA native intent/exposure/chat-log execution and a disposable real OpenClaw Gateway with a deterministic synthetic model. It proves exposed effects, hidden denial, original HA context, revocation after prompt construction, cached replay, cross-client result rejection, unknown tool rejection, cancellation/timeout fencing, and absent/older native bridge behavior. Existing speech/session/inference tests remain in the regression suite.

This is not a real-provider reasoning, microphone latency or live satellite measurement. Installing both candidate packages, enabling Device control and granting the native tool to the configured agent is a separate activation step. Preserve the original pipelines, exposed-entity settings, agent tools, pairing and inference preferences. Do not remove the existing Jarvis MCP wrapper as part of this change.
