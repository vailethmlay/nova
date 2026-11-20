import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { chat } from "@/lib/chat";
import { forbidden, json, sameOrigin } from "@/lib/http";
import { logger } from "@/lib/logger";

const body = z.object({
  message: z.string().trim().min(1).max(8000),
  applicationId: z.string().uuid().nullish(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await getSession())) return forbidden();
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: "Bad request." }, 400);
  try {
    return json({ reply: await chat(input.data.message, input.data.applicationId ?? null) });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "chat failed");
    return json({ error: "NOVA couldn't answer right now. Try again shortly." }, 502);
  }
}
