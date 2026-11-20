import { destroySession } from "@/lib/auth/session";
import { forbidden, json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  await destroySession();
  return json({ ok: true });
}
