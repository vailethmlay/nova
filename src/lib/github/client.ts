import { App } from "octokit";
import { githubConfig } from "@/lib/env";

let app: App | null = null;

/** The read-only GitHub App client, or null when GitHub isn't configured. Holds no write permissions. */
export function githubApp(): App | null {
  const cfg = githubConfig();
  if (!cfg) return null;
  if (!app) app = new App({ appId: cfg.appId, privateKey: cfg.privateKey, webhooks: { secret: cfg.webhookSecret } });
  return app;
}
