/** Production registration: one explicit HA agent profile, no default selection. */
import { join } from "node:path";
import { OpenClawHost } from "./openclaw-host.mjs";
import { StateFile } from "./state-file.mjs";
import { HomeAssistantService, HTTP_PREFIX } from "./http-service.mjs";
import { ProfileError } from "./profile.mjs";
import { JobError } from "./jobs.mjs";
import { Diagnostics } from "./observability.mjs";

export default {
  id: "openclaw-home-assistant",
  name: "OpenClaw Home Assistant",
  description: "Home Assistant speech and conversation pipelines using an existing OpenClaw agent",
  register(api) {
    const diagnostics = new Diagnostics({ logger: api.logger });
    diagnostics.event("service", "registration", "started", {}, "info");
    let service = null;
    let startupCode = "backend_starting";
    api.on("before_model_resolve", (event, context) => service?.host.controls.beforeModelResolve(event, context));
    api.registerTool({ contextVersion: 2, create: (ctx) => service?.host.assist.factory(ctx) },
      { name: "home_assistant" });
    api.registerTool({ contextVersion: 2, create: (ctx) => service?.host.continuation.factory(ctx) },
      { name: "voice_conversation" });
    api.on("before_prompt_build", (event, context) => {
      const parts = [service?.host.continuation.prompt(event, context), service?.host.assist.prompt(event, context)]
        .map((part) => part?.appendSystemContext).filter(Boolean);
      return parts.length ? { appendSystemContext: parts.join("\n\n") } : undefined;
    });
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
      if (!service && name !== "openclaw_home_assistant.diagnostics") { respond(false, undefined, { code: "UNAVAILABLE", message: startupCode }); return; }
      try { respond(true, await diagnostics.trace("admin", name.replace("openclaw_home_assistant.", ""), () => operation(params))); }
      catch (error) { respond(false, undefined, { code: "INVALID_REQUEST", message: error.code ?? "invalid_request" }); }
    }, { scope: "operator.admin", profileAccess: "independent" });
    ownerMethod("openclaw_home_assistant.status", async (params) => {
      if (Object.keys(params).length) throw new JobError("unexpected_field");
      const inference = await service.inference.get();
      return { ready: true, name: "OpenClaw Home Assistant", host_version: api.runtime.version,
        capabilities: service.capabilities(),
        profile: { agent_id: service.profile.agentId, conversation: inference.effective,
          stt: service.profile.stt, tts: service.profile.tts },
        inference,
        persistent: await service.bindings.describePersistent(true) };
    });
    ownerMethod("openclaw_home_assistant.inference.get", async (params) => {
      if (Object.keys(params).length) throw new JobError("unexpected_field");
      return service.inference.get();
    });
    ownerMethod("openclaw_home_assistant.inference.update", async (params) => {
      if (Object.keys(params).some((key) => !["expected_revision", "patch"].includes(key))) throw new JobError("unexpected_field");
      return service.updateInference(params);
    });
    ownerMethod("openclaw_home_assistant.diagnostics", async (params) => {
      if (Object.keys(params).some((key) => key !== "limit")) throw new JobError("unexpected_field");
      if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 32)) throw new JobError("invalid_diagnostic_limit");
      const collected = service ? await diagnostics.collect({
        inference: () => service.inference.get(), jobs: () => service.jobs.diagnostics(params.limit),
      }) : { values: {}, unavailable_sections: [] };
      return { ready: !!service, ...(startupCode ? { startup_code: startupCode } : {}),
        partial: collected.unavailable_sections.length > 0, unavailable_sections: collected.unavailable_sections,
        inference: collected.values.inference ?? null, jobs: collected.values.jobs ?? [],
        observability: diagnostics.snapshot() };
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
      reload: { configPrefixes: ["plugins.entries.openclaw-home-assistant", "agents", "tts", "tools.media", "models", "auth"] },
      async start(context) {
        return diagnostics.trace("service", "startup", async (span) => {
          span.phase("configuration_received");
          const cfg = context.config;
          try {
            const raw = cfg.plugins?.entries?.[api.id]?.config ?? api.pluginConfig ?? {};
            const host = new OpenClawHost(api, raw, cfg, diagnostics);
            await host.prepare();
            const state = new StateFile(join(context.stateDir, "plugins", "openclaw-home-assistant", "state.json"));
            const candidate = new HomeAssistantService({ host, state });
            await candidate.initialize();
            service = candidate;
            span.phase("ready");
            startupCode = null;
            context.serviceHealth?.clearFailure();
          } catch (error) {
            startupCode = error instanceof ProfileError || error instanceof JobError ? error.code : "backend_initialization_failed";
            span.fail(error, { stage: "startup" });
            context.serviceHealth?.reportFailure(new Error(startupCode));
          }
        });
      },
      async stop() {
        return diagnostics.trace("service", "shutdown", async (span) => {
          span.phase("shutdown_requested");
          const previous = service;
          service = null;
          startupCode = "backend_stopping";
          try {
            const result = previous ? await previous.stop() : null;
            span.phase("locally_stopped", { count: result?.cancellation_unconfirmed_jobs ?? 0, confirmed: false });
          } catch (error) { span.fail(error, { stage: "shutdown" }); throw error; }
        });
      },
    });
  },
};
