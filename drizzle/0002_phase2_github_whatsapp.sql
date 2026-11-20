CREATE TABLE "github_repos" (
	"id" bigint PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"application_id" uuid,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"html_url" text NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"html_url" text NOT NULL,
	"updated_at_gh" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"head_ref" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_ref" text NOT NULL,
	"html_url" text NOT NULL,
	"created_at_gh" timestamp with time zone NOT NULL,
	"updated_at_gh" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"tag_name" text NOT NULL,
	"name" text,
	"prerelease" boolean DEFAULT false NOT NULL,
	"html_url" text NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_link" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_wa_id" text,
	"link_code_hash" text,
	"link_code_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"name" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"head_branch" text,
	"head_sha" text NOT NULL,
	"html_url" text NOT NULL,
	"created_at_gh" timestamp with time zone NOT NULL,
	"updated_at_gh" timestamp with time zone NOT NULL,
	"alerted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_repo_state_idx" ON "issues" USING btree ("repo_id","state");--> statement-breakpoint
CREATE INDEX "pull_requests_repo_state_idx" ON "pull_requests" USING btree ("repo_id","state");--> statement-breakpoint
CREATE INDEX "workflow_runs_repo_idx" ON "workflow_runs" USING btree ("repo_id","updated_at_gh");