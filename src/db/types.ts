import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Works for both the production driver (postgres-js) and the test driver (PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
