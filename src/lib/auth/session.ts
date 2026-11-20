import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { sha256Hex } from "@/lib/canonical";
import { env } from "@/lib/env";

const COOKIE = "nova_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db().insert(sessions).values({ id: sha256Hex(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: env().NOVA_ORIGIN.startsWith("https://"),
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ userId: sessions.userId, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

/** For pages and server actions: sends anyone without a valid session to /login. */
export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  jar.delete(COOKIE);
}
