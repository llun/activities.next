# Findings: docs/setup.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

# docs/setup.md — lines 1–441

Slice note: setup.md is 440 lines total, so this slice is the whole file.

## Duplicates (confirmed by git grep -nF, both locations given)

- setup.md:374 (`MUST use Node.js version 24`) + setup.md:375 (never npm) ≈ AGENTS.md:226 — same tooling rules; AGENTS.md:226 explicitly points here as canonical, but the one-line summary is duplicated.
- setup.md:40 (`ACTIVITIES_HOST=your-domain.tld`) ≈ postgresql-setup.md:86, sqlite-setup.md:60 — identical required-config snippet in all three setup guides.
- setup.md:52 (`rejects an ACTIVITIES_SECRET_PHASE shorter than 32 characters`) ≈ README.md:121, sqlite-setup.md:111, postgresql-setup.md:167 — the 32-char minimum note is stated in 4 docs.
- setup.md:317-319 (`Set a real, stable secret of at least 32 characters`) ≈ setup.md:52 — same rule twice within this file.
- setup.md:313 (`do not bind-mount /opt/activities.next` warning) ≈ setup.md:430 (again in-file), README.md:121, sqlite-setup.md:112 — the same shadowing warning appears 4 times.
- setup.md:386 + setup.md:387 + setup.md:428 (`remote/shared/production database` local-only rule) — the rule appears twice in-file (386/387 vs 428) plus CONTRIBUTING.md:568.
- setup.md:222 + setup.md:376 (optional workspaces `@activities/*`, dynamic import, type stubs) ≈ README.md:121, architecture.md:270 — the workspace list and dynamic-import explanation appear in 3+ docs.
- setup.md:402-431 (`Keeping the reference schema dumps in sync`: regen procedure, pg_dump stripping, sqlite `.schema`, kysely_migration counts) ≈ CONTRIBUTING.md:526-660 — full duplication of the dump-regeneration procedure, including the same stripping steps (CONTRIBUTING.md:563, 631, 645).
- setup.md:406/409 (`keep them in lockstep`, createTestDatabase rationale) ≈ CONTRIBUTING.md:537, 1046 — lockstep rationale stated in both files.
- setup.md:340-344 (WORKSPACES build-arg examples) ≈ README.md:121 — same `--build-arg WORKSPACES` guidance.

## Stale (checked with git ls-files / grep package.json)

- setup.md:383 — `lib/utils/text/cleanClassName.test.tsx` — checked: file does not exist (`ls lib/utils/text/` → `cleanClassName.dom.test.tsx`, `cleanClassName.test.ts`, `cleanClassName.ts`). The sentence is self-aware ("was until it was renamed"), so it is history text rather than a live claim, but the path is dead.
- setup.md:386/415/428 — "docker-compose stack at `activities.local`" — no compose file is committed (`git ls-files | grep -iE 'compose\.ya?ml'` → nothing); the stack only exists if the reader creates docker-compose.yml per postgresql-setup.md:204 (and AGENTS.md:147 gitignores it). Soft assumption, worth an explicit pointer.
- All other checked paths/scripts/migrations exist and are fine: `scripts/run.cjs`, `scripts/maintenance/verifyDockerImages.ts`, `scripts/maintenance/generateDatabaseTypes.ts`, `scripts/database/migrate.ts`, `migrations/migration.stub`, `lib/types/optional-modules.d.ts`, `lint/agentsRules.mjs` + test, `lint/oxlintrc.scripts.json`, all cited test files except the one above, `lib/database/kysely/*`, `migrations/baseline/*.sql`, `proxy.ts`; all yarn scripts (`dev build start analyze bundle:report lint test prettier prettier:check typecheck migrate migrate:*`); anchors `maintenance.md#database-queue-worker`, `#bundle-size-report`, `#upgrading-past-the-knex-handover`, `environment-variables.md#email`, `#account-import` all resolve.

## History / changelog text

- setup.md:383 — "a live test file no compiler reads, which is what `lib/utils/text/cleanClassName.test.tsx` was until it was renamed" — narrative about a past rename; points at a path that no longer exists.
- setup.md:404 — "the `20260207223000_fix_attachments_media_id_type` migration returned early unless the client was `pg`, so for a while `attachments.mediaId` was integer on PostgreSQL and varchar(255) on SQLite" — both migration IDs (20260207223000, 20261012100000) are absent from this checkout (`git grep -lF '20260207223000' -- migrations` → nothing); the whole parenthetical at the end ("has since rebuilt... so the two dumps agree on that column now") is change-log narration of a fixed problem.
- setup.md:408 — "are the schema the 181 Knex migrations built... ran in v1.192.34 and earlier releases and are not in this checkout" — handover history, though it also carries the durable "never edit" rule; only the 181-count/origin sentence is historical.

## Long sections

- setup.md:372-390 `### Build, Test, and Development Commands` (19 lines) — bullets are 300-700+ words each (line 380 alone is one ~700-word bullet); walls of text mixing command reference, lint-plugin design rationale, and test-guard inventory. Split command reference from rationale.
- setup.md:396-431 `#### Keeping the reference schema dumps in sync` (36 lines) — giant nested numbered steps plus duplicated procedure also in CONTRIBUTING.md; strongest candidate to move wholesale to CONTRIBUTING.md and link.
- setup.md:64-76 `### Serving more than one domain` (13 lines) — item 6 is a dense run-on covering identity, policies, and 15-second propagation; could be split into sub-items.

## Task/PR-specific

- none — no checklists or single-PR instructions found in this slice.

## Readability

- setup.md:380 — single bullet (~700 words) covering the entire lint setup: two oxlint passes, five `agents/*` plugin rules with rationale, suppression syntax, sw.js override, three more test guards. Should be several bullets or a table.
- setup.md:383 — single bullet (~250 words) on typecheck internals including the TypeScript 7 / tsbuildinfo traps; reads as a design essay inside a command list.
- setup.md:92-141 — the S3 media section embeds an 11-line bash comment block explaining archive-export security and serverless stream limits; prose would be easier to scan than comments inside an env-var snippet.
- setup.md:415-431 — deeply nested numbered steps (PostgreSQL dump steps inside a bullet inside a section); indentation is 4+ levels and easy to misread.

## Slice summary

The first half (1-361) is mostly useful, current setup reference; the heavy problems are in the Contributor rules half (363-440): three near-duplicate statements of the local-DB and bind-mount rules in one file, a full copy of the schema-dump regeneration procedure that also lives in CONTRIBUTING.md, and history/changelog narration (renamed test file, Knex-era migration IDs) embedded as rules. Roughly 60-70 lines (386-431) could be deduplicated or moved to CONTRIBUTING.md with links.

