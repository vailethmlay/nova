import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** Rejects cross-site requests to JSON endpoints (defence in depth on top of SameSite=strict). */
export function sameOrigin(req: Request) {
  return req.headers.get("origin") === new URL(env().NOVA_ORIGIN).origin;
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const forbidden = () => json({ error: "Forbidden" }, 403);
