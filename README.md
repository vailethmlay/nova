# NOVA

Private operations assistant. NOVA reads, analyses and recommends. It changes nothing without the owner's specific, time-limited, single-use approval.

Architecture and roadmap: see the approved proposal doc. This repo is **Phase 1: Foundation**.

## What Phase 1 includes

- **Passkey sign-in** (WebAuthn, user verification required). The first passkey needs `NOVA_SETUP_TOKEN`, and setup closes once a passkey exists. Sessions are random tokens in an HTTP-only, SameSite=strict cookie; only their SHA-256 is stored.
- **Approval engine** (`src/lib/approvals/`):
  - Each action has a fixed category in `registry.ts`. Category 3 actions have no schema and no executor, so they're refused and audited.
  - A proposal is immutable. Its operation is validated against a strict schema and hashed in canonical form.
  - An approval binds to that hash, expires after 30 minutes and is consumed atomically, so it works once.
  - Before running, the executor rebuilds the operation from live state. If the hash differs (for example, a new commit was pushed), it's blocked.
  - Every dashboard approval needs a fresh passkey assertion bound to that specific proposal.
  - WhatsApp approvals (Phase 2) are limited to Low risk in code.
  - Phase 1 ships one no-op executor, `system.test_approval`, so you can try the whole loop safely.
- **Audit log**: append-only and hash-chained. A database trigger blocks UPDATE, DELETE and TRUNCATE, and the Audit page re-verifies the chain on every view. Secrets are redacted from details.
- **Application registry**: all 13 fields from the brief, plus per-app notes NOVA remembers.
- **Ask NOVA chat**: Anthropic API, server-side only. Context is built from the registry and redacted before sending. Health is never claimed without monitoring evidence.
- Brand: Lexend/Figtree, myAIDA purple palette, flat colour. All times are shown in EAT.

Not yet built: GitHub, WhatsApp and monitoring (Phases 2–3), real write executors (Phase 4), reports (Phase 5) and a TOTP backup login.

## Run locally

```bash
cp .env.example .env            # fill in; generate NOVA_SETUP_TOKEN with: openssl rand -hex 24
npm install
npm run db:migrate              # needs a reachable PostgreSQL 16 in DATABASE_URL
npm run dev                     # http://localhost:3000 → enter the setup token → create your passkey
```

Passkeys require `NOVA_ORIGIN` to match the browser URL exactly. `NOVA_RP_ID` is its bare hostname, for example `nova.example.com`. Production must use HTTPS.

## Tests

```bash
npm test          # approval engine, audit chain and immutability, redaction (in-memory Postgres via PGlite)
npm run typecheck
```

## Production notes

- Run the app as a database role with `INSERT, SELECT` only on `audit_log`, and an owner role for migrations.
- Keep `.env` out of git (it's in `.gitignore`), readable only by the service user.
- Back up Postgres daily and test a restore before go-live.
- Set a monthly spend limit on the Anthropic key.

## Layout

```
src/lib/approvals/  registry, engine, executor
src/lib/audit.ts    hash-chained audit log
src/lib/auth/       sessions, WebAuthn helpers
src/lib/redact.ts   secret redaction for logs, audit and AI prompts
src/app/api/        auth, approvals, chat endpoints (origin-checked, session-checked)
src/app/(app)/      dashboard pages (session required)
drizzle/            SQL migrations
tests/              Vitest suites
```
