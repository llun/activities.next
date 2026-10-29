## docs/quickstart.md lines 1-101

### Duplicates
- docs/quickstart.md:17-27 ≈ docs/sqlite-setup.md:43-62 ≈ docs/postgresql-setup.md:65-88 — clone / corepack enable / yarn install / yarn migrate / yarn dev development-setup steps repeated in all three guides (also README.md:72, CONTRIBUTING.md:53).
- docs/quickstart.md:58-65 ≈ docs/sqlite-setup.md:84-92 — near-identical local `.env.local` blocks (ACTIVITIES_HOST / SECRET_PHASE / ALLOW_EMAILS / better-sqlite3 pair).
- docs/quickstart.md:96-98 ("at least 32 characters or the app refuses to start") ≈ docs/sqlite-setup.md:111 ≈ docs/postgresql-setup.md:167 (also README.md:121, docs/setup.md:52) — the 32-char SECRET_PHASE rule stated in 4+ places.
- docs/quickstart.md:44-51 (insecure-auth note + ALLOW_EMAILS note) ≈ CONTRIBUTING.md:1092-1099 — same two local-sign-in rules.
- docs/quickstart.md:34-38 (ACTIVITIES_DATABASE JSON alternative) ≈ docs/sqlite-setup.md:21-33 ≈ docs/postgresql-setup.md:44-56 ≈ docs/environment-variables.md:160 — the same precedence/JSON explanation in four files.

### Stale
- none — checked `yarn migrate`/`migrate:status` (`grep '"migrate' package.json` → both exist), `docs/setup.md#...` anchors and `environment-variables.md` links exist as targets, `ACTIVITIES_INSECURE_AUTH`/`ACTIVITIES_ALLOW_EMAILS` (`git grep` in `lib/` → lib/config/index.ts etc.).

### History / changelog text
- none

### Long sections
- none — longest is "What's intentionally left out" (lines 79-90, 12 lines, mostly a link table that should stay).

### Task/PR-specific
- none

### Readability
- docs/quickstart.md:46-49 — the ACTIVITIES_ALLOW_EMAILS blockquote packs the quoting caveat, the fallback behavior and a security warning into three nested caveats; one sentence each would do.

### Slice summary
Quickstart is tight and correctly points to setup.md for depth. The only real weight is the dev-setup/env-block duplication shared with the two database guides; otherwise it could stand as-is.

## docs/sqlite-setup.md lines 1-114

### Duplicates
- docs/sqlite-setup.md:31 ≈ docs/postgresql-setup.md:55 — the "ACTIVITIES_DATABASE takes precedence… non-JSON makes yarn migrate fail" note is near-verbatim in both guides; the durable rule is also in docs/environment-variables.md:160.
- docs/sqlite-setup.md:39 ≈ docs/postgresql-setup.md:63 — same "prints the database it resolved / migrate:status lists applied and pending" migration paragraph (also docs/setup.md:385, docs/maintenance.md:15).
- docs/sqlite-setup.md:43-62 ≈ docs/quickstart.md:17-27 — identical clone/corepack/install steps.
- docs/sqlite-setup.md:84-92 ≈ docs/quickstart.md:58-65 — same local env block.
- docs/sqlite-setup.md:100-113 ≈ README.md:110-121 — Docker SQLite run command, `main`-tag/no-`latest` note, 32-char secret rule, `/opt/activities.next` shadow warning and pre-migrated DB copy recipe all appear in README's Docker section too (also docs/setup.md:302-306).
- docs/sqlite-setup.md:8 ≈ docs/postgresql-setup.md:3 — "recommended for production / higher traffic" cross-reference sentence mirrored in both guides.

### Stale
- none — checked `migrations/baseline/sqlite.sql` (`git ls-files | grep` → exists), `yarn migrate:status` (`grep package.json` → exists), `ghcr.io/llun/activities.next:main` consistent with README.md:121.

### History / changelog text
- none

### Long sections
- none — "Database Configuration" is 13-39 (27 lines) and "Docker Deployment with SQLite" is 85-113 (29 lines); both are operational steps that must stay.

### Task/PR-specific
- none

### Readability
- docs/sqlite-setup.md:31 — one blockquote sentence with four clauses (precedence, migrate+app, non-JSON failure, migrate-only filename shorthand); split or move the shorthand rule to environment-variables.md.
- docs/sqlite-setup.md:109 — the migration-before-first-start bullet embeds a full inline shell command with an empty-`ACTIVITIES_DATABASE=` trick inside a sentence; hard to scan, same recipe exists in README.md:121.

### Slice summary
A full standalone guide whose first half (prerequisites, dev setup, env block, migrate paragraph) is duplicated by the quickstart and by postgresql-setup.md; the Docker section duplicates README's. Roughly lines 43-62 and parts of 21-39/100-113 could move or collapse to links.

## docs/postgresql-setup.md lines 1-205

### Duplicates
- docs/postgresql-setup.md:55 ≈ docs/sqlite-setup.md:31 — the ACTIVITIES_DATABASE precedence note, near-verbatim (also environment-variables.md:160).
- docs/postgresql-setup.md:63 ≈ docs/sqlite-setup.md:39 — the baseline-schema + "prints the database it resolved" migration paragraph (also setup.md:385, maintenance.md:15).
- docs/postgresql-setup.md:65-88 ≈ docs/quickstart.md:17-27 — same clone/corepack/install/migrate/dev steps.
- docs/postgresql-setup.md:94-103 ≈ docs/sqlite-setup.md:84-92 — same Development Setup env block pattern, differing only in the PG variables.
- docs/postgresql-setup.md:160-167 (32-char secret rule, no-migrations-in-image note) ≈ docs/sqlite-setup.md:108-111 ≈ README.md:121 ≈ docs/setup.md:52.
- docs/postgresql-setup.md:136-143 ("Using with Vercel") ≈ README.md:128-135 and docs/setup.md:286 ("Vercel Deployment") — Vercel deployment guidance in three places.

### Stale
- none — checked `migrations/baseline/postgres.sql` (`git ls-files` → exists), `@activities/pg` workspace (`git ls-files | grep pg/package.json` → packages/pg/package.json, name `@activities/pg`), `scripts/run.cjs` + `scripts/maintenance/verifyDockerImages.ts` (`git ls-files` → both exist), `WORKSPACES` build arg (`git grep -nF WORKSPACES -- Dockerfile` → Dockerfile:31), `ACTIVITIES_DATABASE_PG_*` vars (`git grep` → lib/config/database.ts:245-246).

### History / changelog text
- docs/postgresql-setup.md:63-63 — "An existing database that ran the old Knex migrations needs one check first" — borderline: durable pointer, but the Knex backstory belongs to maintenance.md.

### Long sections
- none over 80 lines — "## Docker Deployment with PostgreSQL" is lines 134-204 (71 lines); it mixes three formats (single container, compose file, build/verify instructions) and could be split, but all of it is operational reference.

### Task/PR-specific
- none

### Readability
- docs/postgresql-setup.md:87-89 — the `yarn workspaces focus` note is a nested optimization caveat most readers don't need.
- docs/postgresql-setup.md:156-159 — the verify-image command with three flags inside a blockquote; could be a plain step.
- docs/postgresql-setup.md:109-132 — numbered production tips are generic one-liners ("consider connection pooling", managed-provider list) that read as filler.

### Slice summary
A workable reference guide, but ~40% of it (prerequisites, dev setup, migration paragraph, precedence note, secret/Docker notes, Vercel) is duplicated across quickstart, sqlite-setup, README and setup.md. Collapsing the shared dev-setup and JSON-precedence text to links to quickstart.md + environment-variables.md would cut the file by a third without losing content.

## Cross-slice overlap (extra)

- Dev-setup skeleton (clone → corepack → install → env → migrate → dev) appears in all three of these guides plus README.md:72 and CONTRIBUTING.md:53 — one canonical copy (quickstart.md is the natural home) with links from the rest.
- The ACTIVITIES_DATABASE JSON/precedence rule is stated in sqlite-setup.md:31, postgresql-setup.md:55 and environment-variables.md:160; the guides' copies add nothing beyond the env guide except sqlite's filename shorthand (sqlite-setup.md:31), which should move there.
- Docker guidance for SQLite is triplicated: README.md:110-121, docs/setup.md:302-306 and sqlite-setup.md:99-113 — including the same 32-char secret and no-`latest`-tag notes.
