# Consult: fable

## Read of the problem

- The docs are not wrong, they are triplicated. ~865 KB of the 1.6 MB is `## Contributor rules` appended to five reference guides (architecture 400 KB from L1139, maintenance 193 KB from L982, mastodon 172 KB from L1096, fitness 80 KB from L464, setup 20 KB from L363). Inside those, ~180 KB is `### Review: …` sections (architecture L2905-4002, maintenance L1283-1711, mastodon L1740-1978, fitness L1471-1556) that restate the rule section a few hundred lines above them (fitness's two Review sections are 86/86 lines of restatement; architecture L3564-3642 restates L2889-2895; maintenance L1283-1331 restates L1129-1173).
- The routing layer is three layers deep. AGENTS.md L236-250 (reading map), L252-258 (cross-cutting bullets) and L268-458 (47 two-line "moved to" stubs) all route to the same ~10 anchors; REVIEW.md L13-19 then re-lists the same targets a fourth time. 190 lines of AGENTS.md say nothing but "read elsewhere".
- CONTRIBUTING.md is two documents: a generic contributing guide (L1-706) and the "Contributor workflow reference" (L707-1476); the five-gate command, CI check list, `release:major`, Zod `safeParse`, `vi.importMock`, `createDeferred`, schema-dump recipe each appear 3-5 times across the two halves plus AGENTS.md, REVIEW.md, docs/setup.md and the PR template.
- Rules are buried in incident narrative: findings list ~150 passages of "used to", PR numbers (#1019, #1122, #1559-#1570, #1592, #2226, #2594/#2597), dated production plans (maintenance L1225-1230) and pixel measurements (architecture L1296-1311, fitness L1281-1292) inside durable rules. Single bullets run 300-7,000 characters (mastodon L1293+, L1702).
- Actual staleness is small and fixable in an hour: CLAUDE.md symlink claims (AGENTS L144/L262, CONTRIBUTING L1219/L1230; `e5d19667d` removed the file), `backfillMediaBlurhash.ts` (maintenance L1167-1172), the empty `allowFiles` "dozen legacy components" (architecture L1509), `stepsCsv.ts` path (architecture L405), `cleanClassName.test.tsx` (setup L383), "the epic plan" (mastodon L1012), Media Sort Date Backfill misfiled under v1.192.34 repairs (maintenance L401-412), and `ci.yml:763/862` pointing at `AGENTS.md → 'Keeping the reference schema dumps in sync'`, a heading that lives in CONTRIBUTING.md L522 and docs/setup.md L396, not AGENTS.md.
- The self-hoster path works (README findings), bar one gap: `ACTIVITIES_ALLOW_EMAILS` is never named inline, so sign-up fails on both the dev and Docker paths until the reader opens setup.md.
- Nothing executable depends on headings except `lib/config/envDocumentation.test.ts` reading `docs/environment-variables.md` by path (substring match on variable names; headings are free). Everything else (111 code comments, 4 lint messages, 3 CI `::error::` strings, 2 operator messages) is prose that must be kept in step by grep. There is no link check in CI, so every option below starts by adding one.

Common to every option (call it PR 0): add `test/docLinks.test.ts` (~30 lines: every `](file.md#anchor)` in `*.md` must find `<a id="anchor">` or a matching heading in that file; root-level tests live in `test/`). It turns "did we break a link" into a gate for all later PRs and is the only new code any option needs.

## Option 1: Stale fix and exact-duplicate removal (light tidy)

Edit in place; no file is created, renamed, split or deleted.

Target file list:
- `AGENTS.md` (44 → ~24 KB): drop CLAUDE.md claims at L144/L262 (keep the "no per-tool variants" sentence); replace the 47 stubs L268-458 with one table `Topic | Rule lives in` (~50 rows, ~6 KB); delete the SectionNavDropdown repeat at L318 (full copy at architecture L1320); remove the three incident asides (L144 "each existed and were removed", L173 section-nav story, L206 Phanpy story). Keep L1-235 otherwise untouched.
- `CONTRIBUTING.md` (95 → ~80 KB): delete the tail L1437-1476 ("Docs hygiene", "Commits & versioning", "CI checklist"; each is a compressed copy of L1217-1301 and L406-430); delete the duplicated `vi.importMock`/`createDeferred`/`runInReactCacheScope` bullets at L1416-1436, L1371-1389 (originals L897-983); fix CLAUDE.md at L1219/L1230; replace the 33-file list L292-336 with the glob it describes.
- `REVIEW.md` (11 → ~9 KB): drop the "Review lenses" list L13-19 (same targets as the body); keep every checklist row and link.
- `docs/architecture.md` (528 → ~495 KB): delete the stub at L1047-1049 and the second "Offline-First PWA" at L4003 (keep one body); delete "Review: Unconfirmed accounts & app tokens" L3564-3642 after checking each bold rule against L2887-2904; fix L405 and L1509; strip the listed history sentences (L92-93, L117, L167-170, L1186, L1226, L1247, L1320, L2796, L2826, L2896-2900, L3663, L3895 and the others in `findings/docs-architecture.md`).
- `docs/maintenance.md` (261 → ~245 KB): fix L1167-1172; move "Media Sort Date Backfill" L401-412 out of "Repairs that stay with v1.192.34" to "Other Scripts"; cut the dated plan numbers L1225-1230 to the two-line rule; delete "Review: Uploaded file names" L1283-1315 (restates L1125-1136).
- `docs/mastodon-api-compatibility.md` (251 → ~240 KB): remove "epic plan" L1012-1013 and the known-gap tracker L1502-1504 (an issue, not a rule); strip PR-number sentences (L1302, L1330, L1332, L1702, L1835-1837); move the rollout narrative L65-104 to a two-line note.
- `docs/fitness-file-storage.md` (193 → ~185 KB): delete both Review sections L1471-1556 after moving their `<a id="review-…">` tags onto L518 and L623; strip the 12 past-bug passages listed in the findings.
- `docs/environment-variables.md` (97 → ~93 KB): delete the two upgrade blockquotes L331/L333, the Lambda migration lines L207-211, the roadmap clause L490. File name and every variable row stay (the test).
- `docs/setup.md` (39 → ~36 KB): fix L383; keep the schema-dump procedure (CI names its headings).
- `README.md` (9 → 8 KB): split the L121 paragraph into four bullets that link sqlite-setup.md; name `ACTIVITIES_ALLOW_EMAILS` in step 4 and the Docker command.
- `.github/workflows/ci.yml` L763/L862: point at `CONTRIBUTING.md → 'Keeping the reference schema dumps in sync'`.
- `docs/features.md`, `docs/quickstart.md`, `docs/sqlite-setup.md`, `docs/postgresql-setup.md`, `LICENSE.md`, PR template: kept as is.

Total after: ~1.42 MB (about 12% less). Same 16 files.

Agent rules: AGENTS.md keeps DoD, sub-agent policy, project structure, runtime config, coding style, logging, API response, build commands, mandatory workflow and the reading map verbatim; the stub run becomes the table, with the same anchors. Each rule family stays where it is now.

Code/test/CI references: only headings that disappear are the 47 stub headings in AGENTS.md. `lint/agentsRules.mjs` L359-477 cite four of them ("API Response Guidelines" stays, it is a real section; "Zod Validation in API Routes", "A stored path is confined to the storage root", "Client-Side API Calls" move): change the message suffix to the destination doc (`agentsRules.test.ts` does not assert on that text; L13/L241 are comments). The ~20 code comments naming those headings get the same one-word edit by grep. `envDocumentation.test.ts`, `baseline.ts:32`, `startupCheck.ts:30`, `ci.yml:879` are untouched.

Removed outright: CLAUDE.md claims, the dead paths above, the four Review sections that are pure restatement, the CONTRIBUTING tail, the AGENTS stub prose, ~150 history sentences. Meaning check: before deleting a section, list its bold lead-ins and every sentence containing never/always/must/only, and grep the key identifier of each in the surviving section; anything unmatched is moved, not deleted. The docLinks test catches anchor loss.

Risks: low. The docs stay 1.4 MB, so the "hard to read" complaint is only partly answered; the three-layer routing in AGENTS.md L236-258 survives; CONTRIBUTING is still two documents.

PRs (3, after PR 0):
1. Stale fixes + ci.yml + README gap (small, no judgement calls).
2. AGENTS.md table + CONTRIBUTING tail + REVIEW lenses + lint message text.
3. Delete the duplicate Review sections and history sentences, one commit per doc.

## Option 2: One rule, one place (medium)

Option 1 plus: merge every `### Review:` section into the durable rule section it restates, make AGENTS.md a short policy file with a single routing table, and fold CONTRIBUTING's two halves into one.

Target file list:
- `AGENTS.md` (44 → ~12 KB): keep DoD (L5-17), sub-agent policy with both tables but the "Guidelines" bullets L118-133 cut to the escalation ladder line (findings: ~45 lines restate the tables), Project Structure, Runtime Configuration, Coding Style, Logging, API Response, Build commands, Mandatory workflow, Security & Data Safety, Documentation Maintenance. Replace L236-258 and L268-458 with one routing table (change area → required reading anchor), ~25 rows. Keep the Tailwind v4 and `mapError` rules as one line each.
- `CONTRIBUTING.md` (95 → ~50 KB): one document. Keep L1-115 trimmed (prerequisites, branch naming, commit prefixes once), then the workflow reference sections as the only copy: Testing Guidelines split into four `###` (harness, mocking, time zones, isolation) with the 10 war stories cut, Local Manual Testing (keep; it is a verified runbook, but drop the `/Users/llun/...` path at L1199), Task Recipes (delete the first-half "Common Tasks" L487-521, keep L1152-1197), Design Library Sync, Documentation Maintenance, Commit & PR Guidelines (version rule stated once: table only), Code Review Loop. Move "Updating the reference schema dumps" L522-687 to docs/setup.md where the sibling procedure already is (setup L396-431), leaving a link; CI then points at one place.
- `REVIEW.md` (11 → ~8 KB): keep the checklist; retarget its 57 `#review-…` links to the merged sections' `agents-…` anchors (or keep the `review-` ids as second `<a id>` tags on the merged section; cheaper, do that).
- `docs/architecture.md` (528 → ~370 KB): L1-1138 kept, history stripped; move the Wahoo paragraph L266 to fitness-file-storage.md and the RFC 9421 spec to one home (keep here, mastodon L1170 links). Contributor rules: merge each Review section into its rule section (Review: Runtime config → stays as the only runtime-config detail since AGENTS keeps the summary; Client components → Server/Client Boundary + Client-Side API Calls; Page chrome → Page Header & Sub-Navigation; Surfaces → Surfaces; Logging → delete, AGENTS L176-193 is complete; Auth error page / Session refresh / Sliding expiry / Unconfirmed → their rule sections; Emails → Emails; Post media layout → keep as the one media-layout home and delete mastodon L1545-1686; Status delete / Link preview cards → their sections). Split the 754-line "Actor Profile & Deletion Federation" (L2049-2802) into four `####` (profile editing, account migration, handle rename, profile links) and cut the Move/moved-account/rename restatements that mastodon L1171/L1295 and features L12-13 carry.
- `docs/maintenance.md` (261 → ~200 KB): Knex handover L5-30 kept but cut to a status table + procedure (operator messages name the heading); merge Review: Uploaded file names / Unique constraints / Database & migrations / Stored media / Served domains into Security & Configuration Tips and Database Compatibility Guidelines, each split into `####` by topic; strip the PR-by-PR history L1163-1204 and dated plans.
- `docs/mastodon-api-compatibility.md` (251 → ~200 KB): add `###` groups inside Intentional divergences and Extensions (ids, auth, media, admin, notifications, gallery, reactions, migration); merge Review: API routes / Actor usernames / Interop quirks / Fetched ids into Zod Validation, Actor Usernames, ActivityPub & JSON-LD, Fetched Document id; delete the component/CSS mechanics L1399-1544 and L1545-1686 in favour of one link to architecture; break the 3-7 KB single-line bullets at L1293+ into sub-bullets.
- `docs/fitness-file-storage.md` (193 → ~150 KB): Option 1 cuts plus split Fitness Gear (L925-1470, 546 lines) and Route Heatmap Pyramid (L623-924) into `####`; delete the gear storage/import rules that repeat the file's own Gear Tracking L266-300; drop the isolation paragraph duplicate at L11 (architecture L2490-2503 is the home, or the reverse, one of them).
- `docs/environment-variables.md` (97 → ~80 KB): Option 1 plus move the admin-UI walkthrough L11-129 to architecture (keep the precedence rule, ~15 lines); per-row prose in Fitness and Domain Controls shortened to one sentence + link. Every variable name stays.
- `docs/features.md` (64 → ~25 KB): one line per feature plus a link; the 2-4 KB bullets (L74, L75, L69, L77, L110, L113, L121, L149) duplicate architecture/mastodon rules word for word. "Planned Features" / "Feature Requests" L152-158 deleted (constraint 2: no plans in docs/).
- `docs/setup.md` (39 → ~40 KB): gains the schema-dump procedure, loses its own duplicate copies of the local-DB rule (three statements in L386-431 become one).
- `docs/quickstart.md` (kept, becomes the canonical dev-setup copy); `docs/sqlite-setup.md` (5.7 → ~4 KB) and `docs/postgresql-setup.md` (7.6 → ~5 KB): drop the clone/corepack/env block and JSON precedence text, link quickstart and environment-variables; keep every backend-specific step.
- `README.md` (9 → 8 KB) as Option 1; `.github/PULL_REQUEST_TEMPLATE.md`: header comment becomes two lines + link; checklist kept. `LICENSE.md` kept.

Total after: ~1.15 MB. Same 16 files.

Agent rules: AGENTS.md = policy (DoD, sub-agents, cross-cutting rules) + one routing table; every subsystem rule has exactly one home, the `agents-…` anchors (52 `<a id>` tags today) are kept on the merged sections. REVIEW.md is the review index into the same anchors. The five named rule families: DoD stays in AGENTS.md L5-17; design library sync stays CONTRIBUTING `agents-design-library-sync`; root-level tests in `test/` stays in AGENTS Project Structure; sub-agent policy stays AGENTS L19-133; logging / API response / runtime config stay AGENTS L149-223.

Code/test/CI references: as Option 1, plus: ci.yml L763/L862 and L879 point at docs/setup.md after the schema-dump move (also fix `lib/database/kysely/db.ts:3`, `generateDatabaseTypes.ts:11/268`, `migration.stub:14`, which already say setup.md); the two CONTRIBUTING headings ci.yml L722/L771 cite in comments ("SQLite — migrations/schema.sqlite.sql", "PostgreSQL — migrations/schema.sql") move with the procedure, so those comments get the file name changed. Code comments naming "Review: …" headings: none found (references.md lists "Post media layout", "Surfaces", "Forms.", "Page Header & Sub-Navigation", all of which survive as rule-section headings). `envDocumentation.test.ts` untouched.

Removed outright: everything in Option 1, the Review layer (~180 KB) after merging any sentence not already present, the CONTRIBUTING first-half duplicates (Common Tasks, Writing Tests, CI cache internals L414-420), features.md prose, the setup-guide boilerplate in three files, the admin walkthrough in env vars, the component/CSS mechanics in the Mastodon doc. Meaning check: merge is done per Review section as a two-column scratch table (Review sentence → surviving line) before the delete commit; the table is pasted in the PR description so a reviewer can spot-check; unmatched rows are inserted as sub-bullets into the rule section. One PR per doc keeps each table reviewable.

Risks: medium. Merging Review sections is judgement work; a reviewer who does not know the subsystem cannot tell a dropped nuance from a cut. Mitigation: the scratch table plus the existing tests that pin most of these rules (`sectionNavPattern`, `surfaceKitUsage`, `clientModuleBoundary`, `publiclyReadable*`, `routeScopeWiring`, …): a rule with a pinning test can lose its prose rationale safely. REVIEW.md's 57 links are the most link churn; the `<a id="review-…">` tags move with the text, so the docLinks test covers it. Files stay large (architecture ~370 KB), which the next option addresses.

PRs (7, after PR 0):
1. Option 1 PR 1 (stale, ci.yml, README).
2. AGENTS.md policy + routing table; lint message text; PR template header.
3. CONTRIBUTING fold + schema-dump move to setup.md + ci.yml/db.ts message updates.
4. architecture.md: merge Review sections, split Actor Profile, strip history.
5. maintenance.md + mastodon-api-compatibility.md: merge Review sections, add groups.
6. fitness-file-storage.md + environment-variables.md + features.md.
7. quickstart/sqlite/postgresql dedupe + REVIEW.md retarget.

## Option 3: Split by subsystem (deep restructure, content preserved)

Option 2's cuts, then split the four big guides so no file exceeds ~120 KB and each subsystem's reference and rules sit in one file with the rules at the end (the pattern the repo already uses).

Target file list (docs/ grows from 10 to 17 files):
- `docs/architecture.md` (~90 KB): L1-1138 only (system, request flow, directory, design decisions, schema, stack) plus the cross-cutting rules Server/Client Boundary, Date Serialization, Client-Side API Calls, Outbound HTTP, Link prefetching, Instance Limits.
- New `docs/ui-chrome.md` (~110 KB): Navigation Customization, Page Header & Sub-Navigation, Fitness Overview Calendar, Surfaces, Photo Editor, Settings Forms, Post media layout (from architecture L3684-3876 and mastodon L1545-1686), colour tokens.
- New `docs/auth.md` (~60 KB): Authentication (L172-184), Better-auth (L2803-2841), OAuth (L2842-2886), Auth Error Page, Unconfirmed Account, OAuth Grants; plus maintenance's session-delete rule L1278.
- New `docs/federation.md` (~120 KB): ActivityPub Federation (L196-256), the RFC 9421 spec, Status Delete & Unboost, Actor Profile & Deletion Federation (split into four `###`), Account data export/import (L379-777), and from the Mastodon doc: ActivityPub & JSON-LD, Fetched Document id, Local Actors, Local Usernames, Who May See, Publicly Readable ids.
- New `docs/emails-and-previews.md` (~50 KB): Transactional Emails, Link Preview Cards (L778-805 + L1644-1981 + Review L3908-4002).
- `docs/mastodon-api-compatibility.md` (~110 KB): divergences, not planned, extensions (grouped), Client-Facing Entity IDs, Zod Validation, Actor Usernames, Status Posts & Actions (contract only).
- `docs/maintenance.md` (~90 KB): scripts and operator procedures only (L1-981, cleaned).
- New `docs/storage-and-media.md` (~80 KB): Media & File Storage (architecture L868-1046), Media Details/EXIF/Gallery, Deleting Media a Post Uses, Security & Configuration Tips, Stored media review rules, uploaded file names.
- New `docs/database.md` (~50 KB): Database Abstraction, Knex handover (heading kept), schema-dump and Kysely-types procedures (from CONTRIBUTING L522-687 and setup L396-431), Composite Index rule, Database Compatibility Guidelines, Database & migrations review rules.
- `docs/fitness-file-storage.md` (~70 KB): overview, config, schema, pipeline, API, scripts, security, Fitness Activity Dates, Stat Strips, Apple Maps. New `docs/fitness-gear.md` (~45 KB) and `docs/fitness-heatmap.md` (~45 KB) take the two 300-550-line sections plus architecture's Route Heatmap Tiles L806-866.
- `docs/setup.md` (~25 KB), `docs/environment-variables.md` (~80 KB, same name), `docs/features.md` (~25 KB), quickstart/sqlite/postgresql as Option 2.
- `AGENTS.md` (~12 KB) as Option 2, routing table now has one row per new file. `CONTRIBUTING.md` (~45 KB) as Option 2 minus the database procedures. `REVIEW.md` (~8 KB) retargeted. `README.md` docs table L137-151 lists the new files.

Total after: ~1.1 MB over 23 files; largest file ~120 KB.

Agent rules: AGENTS.md unchanged from Option 2; the routing table is the only thing that knows the file layout, so an agent reads AGENTS.md and one ~50-120 KB file per subsystem instead of grepping a 528 KB one. Every `<a id="agents-…">` tag moves with its section; the old file keeps nothing, so links must be rewritten (not aliased), which the docLinks test enforces.

Code/test/CI references: the expensive part. 111 code-comment hits name files in prose: architecture (11), maintenance (6), mastodon (6), setup (8) plus the 67 AGENTS.md hits whose headings now live in new files. Each move PR runs `git grep -n '<old file> → '<heading>'` and edits the comment to the new file (mechanical, ~40 edits total). Executable or user-facing strings: `baseline.ts:32` / `startupCheck.ts:30` ("Upgrading past the Knex handover") change to `docs/database.md`; ci.yml L763/L862/L879 change to `docs/database.md`; `lint/agentsRules.mjs` messages change to the destination file. `envDocumentation.test.ts` is untouched because environment-variables.md keeps its name.

Removed outright: as Option 2. Content is otherwise moved, not cut; the meaning check is the same scratch table plus `git diff --color-moved=dimmed-zebra` on each move PR, which makes moved text grey and new/deleted text visible, so a reviewer only reads the non-grey lines.

Risks: medium-high. External links into `docs/architecture.md#…` (GitHub issues, the llun/sketch repo, chats) break; nothing in this repo tracks them. Seven new files means seven more places a rule can be put in the wrong one; the routing table has to be exact. Review cost is the highest of the four. Upside is the only option where a human can read a subsystem's rules top to bottom.

PRs (9, after PR 0): Option 2 PRs 1-3 first, then one move PR per new file in this order (lowest inbound-link count first): fitness-gear, fitness-heatmap, database, storage-and-media, auth, emails-and-previews, ui-chrome, federation; each PR moves text, retargets links, updates comments, and runs the docLinks test. README table last.

## Option 4: Rule cards (deep rewrite)

Rewrite every contributor rule as a fixed-shape card: one bold rule line, at most three lines of why, the test or lint rule that pins it, a link to the reference section. All narrative goes; reference sections (request flow, schema, API tables, env vars, scripts) stay as in Option 2.

Target file list: file layout as Option 3 (or Option 2; independent choice). Contributor-rule text shrinks by roughly two thirds: architecture rules 400 → ~120 KB, maintenance 193 → ~60 KB, mastodon 172 → ~60 KB, fitness 80 → ~30 KB, CONTRIBUTING workflow reference 50 → ~25 KB. Reference halves as Option 2.

Total after: ~0.65 MB.

Agent rules: as Option 2/3; the card shape makes "what is the rule" one grep (`^- \*\*`).

Code/test/CI references: as Option 2 or 3 depending on layout.

Removed outright: every why that is longer than three lines, every incident, measurement and PR number. Meaning check is the hard part: the brief's constraint 1 ("rules may be reworded, not lost") is only checkable sentence by sentence, and the findings show rationale and rule are interleaved in 60-90-line bullets (architecture L2096-2171, L2193-2284; maintenance L1154-1160's 700-word ffmpeg bullet). A reviewer has to judge each cut.

Risks: high. The long rationales exist because reviews kept re-litigating the rule (CONTRIBUTING L1313: "nearly every serious finding after round 1 was a regression"); cutting the why invites the same regressions, and no test pins the ones that are judgement calls. This is also the only option whose cost is proportional to the content (1.6 MB of reading and rewriting) rather than to the structure.

PRs: Option 2 or 3 first, then one rewrite PR per file (8-10), each needing a reviewer who knows the subsystem.

## Recommendation

Option 2. It removes the structural waste (the Review layer, the triple routing, the two-document CONTRIBUTING, the setup-guide boilerplate) and the confirmed stale text, keeps every rule in exactly one place with its anchors, and never needs a judgement call about whether a rationale is worth keeping; the only judgement is "is this Review sentence already in the rule section", which the scratch table makes reviewable. Option 1 leaves the routing and Review duplication that cause most of the reading cost; Option 3's file split is the right end state but can be done later on top of Option 2 with no rework (Option 2 does not touch file names); Option 4 trades meaning for size.

First PR: PR 0 + Option 2's PR 1 together, in one small PR: `test/docLinks.test.ts`, the CLAUDE.md claims (AGENTS L144/L262, CONTRIBUTING L1219/L1230), `backfillMediaBlurhash.ts` (maintenance L1167-1172), architecture L405 and L1509, setup L383, mastodon L1012-1013, the Media Sort Date Backfill move, `ci.yml:763/862` to CONTRIBUTING.md, README L121 into bullets and `ACTIVITIES_ALLOW_EMAILS` named inline. No rule changes, no judgement calls, and it leaves a link gate in place for everything after.
