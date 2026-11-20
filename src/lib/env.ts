import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NOVA_ORIGIN: z.string().url(),
  NOVA_RP_ID: z.string().min(1),
  NOVA_SETUP_TOKEN: z.string().min(24, "NOVA_SETUP_TOKEN must be at least 24 characters"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
});

let cached: z.infer<typeof schema> | null = null;

/** Validated lazily so `next build` works without secrets present. Server-only. */
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
