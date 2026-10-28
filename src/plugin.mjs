/** Production registration: one explicit HA agent profile, no default selection. */
import { join } from "node:path";
import { OpenClawHost } from "./openclaw-host.mjs";
import { StateFile } from "./state-file.mjs";
import { HomeAssistantService, HTTP_PREFIX } from "./http-service.mjs";
import { ProfileError } from "./profile.mjs";
import { JobError } from "./jobs.mjs";

export default {
  id: "openclaw-home-assistant",
  name: "OpenClaw Home Assistant",
  description: "Home Assistant speech and conversation pipelines using an existing OpenClaw agent",
  register(api) {
    let service = null;
    let startupCode = "backend_starting";
    api.on("before_model_resolve", (event, context) => service?.host.controls.beforeModelResolve(event, context));
    api.on("llm_input", (event, context) => service?.host.observeModel(event, context));
    api.registerHttpRoute({ path: HTTP_PREFIX, auth: "plugin", match: "prefix",
      async handler(request, response) {
        if (service) return await service.handle(request, response);
        response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ code: startupCode }));
        return true;
      },
    });
    const ownerMethod = (name, operation) => api.registerGatewayMethod(name, async ({ params, respond }) => {
      if (!service) { respond(false, undefined, { code: "UNAVAILABLE", message: startupCode }); return; }
      try { respond(true, await operation(params)); }
      catch (error) { respond(false, undefined, { code: "INVALID_REQUEST", message: error.code ?? "invalid_request" }); }
    }, { scope: "operator.admin", profileAccess: "independent" });
    ownerMethod("openclaw_home_assistant.status", async (params) => {
      if (Object.keys(params).length) throw new JobError("unexpected_field");
      return { ready: true, name: "OpenClaw Home Assistant", host_version: api.runtime.version,
        capabilities: service.capabilities(),
        profile: { agent_id: service.profile.agentId, conversation: service.profile.conversation,
          stt: service.profile.stt, tts: service.profile.tts },
        persistent: await service.bindings.describePersistent(true) };
    });
    ownerMethod("openclaw_home_assistant.pairing.issue", async (params) => {
      if (Object.keys(params).some((key) => key !== "label")) throw new JobError("unexpected_field");
      return await service.clients.issue(params.label);
    });
    ownerMethod("openclaw_home_assistant.clients.list", async (params) => {
      if (Object.keys(params).length) throw new JobError("unexpected_field");
      return { clients: await service.clients.list() };
    });
    ownerMethod("openclaw_home_assistant.clients.revoke", async (params) => {
      if (Object.keys(params).length !== 1 || typeof params.client_id !== "string") throw new JobError("invalid_client_id");
      return { revoked: await service.clients.revoke(params.client_id) };
    });
    ownerMethod("openclaw_home_assistant.persistent.rebind", async (params) => {
      if (Object.keys(params).some((key) => !["expected_revision", "session_key"].includes(key)) ||
          typeof params.expected_revision !== "string" || typeof params.session_key !== "string")
        throw new JobError("invalid_persistent_binding");
      return await service.bindings.rebindPersistent({ expectedRevision: params.expected_revision, sessionKey: params.session_key });
    });
    api.registerService({ id: "openclaw-home-assistant",
      reload: { configPrefixes: ["plugins.entries.openclaw-home-assistant", "agents", "tts", "tools.media"] },
      async start(context) {
        const cfg = context.config;
        try {
          if (cfg.plugins?.entries?.[api.id]?.hooks?.allowConversationAccess !== true)
            throw new JobError("conversation_hook_grant_required");
          const raw = cfg.plugins?.entries?.[api.id]?.config ?? api.pluginConfig ?? {};
          const host = new OpenClawHost(api, raw, cfg);
          await host.prepare();
          const state = new StateFile(join(context.stateDir, "plugins", "openclaw-home-assistant", "state.json"));
          service = new HomeAssistantService({ host, state });
          startupCode = null;
          context.serviceHealth?.clearFailure();
        } catch (error) {
          startupCode = error instanceof ProfileError || error instanceof JobError ? error.code : "backend_initialization_failed";
          context.serviceHealth?.reportFailure(new Error(startupCode));
          api.logger.warn("OpenClaw Home Assistant is not ready: " + startupCode);
        }
      },
      async stop() {
        const previous = service;
        service = null;
        startupCode = "backend_stopping";
        if (previous) await previous.stop();
      },
    });
  },
};
