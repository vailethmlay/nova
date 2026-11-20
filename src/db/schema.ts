import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** The single owner of this NOVA instance. The table is role-ready for later. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: createdAt(),
});

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(), // WebAuthn credential ID (base64url)
  userId: uuid("user_id").notNull().references(() => users.id),
  publicKey: text("public_key").notNull(), // base64url
  counter: integer("counter").notNull().default(0),
  transports: text("transports").array(),
  label: text("label"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** Only the SHA-256 of the session token is stored. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Single-use WebAuthn challenges. */
export const authChallenges = pgTable("auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").notNull(), // register | login | approve
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Application registry (brief section 4) plus per-app memory (section 11). */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    repositoryUrl: text("repository_url"),
    techStack: text("tech_stack").notNull().default(""),
    productionUrl: text("production_url"),
    devEnvironment: text("dev_environment").notNull().default(""),
    deploymentProvider: text("deployment_provider").notNull().default(""),
    status: text("status").notNull().default("active"),
    latestVersion: text("latest_version"),
    knownIssues: text("known_issues").notNull().default(""),
    pendingTasks: text("pending_tasks").notNull().default(""),
    roadmap: text("roadmap").notNull().default(""),
    contextNotes: text("context_notes").notNull().default(""),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("applications_slug_idx").on(t.slug)],
);

/** A proposed action awaiting a decision (brief section 7). */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionType: text("action_type").notNull(),
    category: smallint("category").notNull(),
    riskLevel: text("risk_level").notNull(), // low | medium | high
    applicationId: uuid("application_id").references(() => applications.id),
    reason: text("reason").notNull(),
    target: text("target").notNull(),
    affected: text("affected").notNull(),
    consequences: text("consequences").notNull(),
    risks: text("risks").notNull(),
    rollback: text("rollback").notNull(),
    operation: jsonb("operation").notNull(),
    opHash: text("op_hash").notNull(),
    status: text("status").notNull().default("pending"),
    proposedBy: text("proposed_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("proposals_status_idx").on(t.status)],
);

/** An approval binds to one proposal's exact operation hash, expires, and is used once. */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id),
  opHash: text("op_hash").notNull(),
  approvedBy: uuid("approved_by").notNull().references(() => users.id),
  channel: text("channel").notNull(), // dashboard | whatsapp
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Append-only, hash-chained. UPDATE/DELETE are blocked by a trigger (see migrations). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    proposalId: uuid("proposal_id"),
    details: jsonb("details").notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_log_proposal_idx").on(t.proposalId)],
);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").references(() => applications.id),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: createdAt(),
});

/* ---------------- Phase 2: GitHub (read-only) ---------------- */

export const githubRepos = pgTable("github_repos", {
  id: bigint("id", { mode: "number" }).primaryKey(), // GitHub repository id
  fullName: text("full_name").notNull(),
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
  defaultBranch: text("default_branch").notNull().default("main"),
  isPrivate: boolean("is_private").notNull().default(true),
  htmlUrl: text("html_url").notNull(),
  removed: boolean("removed").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    repoId: bigint("repo_id", { mode: "number" }).notNull().references(() => githubRepos.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    state: text("state").notNull(), // open | closed | merged
    draft: boolean("draft").notNull().default(false),
    headRef: text("head_ref").notNull(),
    headSha: text("head_sha").notNull(),
    baseRef: text("base_ref").notNull(),
    htmlUrl: text("html_url").notNull(),
    createdAtGh: timestamp("created_at_gh", { withTimezone: true }).notNull(),
    updatedAtGh: timestamp("updated_at_gh", { withTimezone: true }).notNull(),
  },
  (t) => [index("pull_requests_repo_state_idx").on(t.repoId, t.state)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    repoId: bigint("repo_id", { mode: "number" }).notNull().references(() => githubRepos.id),
    name: text("name").notNull(),
    event: text("event").notNull(),
    status: text("status").notNull(),
    conclusion: text("conclusion"),
    headBranch: text("head_branch"),
    headSha: text("head_sha").notNull(),
    htmlUrl: text("html_url").notNull(),
    createdAtGh: timestamp("created_at_gh", { withTimezone: true }).notNull(),
    updatedAtGh: timestamp("updated_at_gh", { withTimezone: true }).notNull(),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
  },
  (t) => [index("workflow_runs_repo_idx").on(t.repoId, t.updatedAtGh)],
);

export const issues = pgTable(
  "issues",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    repoId: bigint("repo_id", { mode: "number" }).notNull().references(() => githubRepos.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    labels: text("labels").array().notNull().default([]),
    htmlUrl: text("html_url").notNull(),
    updatedAtGh: timestamp("updated_at_gh", { withTimezone: true }).notNull(),
  },
  (t) => [index("issues_repo_state_idx").on(t.repoId, t.state)],
);

export const releases = pgTable("releases", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  repoId: bigint("repo_id", { mode: "number" }).notNull().references(() => githubRepos.id),
  tagName: text("tag_name").notNull(),
  name: text("name"),
  prerelease: boolean("prerelease").notNull().default(false),
  htmlUrl: text("html_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/** Webhook deliveries already processed (GitHub delivery id / WhatsApp message id): drops retries. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(), // "github:<delivery>" | "whatsapp:<wamid>"
  receivedAt: createdAt(),
});

/* ---------------- Phase 2: WhatsApp ---------------- */

/** Single row (id = 1). The owner's WhatsApp id is only set by the one-time linking code. */
export const whatsappLink = pgTable("whatsapp_link", {
  id: smallint("id").primaryKey().default(1),
  ownerWaId: text("owner_wa_id"),
  linkCodeHash: text("link_code_hash"),
  linkCodeExpiresAt: timestamp("link_code_expires_at", { withTimezone: true }),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }), // opens Meta's 24-hour window
});
