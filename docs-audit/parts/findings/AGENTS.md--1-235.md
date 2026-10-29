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
