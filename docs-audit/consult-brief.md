# Consultant brief: documentation cleanup options for llun/activities.next

## Rules for your run (read first)

- Work alone. Do not start sub-agents, do not delegate, hand off or ask any other model, agent or tool-agent to do any part of this.
- Read-only: the only file you may create or change is your own output file, `docs-audit/consult-<name>.md` (your prompt names it). Do not edit any doc, code or other file, do not run git add/commit/push, do not write anywhere outside `docs-audit/`.
- No network access is needed.

## Goal

The owner wants every document in the repo (README.md, CONTRIBUTING.md, AGENTS.md, REVIEW.md, docs/*.md, .github/PULL_REQUEST_TEMPLATE.md, LICENSE.md) cleaner and easier to read, and unnecessary ones removed. You propose options; the owner picks one before any change is made.

## Data (start here; it is the cheap way in)

All under `docs-audit/` in this checkout (origin/main aa368a596):
- `README.md`: what is here, plus orchestrator spot checks (CLAUDE.md does not exist; which tests/CI actually read docs).
- `inventory.md`: each doc's size, outline, audience, purpose.
- `references.md`: every code/test/CI/lint reference to a doc, and every doc-to-doc link (0 broken anchors; anchors are explicit `<a id="agents-...">` tags).
- `findings/*.md`: per doc, confirmed duplicates, stale mentions, history/changelog text, long sections, task-specific text, readability notes, with line numbers.

Sizes today: docs total ~1.6 MB. docs/architecture.md 528 KB (4032 lines; its "Contributor rules" part is lines 1139-4032), docs/maintenance.md 261 KB, docs/mastodon-api-compatibility.md 251 KB, docs/fitness-file-storage.md 193 KB, docs/environment-variables.md 97 KB, CONTRIBUTING.md 95 KB, docs/features.md 64 KB, AGENTS.md 44 KB (a routing map; ~47 sections only say the rule moved to a "Contributor rules" section elsewhere), docs/setup.md 39 KB, REVIEW.md 11 KB, small: quickstart, sqlite-setup, postgresql-setup, PR template, LICENSE.

Read the docs themselves only where you need to check something; use `grep -n` and `sed -n 'A,Bp'` rather than reading big files whole.

## Hard constraints every option must respect

1. Keep the meaning of every AGENTS.md rule: the Definition of Done, the design library sync workflow, root-level tests live in `test/`, the sub-agent policy, and the logging / API response / runtime config rules. Rules may move or be reworded, not lost.
2. `docs/` stays durable reference only: no plans, no PR write-ups, no change logs.
3. Anchors and file paths that tests, lint or CI parse must keep working or be updated in the same PR (notably `lib/config/envDocumentation.test.ts` reads `docs/environment-variables.md`; `.github/workflows/ci.yml` names doc headings in `::error::` strings; ~111 code comments name doc files).
4. README must still get a self-hoster from zero to a running server.
5. Agents (Claude, Codex, Gemini, etc.) must still be able to find every rule from AGENTS.md.

## What to write

`docs-audit/consult-<name>.md`, in this shape:

```
# Consult: <name>

## Read of the problem
(5-10 lines: what actually makes these docs hard to use, citing the data)

## Option 1: <name> (light tidy) ... Option 3 or 4: <name> (deep restructure)
For each option:
- Target file list: per file, what happens (kept / shortened / split into X+Y / merged into Z / moved / deleted), with rough size after.
- Total size after (rough).
- How agent rules stay reachable (what AGENTS.md becomes, where each rule family lives).
- How code/test/CI doc references are kept or updated.
- What is removed outright (history text, duplicates, stale mentions) and how you make sure no rule meaning is lost.
- Risks.
- Number of PRs and their order (one line each).

## Recommendation
(which option, why, and the first PR to do)
```

Give 3 to 4 genuinely different options, from light tidy to deep restructure. Be concrete: name files, sections and line ranges from the data. Keep the whole file under about 400 lines.
