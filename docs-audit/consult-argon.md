# Consult: argon

## Read of the problem

1. **Docs are 1.6 MB because four files (`docs/architecture.md` 528 KB, `docs/maintenance.md` 261 KB, `docs/mastodon-api-compatibility.md` 251 KB, `docs/fitness-file-storage.md` 193 KB) carry appended `## Contributor rules` manuals making up 45–72% of each file** (`architecture.md` L1139–4032 is 2,894 lines; `fitness-file-storage.md` L464–1556 is 1,093 lines).
2. **Every rule is written two to five times across three layers**: first in a narrative design/feature section, again in `## Contributor rules`, and a third time in `### Review: …` tails (`architecture.md` L2905–4002, `maintenance.md` L1283–1720, `mastodon-api-compatibility.md` L1740–1978, `fitness-file-storage.md` L1471–1556), plus `CONTRIBUTING.md` which is split into two overlapping halves (human guide L1–706 vs. agent workflow reference L707–1476).
3. **`AGENTS.md` (44 KB, 468 lines) wastes 190 lines (L268–458) on 47 two-line pointer stubs** that say `"The durable rule source moved to […]"`, repeating the same ~10 targets already linked in `Required subsystem reading map` (L236–250) and `Cross-cutting data and protocol rules` (L252–258).
4. **PR post-mortems and war stories masquerade as reference prose**: rules are buried inside 500–7,300-character single-line bullets (`mastodon-api-compatibility.md` L1293–1338 hits 7,300 chars/line; `features.md` averages 400 B/line up to 5.8 KB) recounting PR numbers (`#1019`, `#1122`, `#1559`–`#1570`, `#1592`, `#2226`, `#2594`), past bugs, and one-off buffer counts.
5. **Operator setup is fragmented across five overlapping files** (`README.md`, `docs/quickstart.md`, `docs/setup.md`, `docs/sqlite-setup.md`, `docs/postgresql-setup.md`) that repeat clone/corepack/install, Docker `run`, and the 32-char `ACTIVITIES_SECRET_PHASE` rule 4–5 times while `README.md` omits `ACTIVITIES_ALLOW_EMAILS` needed for first sign-up.
6. **Confirmed stale/dangling items are small but noisy**: `CLAUDE.md` symlink claims (`AGENTS.md:144,262`, `CONTRIBUTING.md:1219,1230`), deleted `scripts/maintenance/backfillMediaBlurhash.ts` (`maintenance.md:1167,1171,1172`), renamed `cleanClassName.test.tsx` (`setup.md:383`), emptied `allowFiles` fetch list (`architecture.md:1509`, `CONTRIBUTING.md:246`), misplaced `backfillMediaSortAt.ts` under v1.192.34 (`maintenance.md:401–412`), and untracked `epic plan` (`mastodon-api-compatibility.md:1012`) / `ui_kits/web/GearKit.jsx` (`architecture.md:1383`, `fitness-file-storage.md:1251`).

---

## Option 1: In-Place De-Bloat & Line-Wrapping (Light Tidy)

Keep all 16 files at their current paths and preserve the current subsystem-colocated rule layout, but strip history/war-story prose, merge in-file duplicates (including folding `### Review:` repeats into the `###` rule sections above them while preserving `<a id="review-...">` anchors), and break wall-of-text bullets into short rules.

### Target file list & rough size after
- `README.md` — **kept / tightened** (9 KB → ~8 KB): add `ACTIVITIES_ALLOW_EMAILS` to Quick Start/Docker; trim L121 Docker paragraph to bullets linking `docs/sqlite-setup.md`.
- `CONTRIBUTING.md` — **shortened in-place** (95 KB → ~52 KB): merge duplicated first-half (`L116–687`) and second-half (`L707–1476`) sections (Testing L260 + L713 + L1356; Common Tasks L487 + Task Recipes L1152; PR Process L370 + Commit/PR L1235 + Commits/versioning L1452; CI Checks L406 + L824 + L1469; Docs Maintenance L1217 + L1437). Replace the 166-line schema-dump recipe (`L522–687`) with a link to `docs/setup.md#Keeping the reference schema dumps in sync`.
- `AGENTS.md` — **shortened** (44 KB → ~22 KB): replace 47 pointer stubs (`L268–458`) with a single compact topic-to-anchor table; trim duplicate prose around the model/effort tables (`L32–133`); remove duplicate SectionNavDropdown body at `L318`.
- `REVIEW.md` — **shortened** (11 KB → ~7 KB): drop `Review lenses` (`L13–21`) which duplicates the checklist below; shorten `Surfaces` (`L48`) and `Database & migrations` (`L38`) rows.
- `LICENSE.md` — **kept** (1 KB → 1 KB).
- `.github/PULL_REQUEST_TEMPLATE.md` — **shortened** (1.8 KB → ~1.2 KB): point HTML comment (`L1–6`) and Sketch item (`L22`) to `AGENTS.md`/`CONTRIBUTING.md`.
- `docs/architecture.md` — **shortened** (528 KB → ~290 KB): fold `### Review: …` sections (`L2905–4002`) into their matching `## Contributor rules` sections (`L1183–2904`) keeping `<a id="review-...">` tags on the canonical headings; merge duplicate `Link Preview Cards` (`L778` + `L1644`) and `Offline-First PWA` (`L1047` + `L4003`); strip PR history and pixel-measurement essays.
- `docs/maintenance.md` — **shortened** (261 KB → ~145 KB): fold `### Review: …` (`L1283–1720`) into `L995–1282` (keeping `<a id="review-...">` anchors); move `Media Sort Date Backfill` (`L401–412`) out of the v1.192.34 section; condense Knex handover (`L5–30`) and gear backfill (`L742–861`); deduplicate fitness script notes (`L631–731`).
- `docs/mastodon-api-compatibility.md` — **shortened** (251 KB → ~140 KB): fold `### Review: …` (`L1740–1978`) into `L1117–1739`; replace duplicated inbound `Move`/rename/action-row/Zod blocks (`L1131–1158`, `L1171–1295`, `L1388–1458`) with links to `architecture.md`; add `###` subheadings to `Intentional divergences` (`L18–464`) and `Extensions` (`L489–1095`); wrap 3k–7k-char lines (`L1293–1338`).
- `docs/fitness-file-storage.md` — **shortened** (193 KB → ~105 KB): delete duplicate `### Review: Apple Maps basemap` and `### Review: Fitness route heatmap pyramid` (`L1471–1556`), moving their `<a id="review-...">` anchors to `L518` and `L623`; split `### Fitness Gear` (`L925–1470`) and `### Fitness Route Heatmap Pyramid` (`L623–924`) into subheadings and strip war stories.
- `docs/environment-variables.md` — **shortened** (97 KB → ~70 KB): trim admin UI walkthrough prose (`L11–129`), remove one-time upgrade notes (`L9`, `L207–211`, `L331`, `L333`, `L490`), shorten 200-word table cells.
- `docs/features.md` — **shortened** (64 KB → ~30 KB): convert 2–5 KB single-line bullets into short summary bullets linking to `architecture.md` and `mastodon-api-compatibility.md`; delete `## Planned Features` and `## Feature Requests` (`L152–158`) per Constraint 2.
- `docs/setup.md` — **shortened** (39 KB → ~28 KB): deduplicate in-file bind-mount/secret/local-DB repeats and split 700-word `L380` lint bullet.
- `docs/postgresql-setup.md` (8 KB → ~5 KB), `docs/sqlite-setup.md` (6 KB → ~4 KB), `docs/quickstart.md` (4 KB → ~4 KB) — **kept / trimmed**: link `quickstart.md` and `environment-variables.md` instead of repeating clone/install and `ACTIVITIES_DATABASE` precedence.

- **Total size after**: ~910 KB (down from ~1.6 MB, ~43% reduction).
- **How agent rules stay reachable**: `AGENTS.md` keeps all inline core rules (`L1–267`) and replaces the 47 two-line sections (`L268–458`) with a single markdown table mapping every topic heading (preserving exact heading names in column 1) to its existing `<a id="agents-...">` anchor in `CONTRIBUTING.md`, `docs/architecture.md`, `docs/mastodon-api-compatibility.md`, `docs/fitness-file-storage.md`, `docs/maintenance.md`, and `docs/setup.md`.
- **How code/test/CI doc references are kept or updated**: Zero file renames. All 111 non-md code/test/lint/CI references stay valid without code changes: `docs/environment-variables.md` stays in place with all `ACTIVITIES_*`/`OTEL_*` vars for `lib/config/envDocumentation.test.ts`; `AGENTS.md` table retains the exact rule titles cited by `lint/agentsRules.mjs`; `docs/setup.md` keeps `Keeping the reference schema dumps in sync` and `Regenerating the Kysely DB types` for `.github/workflows/ci.yml:763,862,879`; `docs/maintenance.md` keeps `Upgrading past the Knex handover` for `lib/database/migrate/{baseline,startupCheck}.ts`.
- **What is removed outright & rule preservation**: Removes ~700 KB of PR war stories, duplicate `Review:` restatements, 5x-repeated CI/gate/Zod/API-response blocks, and confirmed stale mentions (`CLAUDE.md`, `backfillMediaBlurhash.ts`, `cleanClassName.test.tsx`, `allowFiles` legacy fetch claim, `epic plan`). Before deleting any `Review:` or duplicate block, diff each imperative (`must`, `never`, `always`, helper/test names) against the surviving canonical section to ensure 100% rule retention.
- **Risks**: Contributor rules remain mixed into operator/architecture docs (`architecture.md` is still ~290 KB); contributors and operators still have to scroll past each other's material.
- **Number of PRs and their order**: 4 PRs.
  1. PR 1: Clean up `AGENTS.md`, `CONTRIBUTING.md`, `REVIEW.md`, `README.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and stale `CLAUDE.md` references.
  2. PR 2: Deduplicate and de-bloat `docs/setup.md`, `docs/quickstart.md`, `docs/sqlite-setup.md`, `docs/postgresql-setup.md`, `docs/environment-variables.md`, and `docs/features.md`.
  3. PR 3: Fold `Review:` sections, cut history/duplicates, and wrap long bullets in `docs/maintenance.md` and `docs/fitness-file-storage.md`.
  4. PR 4: Fold `Review:` sections, cut cross-file duplicates/history, and add subheadings in `docs/mastodon-api-compatibility.md` and `docs/architecture.md`.

---

## Option 2: Audience Split — Pure Operator Guides + Consolidated Handbook (Moderate Restructure)

Separate **operator/self-hoster docs** from **contributor/agent rules** where the mix is most jarring (`docs/setup.md`, `docs/maintenance.md`), delete the redundant `docs/features.md` roadmap wall, and fold `### Review:` tails into their owning rule sections in the three subsystem docs (`architecture.md`, `mastodon-api-compatibility.md`, `fitness-file-storage.md`).

### Target file list & rough size after
- `README.md` — **kept / updated** (9 KB → ~10 KB): absorbs a concise feature overview from `docs/features.md`; adds `ACTIVITIES_ALLOW_EMAILS` inline; trims duplicate Docker prose (`L121`); drops `docs/features.md` from the docs index table (`L147`).
- `CONTRIBUTING.md` — **merged & expanded with workflow/DB/ops rules** (95 KB → ~75 KB): merges the duplicated human (`L1–706`) and agent (`L707–1476`) halves into one clean structure, and absorbs `docs/setup.md` `## Contributor rules` (`L363–440`: build/test/lint commands, local DB rules, schema dump & Kysely type regeneration) plus `docs/maintenance.md` `### Database Compatibility Guidelines` & `### Review: Database & migrations` / `Unique constraints` (`L1223–1280`, `L1316–1529`).
- `AGENTS.md` — **shortened** (44 KB → ~20 KB): keeps `L1–267` core rules (tightened), replaces the 47 pointer stubs (`L268–458`) with a grouped routing table pointing to `CONTRIBUTING.md`, `docs/architecture.md`, `docs/mastodon-api-compatibility.md`, and `docs/fitness-file-storage.md`.
- `REVIEW.md` — **shortened** (11 KB → ~6 KB): removes `Review lenses` (`L13–21`) and updates anchor links to point to the merged canonical rule sections.
- `LICENSE.md` (1 KB) & `.github/PULL_REQUEST_TEMPLATE.md` (~1.2 KB) — **kept / tightened**.
- `docs/features.md` — **deleted** (64 KB → 0 KB): high-level feature list moves to `README.md`; protocol/API specifics are already in `docs/mastodon-api-compatibility.md` and `docs/architecture.md`; `Planned Features` (`L152–158`) dropped per Constraint 2.
- `docs/setup.md` — **shortened to pure operator guide** (39 KB → ~18 KB): `## Contributor rules` (`L363–440`) moved to `CONTRIBUTING.md`; duplicate 32-char secret and bind-mount warnings trimmed.
- `docs/maintenance.md` — **shortened to pure operator/script guide** (261 KB → ~85 KB): `L1–981` script reference kept and deduplicated (`Media Sort Date Backfill` moved out of v1.192.34; Knex handover condensed); `## Contributor rules` (`L982–1720`) moved out — DB/migration rules to `CONTRIBUTING.md`, media/gallery/storage/served-domain rules (`L995–1222`, `L1283–1315`, `L1530–1720`) to `docs/architecture.md` under `Media & File Storage` and `Served Domains`.
- `docs/architecture.md` — **shortened & reorganized** (528 KB → ~270 KB): absorbs media/storage/served-domain contributor rules from `maintenance.md`, folds all `### Review:` sections (`L2905–4002`) into their matching `## Contributor rules` headings, merges duplicate Link Preview (`L778`+`L1644`) and Offline PWA (`L1047`+`L4003`) sections, and strips PR war stories and pixel-level prose.
- `docs/mastodon-api-compatibility.md` — **shortened** (251 KB → ~125 KB): folds `### Review:` (`L1740–1978`) into `## Contributor rules` (`L1117–1739`), replaces duplicated `Move`/rename/action-row/Zod sections with links to `architecture.md`/`CONTRIBUTING.md`, wraps 7k-char lines, adds `###` subheadings to `Intentional divergences` and `Extensions`.
- `docs/fitness-file-storage.md` — **shortened** (193 KB → ~95 KB): merges `### Review:` (`L1471–1556`) into `L518` and `L623`, splits 546-line `Fitness Gear` (`L925–1470`) and 302-line `Route Heatmap Pyramid` (`L623–924`) into subheadings, cuts war stories and `architecture.md` duplicates.
- `docs/environment-variables.md` (~68 KB), `docs/postgresql-setup.md` (~5 KB), `docs/sqlite-setup.md` (~4 KB), `docs/quickstart.md` (~4 KB) — **kept / tightened** as in Option 1.

- **Total size after**: ~720 KB (15 files; `docs/features.md` deleted; ~55% reduction).
- **How agent rules stay reachable**: `AGENTS.md` routes workflow, testing, build/lint commands, and DB/migration rules to `CONTRIBUTING.md`; UI, auth, media/storage, email, and federation-lifecycle rules to `docs/architecture.md`; ActivityPub wire/ID/username/visibility rules to `docs/mastodon-api-compatibility.md`; and fitness rules to `docs/fitness-file-storage.md`. `docs/setup.md` and `docs/maintenance.md` no longer carry agent rules.
- **How code/test/CI doc references are kept or updated**:
  - `.github/workflows/ci.yml:879`, `lib/database/kysely/db.ts:3`, and `scripts/maintenance/generateDatabaseTypes.ts:11,268` (`docs/setup.md` → `"Regenerating the Kysely DB types"`): either update those 4 references to `CONTRIBUTING.md` in the same PR or leave a 2-line pointer under that heading in `docs/setup.md`.
  - `docs/maintenance.md` keeps `Upgrading past the Knex handover` (`L5–30`) for `lib/database/migrate/{baseline,startupCheck}.ts`.
  - Cross-doc links to `docs/features.md` (5 hits in `README.md:20,147` and `docs/mastodon-api-compatibility.md:11`) are updated in the same PR.
- **What is removed outright & rule preservation**: Deletes `docs/features.md` (64 KB of duplicate feature descriptions and non-durable roadmap items), removes all `### Review:` duplicate sections across `docs/`, removes the duplicate schema-dump recipe (`CONTRIBUTING.md:522–687` vs `setup.md:396–431`), and strips PR war stories and stale references (`CLAUDE.md`, `backfillMediaBlurhash.ts`, `cleanClassName.test.tsx`, `allowFiles`, `epic plan`). Every `<a id="agents-...">` and `<a id="review-...">` anchor is preserved on its new canonical heading.
- **Risks**: `docs/architecture.md` remains ~270 KB because it still houses both system architecture and UI/auth/media contributor rules.
- **Number of PRs and their order**: 4 PRs.
  1. PR 1: Deduplicate `CONTRIBUTING.md`, move `docs/setup.md` (`L363–440`) and `docs/maintenance.md` DB contributor rules into `CONTRIBUTING.md`, and update `ci.yml` / `generateDatabaseTypes.ts` pointers.
  2. PR 2: Move `docs/maintenance.md` media/storage/served-domain rules into `docs/architecture.md`, clean up `docs/maintenance.md`, and delete `docs/features.md` (updating `README.md` and `mastodon-api-compatibility.md` links).
  3. PR 3: Fold `Review:` sections and trim duplicates/history in `docs/architecture.md`, `docs/mastodon-api-compatibility.md`, and `docs/fitness-file-storage.md`.
  4. PR 4: Compact `AGENTS.md` (table replacing L268–458 stubs), `REVIEW.md`, `docs/environment-variables.md`, and the setup guides.

---

## Option 3: Modular Subsystem Guides & Consolidated Setup (Balanced Structural Cleanup)

Solve both structural root causes cleanly: (1) extract the 2,900-line contributor-rules manual out of `docs/architecture.md` (and `docs/maintenance.md`) into a dedicated `docs/contributor-rules.md` so `docs/architecture.md` is once again a readable architecture overview, and (2) consolidate the fragmented setup/feature docs (`quickstart.md`, `sqlite-setup.md`, `postgresql-setup.md` → `docs/setup.md`; delete `docs/features.md`).

### Target file list & rough size after
- `README.md` — **kept / updated** (9 KB → ~9 KB): adds `ACTIVITIES_ALLOW_EMAILS` to Quick Start & Docker; absorbs compact feature list from `docs/features.md`; updates docs table to point to `docs/setup.md#quickstart`, `#sqlite`, `#postgresql`, and `docs/contributor-rules.md`.
- `CONTRIBUTING.md` — **shortened & unified** (95 KB → ~55 KB): merges the duplicated human (`L1–706`) and agent (`L707–1476`) halves; absorbs `docs/setup.md` `## Contributor rules` (`L363–440`: commands, local DB setup, schema dump & Kysely type regeneration, eliminating the 166-line duplicate recipe); keeps Testing Guidelines, Task Recipes, Design Library Sync, Documentation Maintenance, Commit/PR Guidelines, and Code Review Loop.
- `AGENTS.md` — **shortened** (44 KB → ~18 KB): keeps `L1–267` core rules (Definition of Done, Sub-Agents with trimmed prose around tables, Structure, Runtime Config, Coding Style, Logging, API Response, Commands, Mandatory workflow); replaces `L268–458` (47 pointer stubs) with a clean routing table pointing to `CONTRIBUTING.md`, `docs/contributor-rules.md`, `docs/mastodon-api-compatibility.md`, and `docs/fitness-file-storage.md`; removes stale `CLAUDE.md` claims (`L144,262`).
- `REVIEW.md` — **shortened** (11 KB → ~6 KB): drops duplicate `Review lenses` (`L13–21`) and links each review invariant directly to its canonical section in `docs/contributor-rules.md`, `CONTRIBUTING.md`, `docs/mastodon-api-compatibility.md`, or `docs/fitness-file-storage.md`.
- `LICENSE.md` (1 KB) & `.github/PULL_REQUEST_TEMPLATE.md` (~1.2 KB) — **kept / tightened**.
- `docs/architecture.md` — **split into `docs/architecture.md` + `docs/contributor-rules.md`** (528 KB → ~95 KB): keeps `L1–1138` (System Architecture, Request Flow, Directory Structure, Key Design Decisions, Database Schema, Technology Stack) plus the architectural parts of `Offline-First PWA Launch & Timeline Caching` (`L4003–4032`); trims duplicate Wahoo/9421/import prose that belongs in subsystem docs and cuts the 71-line S3 zip-checkpoint essay (`L458–528`).
- `docs/contributor-rules.md` — **new file split from `architecture.md` L1139–4002 + `maintenance.md` L982–1720** (~155 KB): holds all cross-cutting UI/client, surfaces, page chrome, emails, link previews, actor/status federation lifecycle, better-auth/OAuth, media/gallery storage, security/path-confinement, and database/migration contributor rules. Folds all `### Review:` subsections into their matching `###` rule headings (preserving both `<a id="agents-...">` and `<a id="review-...">` anchors on each heading) and strips PR war stories.
- `docs/maintenance.md` — **shortened to pure operator & script reference** (261 KB → ~80 KB): keeps `L1–981` (Knex handover condensed, bundle report, queue worker, media cleanup, production archive, actor export, v1.192.34 note with `Media Sort Date Backfill` moved out to main backfills, gallery/search/URL/mock/fitness/Docker scripts deduplicated); `L982–1720` moved to `docs/contributor-rules.md`.
- `docs/mastodon-api-compatibility.md` — **shortened** (251 KB → ~120 KB): keeps `Intentional divergences` (`L18–464`), `Not planned` (`L465–488`), `Extensions` (`L489–1095`) with new `###` topic subheadings, and protocol-specific `## Contributor rules` (`L1096–1978`, folding `Review:` sections `L1740–1978` in and moving UI component/CSS mechanics `L1399–1686` and duplicate `Move`/rename rules `L1171–1295` to `docs/contributor-rules.md`).
- `docs/fitness-file-storage.md` — **shortened** (193 KB → ~90 KB): keeps fitness overview, config, schema, gear, endpoints, pipeline, scripts, security (`L1–463`) and fitness-specific contributor rules (`L464–1470`, split into subheadings and stripped of war stories); folds `Review:` (`L1471–1556`) into `L518` and `L623`.
- `docs/environment-variables.md` — **shortened** (97 KB → ~68 KB): trims `L11–129` admin UI prose, removes one-time migration notes (`L9`, `L207–211`, `L331`, `L333`, `L490`), shortens table cells.
- `docs/setup.md` — **merged with `quickstart.md`, `sqlite-setup.md`, `postgresql-setup.md`** (39 KB + 4 KB + 6 KB + 8 KB = 57 KB → ~32 KB): becomes the single operator setup & deployment guide with `## Quickstart` (`#quickstart`), `## SQLite Setup` (`#sqlite`), `## PostgreSQL Setup` (`#postgresql`), `## General Configuration`, and `## Deployment Options` (Docker, Vercel). `## Contributor rules` (`L363–440`) moved to `CONTRIBUTING.md`.
- `docs/quickstart.md` (4 KB), `docs/sqlite-setup.md` (6 KB), `docs/postgresql-setup.md` (8 KB), `docs/features.md` (64 KB) — **deleted** (merged into `docs/setup.md` and `README.md`/`docs/mastodon-api-compatibility.md`).

- **Total size after**: ~665 KB across 13 files (down from ~1.6 MB across 16 files; ~58% reduction).
- **How agent rules stay reachable**: `AGENTS.md` holds core rules inline (`L1–267`) and a single routing table mapping every subsystem rule to `CONTRIBUTING.md` (workflow, testing, commands, schema dumps, design sync, review loop), `docs/contributor-rules.md` (server/client boundary, UI/chrome/surfaces, auth/OAuth, emails, link previews, media/storage security, DB compatibility), `docs/mastodon-api-compatibility.md` (entity IDs, Zod, ActivityPub/JSON-LD, usernames, status visibility), and `docs/fitness-file-storage.md` (fitness maps, dates, heatmap pyramid, gear).
- **How code/test/CI doc references are kept or updated**:
  - `lib/config/envDocumentation.test.ts`: `docs/environment-variables.md` path and all env var names unchanged.
  - `.github/workflows/ci.yml:879`, `lib/database/kysely/db.ts:3`, `scripts/maintenance/generateDatabaseTypes.ts:11,268`: update `docs/setup.md` reference to `CONTRIBUTING.md` (`"Regenerating the Kysely DB types"`), or keep a 2-line redirect section in `docs/setup.md`.
  - `.env.example:80` (names `docs/sqlite-setup.md` and `docs/postgresql-setup.md`): update comment in same PR to `docs/setup.md#sqlite` and `docs/setup.md#postgresql`.
  - 9 code/test comments naming `docs/architecture.md` contributor-rule headings (`chromeLayout.ts:7`, `attachments.tsx:112`, `compactRelativeTime.ts:12,16`, `section-nav-dropdown.tsx:167`, `sectionNavPattern.test.ts:10`, `alertOutsideFrame.test.ts:8`, `surfaceKitUsage.test.ts:235`): update comment strings to `docs/contributor-rules.md` in the same PR.
- **What is removed outright & rule preservation**: Removes ~930 KB of duplicated `Review:` sections, 4x-repeated setup/Docker/env instructions, 64 KB `docs/features.md` checklist wall, 166-line duplicate schema-dump recipe, PR war stories, and all stale references (`CLAUDE.md`, `backfillMediaBlurhash.ts`, `cleanClassName.test.tsx`, `allowFiles`, `epic plan`). Every `<a id="agents-...">` and `<a id="review-...">` tag is preserved and verified with the anchor-check script.
- **Risks**: Updating ~15 code/CI comments and cross-doc links when splitting `docs/contributor-rules.md` and merging the setup guides; mitigated by running `git grep` across the repo in each PR.
- **Number of PRs and their order**: 4 PRs.
  1. PR 1: Merge `docs/quickstart.md`, `docs/sqlite-setup.md`, `docs/postgresql-setup.md` into `docs/setup.md`; delete `docs/features.md`; update `README.md`, `docs/environment-variables.md`, and `.env.example`.
  2. PR 2: Unify `CONTRIBUTING.md` (absorbing `docs/setup.md` L363–440 contributor rules) and update `.github/workflows/ci.yml` + `generateDatabaseTypes.ts` comments.
  3. PR 3: Extract `docs/contributor-rules.md` from `docs/architecture.md` (L1139–4002) and `docs/maintenance.md` (L982–1720), folding `Review:` duplicates and updating the 9 code-comment references.
  4. PR 4: De-bloat `docs/mastodon-api-compatibility.md` and `docs/fitness-file-storage.md` (folding `Review:` tails and wrapping long lines), and compact `AGENTS.md` + `REVIEW.md`.

---

## Option 4: Domain-Sharded `docs/rules/` & Lean Root Hub (Deep Restructure)

Make `docs/*.md` 100% operator, architecture, and API reference by extracting **all** contributor and review rules from every doc (including `CONTRIBUTING.md`, `architecture.md`, `maintenance.md`, `mastodon-api-compatibility.md`, `fitness-file-storage.md`, and `setup.md`) into six topic-sharded files under `docs/rules/`, folding `REVIEW.md` into `AGENTS.md`, and consolidating setup docs.

### Target file list & rough size after
- `README.md` — **kept / updated** (9 KB → ~9 KB): self-contained zero-to-running guide (with `ACTIVITIES_ALLOW_EMAILS`) + feature summary + updated docs index.
- `CONTRIBUTING.md` — **slimmed to human onboarding guide** (95 KB → ~22 KB): prerequisites, local dev setup, PR process, commit prefixes, and links to `AGENTS.md` and `docs/rules/`. All detailed agent/testing/task recipes move to `docs/rules/testing-and-workflow.md`.
- `AGENTS.md` — **canonical agent hub + review checklist** (44 KB + 11 KB `REVIEW.md` → ~26 KB): keeps core inline rules (`L1–267`), absorbs `REVIEW.md`'s one-line review checklist table (`L22–88`), and maps every topic directly to `docs/rules/*.md`.
- `REVIEW.md` — **deleted / merged into `AGENTS.md`** (11 KB → 0 KB).
- `LICENSE.md` (1 KB) & `.github/PULL_REQUEST_TEMPLATE.md` (~1.2 KB) — **kept / tightened**.
- `docs/architecture.md` — **pure architecture reference** (528 KB → ~90 KB): `L1–1138` + `L4003–4032` only, trimmed of feature/war-story bloat.
- `docs/setup.md` — **unified operator setup guide** (57 KB combined → ~32 KB): merges `quickstart.md`, `sqlite-setup.md`, `postgresql-setup.md`.
- `docs/environment-variables.md` — **pure env reference** (97 KB → ~65 KB).
- `docs/maintenance.md` — **pure operator script guide** (261 KB → ~75 KB): `L1–981` only, deduplicated.
- `docs/mastodon-api-compatibility.md` — **pure API compatibility & extensions reference** (251 KB → ~70 KB): `L1–1095` only (divergences, not planned, extensions with subheadings).
- `docs/fitness-file-storage.md` — **pure fitness architecture/operator reference** (193 KB → ~35 KB): `L1–463` only.
- `docs/rules/testing-and-workflow.md` — **new** (~45 KB): Testing Guidelines, Known failure classes, Local Browser Testing, Task Recipes, Schema dump & Kysely regen, Design Library Sync, Code Review Loop, Commit/PR rules (from `CONTRIBUTING.md` L522–1476 + `setup.md` L363–440).
- `docs/rules/ui-and-client.md` — **new** (~45 KB): Server/Client boundary, instance limits, date serialization, client API calls, navigation, PageHeader/SectionNavDropdown, Surfaces, settings forms, post action row & post media layout (from `architecture.md` + `mastodon-api-compatibility.md` L1358–1686).
- `docs/rules/api-and-federation.md` — **new** (~45 KB): Client-facing entity IDs, Zod validation, ActivityPub & JSON-LD, fetched document `id`, case-insensitive/local usernames, status visibility, status delete/unboost, actor profile/move/rename, link preview cards, emails (from `mastodon-api-compatibility.md` L1096–1978 + `architecture.md` L1515–2802).
- `docs/rules/auth-and-security.md` — **new** (~25 KB): Better-auth plugins/joins/session refresh, OAuth client/sliding expiry/actor grants, unconfirmed accounts, outbound HTTP/SSRF, uploaded filenames, stored media URL/path confinement (from `architecture.md` L2803–2904 + `maintenance.md` L1118–1222).
- `docs/rules/database-and-storage.md` — **new** (~25 KB): Kysely & DB compatibility guidelines, composite index order, TOCTOU unique constraints, idempotency state machine, media details/EXIF/gallery, deleting media a post uses (from `maintenance.md` L995–1117, L1223–1529).
- `docs/rules/fitness.md` — **new** (~35 KB): Fitness stat strips, Apple Maps basemap, activity dates, route heatmap pyramid, fitness gear (from `fitness-file-storage.md` L464–1556).
- `docs/features.md`, `docs/quickstart.md`, `docs/sqlite-setup.md`, `docs/postgresql-setup.md` — **deleted**.

- **Total size after**: ~575 KB (down from ~1.6 MB; ~64% reduction).
- **How agent rules stay reachable**: `AGENTS.md` is the single entry point containing core rules + the review checklist + a 6-row table mapping each domain to its `docs/rules/<domain>.md` file. Agents only load the ~25–45 KB rule file for the domain they are editing instead of a 250–528 KB mixed doc.
- **How code/test/CI doc references are kept or updated**: Requires updating ~35 non-markdown comments/error strings across `.github/workflows/ci.yml`, `.oxlintrc.json`, `app/`, `lib/`, and `scripts/` that name `CONTRIBUTING.md`, `REVIEW.md`, `docs/architecture.md`, `docs/mastodon-api-compatibility.md`, `docs/maintenance.md`, or `docs/setup.md` for contributor rules. `lib/config/envDocumentation.test.ts` (`docs/environment-variables.md`) is unaffected.
- **What is removed outright & rule preservation**: Removes ~1 MB of duplicates, `Review:` repeats, war stories, `docs/features.md`, and stale claims while consolidating every rule into exactly one `docs/rules/*.md` file with preserved `<a id="agents-...">` and `<a id="review-...">` anchors.
- **Risks**: Highest churn (~35 code/CI comment updates and all cross-doc links); separating rules from `docs/fitness-file-storage.md` and `docs/mastodon-api-compatibility.md` means readers of those two subsystem docs must open a second file in `docs/rules/` for invariants.
- **Number of PRs and their order**: 5 PRs.
  1. PR 1: Consolidate setup docs into `docs/setup.md`, delete `docs/features.md`, and clean up `README.md` + `docs/environment-variables.md`.
  2. PR 2: Create `docs/rules/testing-and-workflow.md` and `docs/rules/database-and-storage.md` from `CONTRIBUTING.md`, `docs/setup.md`, and `docs/maintenance.md`; slim `CONTRIBUTING.md` and `docs/maintenance.md`; update `ci.yml`.
  3. PR 3: Create `docs/rules/ui-and-client.md` and `docs/rules/auth-and-security.md` from `docs/architecture.md` and `docs/maintenance.md`; slim `docs/architecture.md` to pure architecture.
  4. PR 4: Create `docs/rules/api-and-federation.md` and `docs/rules/fitness.md` from `docs/mastodon-api-compatibility.md`, `docs/architecture.md`, and `docs/fitness-file-storage.md`.
  5. PR 5: Merge `REVIEW.md` into `AGENTS.md`, point `AGENTS.md` to `docs/rules/*.md`, and update remaining code comments.

---

## Recommendation

**Recommend Option 3 (Modular Subsystem Guides & Consolidated Setup)** — or **Option 4** if you want agent context windows minimized by loading ~35 KB domain rule shards instead of a ~155 KB combined `docs/contributor-rules.md`. Option 3 gets nearly all of the size reduction (~1.6 MB → ~665 KB, -58%) and fixes the two biggest usability failures (`docs/architecture.md` being 72% contributor rules, and operator setup being scattered across 5 files) while keeping fitness and Mastodon API rules colocated with their subsystem specs and limiting code/CI reference updates to ~15 lines.

**First PR to do**: **PR 1 of Option 3** — merge `docs/quickstart.md`, `docs/sqlite-setup.md`, and `docs/postgresql-setup.md` into `docs/setup.md` (`#quickstart`, `#sqlite`, `#postgresql`), delete `docs/features.md` (folding its feature overview into `README.md`), add `ACTIVITIES_ALLOW_EMAILS` to `README.md`, and clean up `docs/environment-variables.md`. It is self-contained, touches zero agent rules, and immediately cleans up the operator onboarding path.
