"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { appendAudit } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https?:\/\/\S+$/.test(v), "Must be an http(s) URL");
const text = (max = 4000) => z.string().trim().max(max).default("");

const appSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: text(),
  repositoryUrl: optionalUrl,
  techStack: text(500),
  productionUrl: optionalUrl,
  devEnvironment: text(500),
  deploymentProvider: text(200),
  status: z.enum(["planning", "active", "maintenance", "paused", "retired"]),
  latestVersion: z.string().trim().max(50).transform((v) => v || null),
  knownIssues: text(),
  pendingTasks: text(),
  roadmap: text(),
  contextNotes: text(8000),
});

export type FormState = { error?: string };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";

function parse(form: FormData) {
  return appSchema.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
}

export async function createApp(_: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const input = parse(form);
  if (!input.success) return { error: input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const [row] = await db()
    .insert(applications)
    .values({ ...input.data, slug: slugify(input.data.name) })
    .onConflictDoNothing()
    .returning();
  if (!row) return { error: "An application with that name already exists." };
  await appendAudit(db(), { actor: "owner", event: "application.created", details: { id: row.id, name: row.name } });
  revalidatePath("/apps");
  redirect(`/apps/${row.id}`);
}

export async function updateApp(id: string, _: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  if (!z.string().uuid().safeParse(id).success) return { error: "Unknown application." };
  const input = parse(form);
  if (!input.success) return { error: input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const [before] = await db().select().from(applications).where(eq(applications.id, id));
  if (!before) return { error: "Unknown application." };
  await db()
    .update(applications)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(applications.id, id));
  const changed = Object.keys(input.data).filter(
    (k) => (before as Record<string, unknown>)[k] !== (input.data as Record<string, unknown>)[k],
  );
  await appendAudit(db(), { actor: "owner", event: "application.updated", details: { id, changed } });
  revalidatePath(`/apps/${id}`);
  return {};
}
