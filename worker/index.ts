import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { proxyFirebaseAuthRequest } from "../lib/server/firebase-auth-proxy";
import { verifyGithubNotificationCron } from "../lib/server/notification-cron";
import { dispatchNotifications, flushNotificationDeliveries } from "../lib/server/notification-service";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const path = new URL(request.url).pathname;
    if (path === "/api/internal/notifications/dispatch") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (!(await verifyGithubNotificationCron(request, env))) {
        await request.body?.cancel();
        return json({ error: "Unauthorized" }, 401);
      }
      await request.body?.cancel();
      try { return json(await dispatchNotifications(env)); }
      catch { return json({ error: "Notification dispatch unavailable" }, 503); }
    }
    const authHelper = await proxyFirebaseAuthRequest(request, env);
    if (authHelper) return authHelper;
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    if (response.ok && ((path.startsWith("/api/events") && ["POST", "PATCH", "DELETE"].includes(request.method)) || (path === "/api/notifications" && request.method === "GET"))) {
      ctx.waitUntil(flushNotificationDeliveries(env).catch(() => { /* Durable outbox is retried by the next scheduler tick. */ }));
    }
    return response;
  },
};

export default worker;
