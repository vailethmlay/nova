import { z } from "zod";

/**
 * Every action NOVA knows about, with a fixed category (brief section 7).
 *
 * Category 1 actions are read-only and never need approval, so they are not listed here.
 * Category 2 actions need a specific, time-limited, single-use approval.
 * Category 3 actions are prohibited: they have no schema and no executor, so no code path
 * can run them however NOVA is asked.
 */
export type RiskLevel = "low" | "medium" | "high";

type ActionDef<S extends z.ZodType> = {
  category: 2;
  title: string;
  defaultRisk: RiskLevel;
  operation: S;
};

const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/name");
const sha = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full 40-character commit SHA");

export const ACTIONS = {
  /** Harmless action for testing the approval loop end to end. Its executor only writes to the audit log. */
  "system.test_approval": {
    category: 2,
    title: "Test the approval workflow (no side effects)",
    defaultRisk: "low",
    operation: z.object({ note: z.string().max(200) }).strict(),
  },
  /** First real write action (Phase 4). Bound to the PR head commit so new pushes void the approval. */
  "github.merge_pull_request": {
    category: 2,
    title: "Merge a pull request",
    defaultRisk: "medium",
    operation: z
      .object({
        repository: repo,
        pullNumber: z.number().int().positive(),
        headSha: sha,
        mergeMethod: z.enum(["merge", "squash", "rebase"]),
      })
      .strict(),
  },
} satisfies Record<string, ActionDef<z.ZodType>>;

export type ActionType = keyof typeof ACTIONS;

/** Category 3: listed only so a request for one is recognised, refused and audited. */
export const PROHIBITED_ACTIONS = new Set([
  "credentials.share",
  "security.disable_control",
  "permissions.bypass",
  "github.delete_repository",
  "data.delete_production",
  "billing.purchase",
]);

export function isKnownAction(type: string): type is ActionType {
  return Object.prototype.hasOwnProperty.call(ACTIONS, type);
}
