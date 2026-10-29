# Docs audit data (research only, not for merge)

Branch `docs-audit/data`, cut from origin/main aa368a596. Nothing under the repo's docs was changed.

- `inventory.md`: every doc file with size, outline, audience, purpose.
- `references.md`: code/test/CI/lint references to docs, and doc-to-doc links.
- `findings/<file>.md`: duplicates, stale mentions, history text, long sections, task-specific text, per doc.
- `parts/`: the raw per-slice outputs the above were assembled from. `slices.tsv` and `slices.mjs` define the slices.
- `findings-brief.md`: the brief every slice run got.
- `consult-<name>.md`: cleanup options from each consultant. `audit-log.md`: delegation audit.

Data was gathered by GLM-5.3-flash (Mistral Vibe), one heading-aligned slice of at most ~40 KB per run.

## Orchestrator checks (spot checks, not exhaustive)

- CLAUDE.md is not tracked and not on disk; only `.claude` is gitignored. AGENTS.md:144/262 and other mentions of it being a symlink are stale. `parts/references-docs.md` repeats the symlink claim; it is wrong.
- Only `lib/config/envDocumentation.test.ts` reads a doc at test time (`docs/environment-variables.md`, every `ACTIVITIES_*`/`OTEL_*` var must appear). `lint/agentsRules.test.ts` and `lib/components/sectionNavPattern.test.ts` mention docs in comments only. `.github/workflows/ci.yml` (around 722-862) names AGENTS.md / CONTRIBUTING.md headings in comments and `::error::` strings; there is no doc lint or link check in CI.
- Confirmed stale: `scripts/maintenance/backfillMediaBlurhash.ts` (docs/maintenance.md ~1167-1172) is not tracked.
- Unverified: `ui_kits/web/GearKit.jsx` (docs/architecture.md:1383, docs/fitness-file-storage.md:1028/1251) is not in this repo; it may name an external design kit, so treat as "dangling reference", not proven stale.
- Doc anchors use explicit `<a id="agents-...">` tags; the doc-to-doc check found 0 broken anchors.
