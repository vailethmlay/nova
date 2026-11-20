"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { githubRepos } from "@/db/schema";
import { appendAudit } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { githubApp } from "@/lib/github/client";
import { syncGithub } from "@/lib/github/sync";

export async function linkRepo(form: FormData) {
  await requireSession();
  const repoId = z.coerce.number().int().positive().parse(form.get("repoId"));
  const raw = String(form.get("applicationId") ?? "");
  const applicationId = raw ? z.string().uuid().parse(raw) : null;
  await db().update(githubRepos).set({ applicationId }).where(eq(githubRepos.id, repoId));
  await appendAudit(db(), { actor: "owner", event: "github.repo_linked", details: { repoId, applicationId } });
  revalidatePath("/repos");
}

export async function syncNow() {
  await requireSession();
  const app = githubApp();
  if (!app) return;
  await syncGithub(db(), app);
  revalidatePath("/repos");
  revalidatePath("/");
}
