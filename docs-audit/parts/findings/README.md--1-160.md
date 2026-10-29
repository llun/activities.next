## README.md lines 1-160

### Duplicates
- README.md:121 ≈ docs/setup.md:52, docs/sqlite-setup.md:111, docs/postgresql-setup.md:167 — the note "production runtime rejects an `ACTIVITIES_SECRET_PHASE` shorter than 32 characters" is stated in four docs (checked: `git grep -nF 'shorter than 32'`).
- README.md:102 ≈ docs/setup.md:280 — "(your email must be in the allow list)" parenthetical next to the signup step (checked: `git grep -nF 'allow list'`).
- README.md:72 ≈ CONTRIBUTING.md:53, docs/quickstart.md:22, docs/sqlite-setup.md:53, docs/postgresql-setup.md:77 — `corepack enable` install step repeated in every guide (checked: `git grep -nF 'corepack enable'`).
- README.md:84 ≈ CONTRIBUTING.md:67 — `cp .env.example .env.local` step (checked: `git grep -nF '.env.example'`).
- README.md:114 ≈ docs/sqlite-setup.md:101, docs/setup.md:306 — same Docker `docker run` env block including `ACTIVITIES_DATABASE_SQLITE_FILENAME=/opt/activities.next/data/data.sqlite` (checked: `git grep -nF 'ACTIVITIES_DATABASE_SQLITE_FILENAME=/opt'`).
- README.md:121 ≈ docs/sqlite-setup.md:113, docs/postgresql-setup.md:167 — "runtime image does not run migrations, run `yarn migrate` against the file first" instruction repeated.
- README.md:121 ≈ docs/setup.md:340, docs/postgresql-setup.md:152 — `--build-arg WORKSPACES="..."` custom-image instruction repeated.
- README.md:121 — the paragraph at line 121 restates several setup-guide facts inline (main-tag-only, no `latest`, /opt mount warning, pre-migrated data.sqlite) that docs/sqlite-setup.md carries; one linked line each would remove the duplication.

### Stale
- none — checked: all 10 linked docs files exist (`git ls-files docs`); `CONTRIBUTING.md`, `LICENSE.md`, `Dockerfile`, `.env.example` exist (`git ls-files | grep`); `yarn migrate` and `yarn dev` exist (`grep '"scripts"' package.json`); `@activities/pg`, `@activities/cloudtasks`, `@activities/qstash` workspace packages exist (`ls packages` → cloudtasks, nodemailer, pg, qstash, resend, ses); `engines.node` is `24.x` and `packageManager` is `yarn@4.18.1` as the Prerequisites section claims; `ACTIVITIES_HOST` and `ACTIVITIES_SECRET_PHASE` are in `.env.example`; the allow-list env var (`ACTIVITIES_ALLOW_EMAILS`) exists.

### History / changelog text
- none

### Long sections
- none — no ## section exceeds 80 lines; the only multi-line block is the ASCII architecture diagram (lines 25-50), which is fine.

### Task/PR-specific
- none

### Readability
- README.md:121 — one ~900-character paragraph packing five separate Docker facts (tag policy, secret length, mount warning, pre-migrated DB, migration step); should be split into bullets, most of which already exist in docs/sqlite-setup.md.
- README.md:60-63 — Quick Start callout, step 4 note, and final "For detailed setup instructions" line all point to docs/setup.md; the Quick Start callout also points to docs/quickstart.md — three pointers to setup docs within 40 lines is one too many.

### Self-hoster from zero to running server
- Present inline: clone, corepack enable, yarn install, copy .env.example with the three minimum vars named (`ACTIVITIES_HOST`, `ACTIVITIES_SECRET_PHASE`, `ACTIVITIES_DATABASE_CLIENT`), `yarn migrate`, `yarn dev`, signup URL with the allow-list caveat, plus a complete copy-paste Docker run command with required env and volume.
- Only linked, not inline: how to configure the signup allow list (the var is `ACTIVITIES_ALLOW_EMAILS`; README never names it, only links docs/setup.md), full production deployment beyond the single `docker run` (sqlite-setup.md / postgresql-setup.md), and Vercel env-var details.
- Verdict: yes, a self-hoster reaches a running local dev server from this README alone (the "email must be in the allow list" step fails until they open docs/setup.md to find `ACTIVITIES_ALLOW_EMAILS`, and the default Docker command has the same gap — no allow-list var is passed, so signup will fail there too unless docs are consulted). Naming that one variable inline would close the last gap for both paths.

### Slice summary
README is in good shape: all links, scripts, packages and env vars verified live; no history or task-specific text. Main work is deduplicating line 121's Docker paragraph against docs/sqlite-setup.md (the biggest cluster: ~6 of the 8 confirmed duplicates touch it) and naming `ACTIVITIES_ALLOW_EMAILS` so the zero-to-running path is truly self-contained.
