import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";
import type { Db } from "./types";

const globalForDb = globalThis as unknown as { novaDb?: Db };

export function db(): Db {
  if (!globalForDb.novaDb) {
    const client = postgres(env().DATABASE_URL, { max: 10 });
    globalForDb.novaDb = drizzle(client, { schema }) as unknown as Db;
  }
  return globalForDb.novaDb;
}
