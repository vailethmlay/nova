import { z } from "zod";

const optional = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NOVA_ORIGIN: z.string().url(),
  NOVA_RP_ID: z.string().min(1),
  NOVA_SETUP_TOKEN: z.string().min(24, "NOVA_SETUP_TOKEN must be at least 24 characters"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),

  // GitHub App (read-only permissions). All four are needed to enable GitHub.
  GITHUB_APP_ID: optional,
  GITHUB_APP_SLUG: optional,
  GITHUB_APP_PRIVATE_KEY_BASE64: optional,
  GITHUB_WEBHOOK_SECRET: optional,

  // WhatsApp Cloud API (Meta). All five are needed to enable WhatsApp.
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_ALERT_TEMPLATE: optional,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
  WHATSAPP_API_VERSION: z.string().default("v25.0"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Validated lazily so `next build` works without secrets present. Server-only. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function githubConfig() {
  const e = env();
  if (!e.GITHUB_APP_ID || !e.GITHUB_APP_PRIVATE_KEY_BASE64 || !e.GITHUB_WEBHOOK_SECRET) return null;
  return {
    appId: e.GITHUB_APP_ID,
    slug: e.GITHUB_APP_SLUG,
    privateKey: Buffer.from(e.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    webhookSecret: e.GITHUB_WEBHOOK_SECRET,
  };
}

export function whatsappConfig() {
  const e = env();
  if (
    !e.WHATSAPP_PHONE_NUMBER_ID ||
    !e.WHATSAPP_ACCESS_TOKEN ||
    !e.WHATSAPP_APP_SECRET ||
    !e.WHATSAPP_VERIFY_TOKEN ||
    !e.WHATSAPP_ALERT_TEMPLATE
  )
    return null;
  return {
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: e.WHATSAPP_ACCESS_TOKEN,
    appSecret: e.WHATSAPP_APP_SECRET,
    verifyToken: e.WHATSAPP_VERIFY_TOKEN,
    alertTemplate: e.WHATSAPP_ALERT_TEMPLATE,
    templateLanguage: e.WHATSAPP_TEMPLATE_LANGUAGE,
    apiVersion: e.WHATSAPP_API_VERSION,
    origin: e.NOVA_ORIGIN,
  };
}
