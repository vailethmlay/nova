/**
 * NOVA background worker. Runs separately from the web app: `npm run worker`.
 * Phase 2 jobs: a read-only GitHub resync every 15 minutes (webhooks keep data fresh in between).
 * Holds no write credentials.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db/types";
import { env } from "../src/lib/env";
import { githubApp } from "../src/lib/github/client";
import { syncGithub } from "../src/lib/github/sync";
import { logger } from "../src/lib/logger";

const SYNC = "github-sync";

async function main() {
  const { DATABASE_URL } = env();
  const db = drizzle(postgres(DATABASE_URL, { max: 5 }), { schema }) as unknown as Db;
  const boss = new PgBoss(DATABASE_URL);
  boss.on("error", (e) => logger.error({ err: e.message }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(SYNC);
  await boss.schedule(SYNC, "*/15 * * * *");
  await boss.work(SYNC, async () => {
    const app = githubApp();
    if (!app) return logger.info("GitHub not configured; skipping sync");
    const r = await syncGithub(db, app);
    logger.info(r, "github sync done");
  });
  await boss.send(SYNC, {}, { singletonKey: "startup" }); // sync once on start
  logger.info("NOVA worker started");
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, "worker crashed");
  process.exit(1);
});
