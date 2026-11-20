import { webhookDeliveries } from "@/db/schema";
import type { Db } from "@/db/types";

/** Returns true the first time a delivery id is seen; false for retries and replays. */
export async function firstDelivery(db: Db, id: string) {
  const rows = await db.insert(webhookDeliveries).values({ id }).onConflictDoNothing().returning();
  return rows.length > 0;
}
