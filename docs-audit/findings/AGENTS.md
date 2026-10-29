# Findings: AGENTS.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

## AGENTS.md lines 1-235

### Duplicates
- AGENTS.md:10 ≈ AGENTS.md:226 ≈ REVIEW.md:88 ≈ CONTRIBUTING.md:429 — the five-gate sequence `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` is stated four times; the DoD (line 10) and Build/Test section (line 226) are both in this slice.
- AGENTS.md:144 ≈ AGENTS.md:262 ≈ CONTRIBUTING.md:1230 — "`CLAUDE.md` is a symlink to `AGENTS.md`" stated in the structure section, again in Documentation Maintenance, and again in CONTRIBUTING.
- AGENTS.md:12 ≈ AGENTS.md:234 — DoD item 5 ("`package.json` `version` is untouched", conventional prefix) restated verbatim in Mandatory workflow ("Never manually change the package version; use a conventional commit subject and PR title"); also fully spelled out in CONTRIBUTING.md:1240-1284.
- AGENTS.md:142 ≈ AGENTS.md:262 ≈ CONTRIBUTING.md:1441 — the "docs/ is durable reference only, no plans/specs/screenshots" rule appears twice in this slice and once more in CONTRIBUTING.
- AGENTS.md:178 ≈ CONTRIBUTING.md:188 ≈ CONTRIBUTING.md:426 — "never use `console.*` in committed code" duplicated across AGENTS.md Logging and CONTRIBUTING (rules + PR checklist).
- AGENTS.md:195-196 ≈ CONTRIBUTING.md:203 (with code example) ≈ CONTRIBUTING.md:494 ≈ CONTRIBUTING.md:1163 — the `apiResponse`/`apiErrorResponse` rule and its CORS variant stated in four places.
- AGENTS.md:30 ≈ AGENTS.md:68 ≈ AGENTS.md:232 — the pointer to CONTRIBUTING.md#agents-code-review-loop-sub-agents appears three times within the slice.
- AGENTS.md:234 ≈ CONTRIBUTING.md:1264 (also 1459) — "`release:major` label; agents must never apply it" duplicated.

### Stale
- AGENTS.md:144 — "`CLAUDE.md` is a symlink to `AGENTS.md`" — checked: `git ls-files | grep -i claude` → no output (exit 1); `ls -la CLAUDE.md` → "No such file or directory". CLAUDE.md is neither tracked nor on disk, so the symlink claim (and line 262's "Keep `CLAUDE.md` as the symlink to this file") describes a file that does not exist. Same stale claim at AGENTS.md:262.
- No other stale content found. Verified as existing: all package.json scripts (`prettier`, `lint`, `typecheck`, `build`, `test`, `migrate`, `search:reindex`), Node 24 (`package.json` engines `"node": "24.x"`), `lib/database/kysely/db.ts`, migration `20261014000000_baseline`, `scripts/run.cjs`, `scripts/maintenance/rebuildSearchIndex.ts`, all six `packages/*` dirs, `scripts/{mock,maintenance,fitness,backup}`, `lint/agentsRules.mjs`, `lint/oxlintrc.scripts.json`, `lib/components/tailwindCssVariableSyntax.test.ts`, `lib/utils/{logger,toLoggableError,response}.ts` (with `DEFAULT_200`, `DEFAULT_202`, `codeMap`, `REASON_PHRASE`, `apiErrorResponse`, `apiCorsError`, `apiResponse` exports), `lib/utils/http-headers/csp`, `proxy.ts`, `app/(nosidebar)`, `lib/config/`, `.gitignore` entries (`docker-compose.yml`, `scripts/*.js`, `plans/`, `PR_DESCRIPTION.md`, `VERIFICATION_SUMMARY.md`, `AGENTS.override.md`, `!migrations/schema.sql`, `!migrations/schema.sqlite.sql`, `!migrations/baseline/*.sql`), Next 16 (`"next": "16.4.3"`), and all linked anchors in CONTRIBUTING.md / docs/setup.md / docs/maintenance.md (explicit `<a id>` tags exist). The "removed" per-tool variants (`.cursor/rules/agents.mdc`, `GEMINI.md`, `.github/copilot-instructions.md`) verified absent — statement is accurate.

### History / changelog text
- AGENTS.md:144 — "each existed and were removed" (narrative of removed per-tool rule files).
- AGENTS.md:173 — "the stale class shipped in both section-nav dropdowns at once" (past-bug story).
- AGENTS.md:206 — "this is what surfaced Phanpy's Settings 404 toast" (past-incident aside).
- AGENTS.md:139 — "the Knex migrations of v1.192.34 built" (version-history reference; borderline since the linked doc section is durable).

### Long sections
- AGENTS.md:19-133 `## Working with Sub-Agents (always)` (115 lines) — the two model/effort tables are reference and must stay, but the "Rules for the main thread" bullets and the "Guidelines" bullets largely restate what the tables already say; roughly 40-50 lines of prose could go or merge.
- No other section exceeds 80 lines; the API (194-223) and Logging (176-193) sections are line-count small but carry very long single-line bullets (see Readability).

### Task/PR-specific
- AGENTS.md:172-174 — Tailwind v4 bullet is a durable rule, but the middle sentence is an account of one specific past bug (section-nav dropdowns) tied to a single incident.
- AGENTS.md:186-188 — logging bullet embeds a case study of one past fix (missing route map → `mapError` column); the reusable rule ("grep for what reads a flag before reusing it") is buried in it.
- AGENTS.md:74-96 — the model example tables name specific current model generations ("Model names change every few months") — self-acknowledged churn; will need frequent edits.

### Readability
- Wall-of-text bullets: lines 15, 139, 142, 145, 147, 187-189, 206, 208 are 200-500+ character single lines stacking a rule, rationale, example, and cross-links; hard to scan.
- Nested caveats: the API error-shape bullet (206) carries three parentheticals and a Mastodon-client digression before reaching the rule; the Tailwind bullet (171) similarly wraps rule + mechanism + bug story + test pointer in one line.
- The "Choosing model and effort" section says the same allocation three ways: task table, tool tables, then "Guidelines" bullets — one statement plus the tables would suffice.

### Slice summary
Lines 1-235 are the prescriptive front half of AGENTS.md: Definition of Done, the sub-agent orchestration policy with model/effort tables, structure, runtime config, style, logging, API, commands, and the mandatory workflow. Almost nothing is factually stale except the CLAUDE.md symlink claim (appears twice); the big wins are cutting the ~40-50 lines of prose that restate the sub-agent tables, removing three history asides, and deduplicating the gate sequence, version/conventional-prefix rule, docs/ rule, and console/API rules against CONTRIBUTING.md and REVIEW.md.

## AGENTS.md lines 236-469

### Pointer-target check (extra)
All 51 unique `file#anchor` targets in this slice were checked by grepping each target file for `<a id="<anchor>"`. Every one resolves; none point to a missing target. Files referenced: docs/setup.md, docs/mastodon-api-compatibility.md, docs/architecture.md, docs/fitness-file-storage.md, docs/maintenance.md, CONTRIBUTING.md, REVIEW.md — all exist. Referenced repo paths and symbols verified too: `lib/components/section-nav-dropdown.tsx` and `lib/components/sectionNavPattern.test.ts` exist; `getClientStatusId`, `getClientActorId`, `apiErrorResponse` all grep in `lib/`.

### Duplicates
- AGENTS.md:318 ≈ docs/architecture.md:1320 — the SectionNavDropdown rule ("Every section switches between its pages with `SectionNavDropdown` … do not render a navigation list, rail, tab strip … `sectionNavPattern.test.ts` fails on a reintroduction") is stated in full in both places. AGENTS.md even admits "One rule is repeated here because it is easy to break by accident".
- AGENTS.md:243, 254, 270 ≈ each other — the same anchor `docs/mastodon-api-compatibility.md#agents-client-facing-entity-ids` is linked three times in the slice (reading-map table, cross-cutting bullet, pointer section). Same pattern for `agents-server-client-module-boundary` (244, 257, 290) and `agents-security-configuration-tips` (246, 258/266, 430): the reading map, the cross-cutting bullets, and the pointer sections all route to the same ~10 targets.
- AGENTS.md:264-266 ≈ AGENTS.md:428-430 — "Security & Data Safety" (prose summary + link to docs/maintenance.md#agents-security-configuration-tips) and the later "Security & Configuration Tips" pointer (same link) cover the same target twice in the slice.

### Stale
- AGENTS.md:262 — `CLAUDE.md` ("Keep `CLAUDE.md` as the symlink to this file") — checked: `git ls-files | grep -i claude` → no match; `git log --oneline -- CLAUDE.md` → latest commit is e5d19667d "Remove CLAUDE.md". The symlink no longer exists; the instruction points at nothing.
- AGENTS.md:256 — `safeParse` as a named helper ("API handlers use `safeParse`, `apiResponse`, and `apiErrorResponse`") — checked: `git grep -n 'export.*safeParse' -- lib` → no hits; there is no shared `safeParse` helper, only zod's `.safeParse` method on schemas. Ambiguous wording rather than a hard stale ref; `apiResponse` / `apiErrorResponse` do exist.
- AGENTS.md:462-466 — `node_modules/next/dist/server/lib/generate-agent-files.js` — checked: `ls node_modules/next/dist/server/lib/generate-agent-files.js` → not found, but `node_modules/` is not installed in this checkout, so this is unverifiable, not necessarily stale.

### History / changelog text
- AGENTS.md:270 et al. (48 occurrences, lines 268-458) — "The durable rule source **moved to** …" — each pointer section is phrased as a migration note ("moved to", used ~41 times) instead of a durable pointer ("lives in" is used for 7 others). The "moved" narrative is changelog residue; all of these could read "The rule lives in …".

### Long sections
- none — no ## section in the slice exceeds 80 lines; the longest are "Required subsystem reading map" (236-250, 15 lines) and "Cross-cutting data and protocol rules" (252-258, 7 lines).

### Task/PR-specific
- none — no checklists, PR numbers, dates, or release notes in the slice.

### Readability
- AGENTS.md:268-458 — a ~190-line run of 48 near-identical two-line pointer sections, each one heading + one sentence. This is the bulk of the slice; a single table (topic → target anchor) would replace ~190 lines with ~15 and remove the "moved to/lives in" phrasing drift.
- AGENTS.md:318 — 707-character single line (wall of text) mixing the pointer, the repeated rule, index-page exceptions, and the test-name enforcement; hard to scan.
- AGENTS.md:252-258 — five bullets each ending in a "Read the … before …" pointer; combined with the reading-map table above (236-250) the same routing instruction appears three times within ~35 lines.

### Slice summary
This slice is the routing half of AGENTS.md: a reading map, cross-cutting rules, and ~48 one-line pointer sections that all say "the rule moved to <guide>". All link targets are valid. Nearly the whole slice (roughly 268-458, ~190 lines) is compressible into one anchor table, and the SectionNavDropdown rule at line 318 is a confirmed true duplicate of docs/architecture.md:1320; the stale `CLAUDE.md` instruction at line 262 should be dropped.

