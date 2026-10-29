# Findings: REVIEW.md lines 1-91, LICENSE.md lines 1-22, .github/PULL_REQUEST_TEMPLATE.md lines 1-26

## REVIEW.md lines 1-91

### Duplicates
- REVIEW.md:17 ≈ CONTRIBUTING.md — "Testing Guidelines", "Known failure classes", "Style, imports & tests" all re-link to CONTRIBUTING.md sections that carry the actual rules; this file is an index, so the content lives once, but the three-lens list (lines 15-19) re-links the same targets ("Where findings come from" appears in both the Correctness and Scope & regression rows).
- REVIEW.md:88 (`yarn run prettier --write .` … `yarn build`, `yarn test`) ≈ CONTRIBUTING.md → Documentation Maintenance / PR checklist and .github/PULL_REQUEST_TEMPLATE.md:26 — the five-command Definition-of-Down list is stated verbatim in at least three places.
- REVIEW.md checklist rows (lines 22-84) ≈ docs/architecture.md "Review: …" sections and docs/maintenance.md:1283-1331 — each row is a one-line summary plus a link; the summaries duplicate the first sentence of the target section.

### Stale
- none — checked: all `docs/*.md#review-…` link targets have matching `### Review: …` headings; `CONTRIBUTING.md#review-style-imports-tests` has an explicit `<a id>` at CONTRIBUTING.md:1354; `agents-code-review-loop-sub-agents`, `agents-testing-guidelines`, `agents-known-failure-classes` all exist as explicit `<a id>` anchors in CONTRIBUTING.md; `yarn lint/typecheck/test/build/prettier` scripts exist in package.json; `migrations/schema.sql`, `migrations/schema.sqlite.sql`, `migrations/baseline/`, `migrations/index.ts`, `migrations/names.ts` exist; `OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS` exists (lib/services/auth/auth.ts:19).

### History / changelog text
- none — the intro's "recurring patterns surfaced in past code review" is generic, not changelog.

### Long sections
- REVIEW.md:74 (Database & migrations row) — a single 60+ word checklist bullet packing ~8 rules (portable queries, migration regeneration, inTransaction, timestampValue, backend-sensitive tests) into one line; hard to check off item by item.
- REVIEW.md:13-19 (Review lenses) — six lens bullets that re-list the same 20+ targets as the checklist below; pure duplication with the per-section links.

### Task/PR-specific
- none — this file is a durable review index.

### Readability
- Dense bolded checklist rows are good, but the two bulky bullets (lines 68 "Surfaces" and 74 "Database & migrations") read as walls of inline caveats; they could inherit detail from the linked sections instead of restating it.
- The "Review lenses" list and the checklist body enumerate the same items twice per view; merging or trimming the lenses list would cut ~10 lines.

## LICENSE.md lines 1-22

### Duplicates
- none — standard MIT text; note the year/holder (2022, Maythee Anegboonlap) may be worth confirming against package.json, but that is a metadata question, not duplication.

### Stale
- none.

### History / changelog text
- none.

### Long sections
- none — 21 lines of standard license text.

### Task/PR-specific
- none.

### Readability
- none.

## .github/PULL_REQUEST_TEMPLATE.md lines 1-26

### Duplicates
- PULL_REQUEST_TEMPLATE.md:1-5 (title-rule HTML comment) ≈ AGENTS.md → Commit & Pull Request Guidelines and CONTRIBUTING.md:1235 "Commit & Pull Request Guidelines" — the conventional-prefix and `minor:`/`major:` bump rules are stated in all three; the template comment should point at AGENTS.md instead of restating them.
- PULL_REQUEST_TEMPLATE.md:26 (five-command list) ≈ REVIEW.md:88 "Required final checks" — the same five `yarn` commands are listed in both, plus CONTRIBUTING.md.
- PULL_REQUEST_TEMPLATE.md:24 (docs grep checklist item) ≈ AGENTS.md → Documentation Maintenance — the template restates the grep-`*.md`-and-`docs/` rule that AGENTS.md already carries.

### Stale
- none — `scripts/publish.sh` is referenced for the `llun/sketch` repo, not this one, so it is out of scope here; all package.json scripts named in the template exist in this repo.

### History / changelog text
- none.

### Long sections
- PULL_REQUEST_TEMPLATE.md:22 (sketch/prototype checklist item) — one ~50-word checkbox mixing design-library sync, prototype regeneration, and cross-repo publish; could be a pointer to CONTRIBUTING.md → Design Library Sync.

### Task/PR-specific
- none — template content is intentionally generic; the "20 rounds" review-loop reference (line 13) matches CONTRIBUTING.md → Code Review Loop.

## Slice summary

REVIEW.md and LICENSE.md are durable and accurate; the only real issues are duplication (three-place repetition of the five-command list and of rule summaries already carried by docs/ and AGENTS.md) and two overlong checklist bullets in REVIEW.md. PR template duplicates title/bump rules from AGENTS.md and CONTRIBUTING.md and could shrink to pointers. No stale references and no changelog-style text found in any of the three slices.
