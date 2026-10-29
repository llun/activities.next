# Consult: glm

## Read of the problem

The doc set is not too big because it covers too much; it is too big because the same rule is stated 2-5 times and history is filed as reference. Four files (architecture.md 528 KB, maintenance.md 261 KB, mastodon-api-compatibility.md 251 KB, fitness-file-storage.md 193 KB) are 87% of docs/, and 30-75% of each is a "Contributor rules" section that mixes durable rules with "Review:" bullet catalogs, past-PR narratives and version-scoped text (findings estimate ~30-40% of those sections is restatement or narrative). CONTRIBUTING.md is two documents: a human guide (L1-706) plus a "Contributor workflow reference" (L707-1476) that duplicates the first half's Testing, PR and CI sections 3-5x. AGENTS.md spends ~190 of 468 lines on 47 pointer stubs that all say the same sentence. Separately, four statements describe a CLAUDE.md symlink that does not exist, and maintenance.md documents an untracked script. The good news: 0 broken anchors, almost nothing factually stale, and only one test actually reads a doc (`lib/config/envDocumentation.test.ts`, substring match on `docs/environment-variables.md`), so most moves are cheap.

## Option 1: Tidy in place (light)

Keep every file and its structure. Delete history, dedupe, fix stale claims. No rule moves anywhere.

- Target file list:
  - README.md: kept, ~9 KB. Dedupe the Docker paragraph (L121) against docs/sqlite-setup.md; name `ACTIVITIES_ALLOW_EMAILS` in Quick Start so zero-to-running is self-contained.
  - CONTRIBUTING.md: kept, ~60-65 KB. Collapse the 3x-repeated CI-check/CI-success text (L406 vs L1469), keep one canonical statement of the 5-command gate, version prefixes, squash-merge and release:major rules; strip past-PR narratives from Testing Guidelines (L713-1151) and Code Review Loop (L1302-1350); replace the 33-file pg test list with the script invocation.
  - AGENTS.md: kept, ~28-30 KB. Compress the 47 pointer stubs (L268-456) into one anchor table; drop the two stale CLAUDE.md claims (L144, L262); keep the SectionNavDropdown inline rule (L316) or reduce it to the pointer.
  - REVIEW.md, LICENSE.md, PR template: kept as-is (REVIEW.md is already just an index); optionally shrink PR template checklist to pointers.
  - docs/architecture.md: kept, ~380-420 KB. Cut the 14+ history passages, the duplicated "Offline-First PWA" copy (L4003 vs L1047) and "Link Preview Cards" overlap (L1644 vs L778), the empty "dozen legacy components" fetch list, the dead `ui_kits/web/GearKit.jsx` mention (L1383); split 200-300-line Review sections into scannable bullets.
  - docs/maintenance.md: kept, ~190-210 KB. Move "Upgrading past the Knex handover" (L5-31) and "Repairs that stay with v1.192.34" (L381-423) to commit history / release notes; delete the untracked `backfillMediaBlurhash.ts` entry (~L1167-1172); dedupe the 6 near-verbatim rule repeats.
  - docs/mastodon-api-compatibility.md: kept, ~190-210 KB. Cut the id/notification migration stories duplicated in maintenance.md and architecture.md, the #1019 story, production-incident/benchmark narratives (L1350, L1699-1701), the known-gap task bullet (L1502-1504); add sub-headings to the 600-line Extensions wall (L489-1096).
  - docs/fitness-file-storage.md: kept, ~130-150 KB. Delete the ~86-line Review tail (L1471-1556) once L518-564/L623-924 are confirmed complete; cut the 12 past-PR passages; split the 302-line Heatmap Pyramid and 546-line Fitness Gear sections.
  - docs/environment-variables.md: kept, ~85 KB. Move the 119-line admin-behavior prose block (L11-129) to architecture.md; keep every variable row (test reads them).
  - docs/features.md: kept, ~45-50 KB. Drop "Planned Features"/"Feature Requests" (L152-158, plan text), de-changelog the bullets, split 4.5 KB lines into sub-headings.
  - docs/setup.md, quickstart, sqlite-setup, postgresql-setup: kept; collapse setup.md's duplicated schema-dump copy and local-DB rules (L386-431) to links into CONTRIBUTING.md; collapse sqlite/postgresql overlap (~40% of postgresql-setup.md) to links.
- Total size after: ~1.15-1.25 MB (roughly -25%).
- Agent rules stay reachable: nothing moves; AGENTS.md keeps every anchor, just with stubs in table form. Anchors `<a id="agents-...">` in CONTRIBUTING.md and docs/ are untouched.
- Code/test/CI references: `docs/environment-variables.md` path and rows untouched; ci.yml `::error::` heading names untouched; the ~111 code-comment mentions unaffected because no file renames.
- Removed outright: PR/version narratives, the v1.192.34 and Knex-handover sections, duplicated rule restatements (one canonical copy kept each), stale CLAUDE.md claims, untracked script entry, dead GearKit.jsx mention. No rule meaning lost because every cut is either narrative or a duplicate whose canonical copy stays.
- Risks: the four big files stay 200-400 KB — still walls of text; "Review:" catalogs stay mixed with rules; the biggest readability win (separating rules from reference) is not achieved. Deleting a "duplicate" risks losing a nuance that only existed in one copy; needs careful diffing.
- PRs (5):
  1. Stale fixes + AGENTS.md stub table + PR-template trim (mechanical, no content loss).
  2. CONTRIBUTING.md dedupe and de-narrative.
  3. architecture.md + mastodon-api-compatibility.md (they share the duplicated federation text).
  4. maintenance.md + fitness-file-storage.md.
  5. features.md + setup.md + small guides + README.

## Option 2: Split rules out of the big docs (medium)

Option 1's cuts, plus: extract every "Contributor rules" and "Review:" section out of the four big docs into a new `docs/rules/` tree, one file per subsystem, so reference docs become reference and rules become rules.

- Target file list:
  - New `docs/rules/` (~10-12 files, ~250-300 KB after dedupe): e.g. `docs/rules/ui.md` (architecture.md L1183-1501 + the mastodon component/CSS mechanics L1399-1686), `docs/rules/auth.md` (architecture.md L2803-2905 + review sections), `docs/rules/federation.md` (architecture.md L1982-2802 + mastodon L1159-1740), `docs/rules/media.md` (architecture.md L868-1046 + maintenance.md L995-1282), `docs/rules/fitness.md` (fitness-file-storage.md L464-1556), `docs/rules/database.md` (maintenance.md L1223-1530 + setup.md L363-440), `docs/rules/api.md` (mastodon L1117-1159, L1722-1740).
  - docs/architecture.md: kept as pure reference, ~150-180 KB (L1-1138 plus the design-decision halves of the rule topics).
  - docs/maintenance.md: kept as operator script catalog, ~120-140 KB (L1-981 minus version-scoped sections).
  - docs/mastodon-api-compatibility.md: kept as API divergence reference, ~120-140 KB (L1-1096 with sub-headings).
  - docs/fitness-file-storage.md: kept as pipeline reference, ~60-70 KB (L1-463).
  - AGENTS.md: ~25-30 KB. Front half unchanged; the 47 stubs become a table pointing into `docs/rules/` (and CONTRIBUTING.md for workflow rules). Every `<a id="agents-...">` anchor moves with its rule body; AGENTS.md links use the new anchors.
  - CONTRIBUTING.md: ~55-60 KB (Option 1's dedupe; the "Contributor workflow reference" stays as the workflow-rule home).
  - Everything else as in Option 1.
- Total size after: ~0.95-1.1 MB.
- Agent rules stay reachable: AGENTS.md remains the single entry point; its table routes every topic to exactly one rule file. Rule families: DoD, sub-agent policy, logging/API/runtime-config stay in AGENTS.md itself; workflow rules (testing, recipes, design library sync, commit/PR, review loop) stay in CONTRIBUTING.md; subsystem rules live in docs/rules/.
- Code/test/CI references: env var doc untouched. ci.yml `::error::` strings name AGENTS.md and docs/setup.md headings — "Keeping the reference schema dumps in sync" and "Regenerating the Kysely DB types" move to docs/rules/database.md, so ci.yml is updated in the same PR. The ~111 code comments naming doc files: most name the reference halves which keep their paths; the ones naming rule sections are updated in the same PR (grep first with `git grep -n "architecture.md#"`).
- Removed outright: same as Option 1, plus the rule/reference mixing itself. The "Review:" catalogs are merged into their rule files as checklists rather than deleted, so no review invariant is lost.
- Risks: biggest one — anchor churn. 0 broken anchors today; a split touches every AGENTS.md pointer and every REVIEW.md link (~30 targets in L13-21 alone), so a missed link is easy. Mitigation: keep old anchors as HTML `<a id>` redirects in the new files for one release, and add a link-check script to CI (none exists today). Also a real risk of losing rule meaning during merge of duplicated rule statements; needs a rule-by-rule checklist.
- PRs (6):
  1. Stale fixes + AGENTS.md stub table (no moves yet).
  2. CONTRIBUTING.md dedupe.
  3. Create docs/rules/database.md + media.md (from maintenance.md + setup.md), update AGENTS.md/REVIEW.md/ci.yml links.
  4. docs/rules/ui.md + auth.md (from architecture.md), update links.
  5. docs/rules/federation.md + api.md (from architecture.md + mastodon), update links.
  6. docs/rules/fitness.md + reference-side cleanups (features.md, small guides, README).

## Option 3: Consolidate the doc set (medium-deep)

Option 2's rules split, plus collapsing the small overlapping guides and the roadmap file.

- Target file list:
  - docs/quickstart.md: kept, becomes the single zero-to-running local guide (~4 KB, absorb the unique tunnel section from sqlite-setup.md L74-81).
  - docs/sqlite-setup.md, docs/postgresql-setup.md: deleted; their production/Docker/Vercel specifics (postgresql-setup.md L103-204, sqlite-setup.md L82-113) merge into docs/setup.md as "Database backends" subsections. setup.md grows to ~45 KB.
  - docs/features.md: deleted. "Current Features" collapses into README's Highlights (~+3 KB, one line per feature); the per-feature behavior detail that is reference (gallery caps, export limits, quote-post policy) already lives in architecture.md/mastodon-api-compatibility.md — the duplicated bullets just go. "Planned Features"/"Feature Requests" dropped entirely (plan text, violates the durable-reference rule).
  - docs/rules/ tree as in Option 2.
  - README.md: ~12 KB (Highlights absorbs the feature index; Documentation table shrinks by 3 rows).
  - All other files as in Option 2.
- Total size after: ~0.85-0.95 MB, and 3 fewer files.
- Agent rules stay reachable: same as Option 2; AGENTS.md's reading map drops the deleted files.
- Code/test/CI references: env var doc untouched; ci.yml headings updated with the database.md move; grep the ~111 code comments for `features.md`, `sqlite-setup.md`, `postgresql-setup.md` and update in the same PR (references.md lists them).
- Removed outright: everything from Options 1-2, plus the ~40% overlap between the three setup guides and the roadmap/checklist framing of features.md.
- Risks: deleting files that external links or muscle memory point at (features.md is linked from README's docs table); self-hosters who bookmarked postgresql-setup.md hit 404s — mitigate with a one-line "moved to setup.md" stub or GitHub redirects. Feature detail could be lost where features.md was the only plain-language home; needs a pass to confirm each unique fact has a reference home.
- PRs (7): Option 2's six, plus one that merges the setup guides and deletes features.md (do it early, PR 2, since it shrinks the surface everything else links to).

## Option 4: Single rulebook (deep restructure)

Invert the current design: instead of rules scattered across 5 files with AGENTS.md as a router, make AGENTS.md + one `docs/rules/` directory the only rule home, and shrink everything else to pure human reference.

- Target file list:
  - AGENTS.md: ~35-40 KB. Absorbs the full rule bodies of the cross-cutting sections from CONTRIBUTING.md's "Contributor workflow reference" (Testing Guidelines, Task Recipes, Design Library Sync, Commit & PR Guidelines, Code Review Loop, Style/Docs hygiene/CI checklist — L707-1476), each as a section with its existing `<a id="agents-...">` anchors preserved.
  - docs/rules/: as in Option 2 (~250-300 KB).
  - CONTRIBUTING.md: ~35-40 KB, pure human guide (L1-706 after Option 1's dedupe); every rule statement becomes a link into AGENTS.md or docs/rules/.
  - REVIEW.md: kept (~10 KB) — it is already the fast review index; its links retarget docs/rules/.
  - docs/architecture.md, maintenance.md, mastodon-api-compatibility.md, fitness-file-storage.md: pure reference as in Option 2.
  - setup guides consolidated as in Option 3; features.md deleted as in Option 3.
  - README.md, environment-variables.md, LICENSE.md, PR template: as in Options 1/3.
- Total size after: ~0.8-0.9 MB.
- Agent rules stay reachable: trivially — every rule is in AGENTS.md or one hop from it; the "Documentation and rule map" (CONTRIBUTING.md L16) and AGENTS.md's reading map merge into one table.
- Code/test/CI references: env var doc untouched; ci.yml `::error::` strings updated once, in the PR that moves the schema-dump and Kysely-types rules; the ~111 code comments audited and retargeted in the same PRs.
- Removed outright: the entire router/stub layer (47 stubs, the reading map, the rule map), all duplication between CONTRIBUTING.md's halves, everything from Options 1-3.
- Risks: highest churn and highest review cost — every agent-facing file changes at once, and agents are the most sensitive readers (a moved anchor that a model relies on degrades behavior silently). CONTRIBUTING.md's human half loses its inline rules, which human contributors may dislike. The `<!-- BEGIN:nextjs-agent-rules -->` block at the end of AGENTS.md is regenerated by `next dev` — the merge must not disturb it. This is the only option where a mistake can plausibly lose rule meaning rather than just readability.
- PRs (8-9): stale fixes; setup-guide consolidation + features.md deletion; CONTRIBUTING.md dedupe; then move one rule family at a time (workflow rules into AGENTS.md; database/media; ui/auth; federation/api; fitness), each with its link updates; final link-check PR adding a docs link/anchor check to CI.

## Recommendation

Option 2. The audit's core finding is that rules and reference are interleaved in the four big docs and restated 3-5x across files; Option 2 is the smallest change that actually fixes that, while keeping AGENTS.md as the single router (constraint 5) and leaving every test/CI-parsed path intact or updated in the same PR. Option 1 leaves the walls of text standing; Options 3-4 add file deletions and a full rulebook inversion whose churn risks the exact rule-meaning loss the constraints forbid, for marginal gain over Option 2 plus Option 3's setup-guide merge done later if wanted.

First PR: the mechanical one — fix the four stale CLAUDE.md claims, delete the untracked `backfillMediaBlurhash.ts` entry and the dead GearKit.jsx mention, drop the v1.192.34/Knex-handover sections from maintenance.md, and compress AGENTS.md's 47 stubs into an anchor table. Zero rule content changes, immediate -60 KB, and it validates the anchor/link tooling before any move.
