# Inventory: root-level documentation files

Factual inventory of the six root-level doc files in `llun/activities.next`, plus the CLAUDE.md symlink check. Sizes via `wc -lc`, outlines via `grep -nE '^#{2,3} '`, intros via `sed -n '1,30p'`.

### README.md
- bytes / lines: 9,174 / 159
- audience: human contributor, operator/self-hoster, end-user features
- purpose: project landing page — what Activity.next is, feature highlights, architecture diagram, quick start, Docker/Vercel deployment pointers, docs index.
- outline:
  - L10 `## ✨ Highlights`
  - L22 `## 🏗️ Architecture Overview`
  - L48 `## 🚀 Getting Started`
    - L50 `### Prerequisites`
    - L56 `### Quick Start`
  - L106 `## 🐳 Deployment`
    - L108 `### Docker (Recommended)`
    - L128 `### Vercel`
  - L137 `## 📚 Documentation`
  - L153 `## 🤝 Contributing`
  - L157 `## 📄 License`
- notes: Badge claims TypeScript 7.x and Next.js 16 (L5–6). L137–151 is a table indexing 11 docs under `docs/` — README is the entry hub, no durable rules of its own. License badge links to LICENSE.md (L3).

### CONTRIBUTING.md
- bytes / lines: 95,519 / 1,476
- audience: human contributor, agent rules
- purpose: contributor handbook — setup, coding standards, testing, PR process, plus a large second half ("Contributor workflow reference") holding the detailed rule bodies that AGENTS.md links to.
- outline:
  - L5 `## Table of Contents`
  - L16 `## Documentation and rule map`
  - L28 `## Code of Conduct`
  - L32 `## Getting Started`
    - L34 `### Prerequisites`
    - L41 `### Setting Up Development Environment`
  - L87 `## Development Workflow`
    - L89 `### Branch Naming`
    - L98 `### Commit Messages`
  - L116 `## Coding Standards`
    - L118 `### TypeScript` … L254 `### Better-auth Plugins` (10 subsections)
  - L260 `## Testing`
    - L262 `### Running Tests`, L271 `### Running PostgreSQL Database Integration Tests`, L337 `### Writing Tests`, L363 `### Test Coverage`
  - L370 `## Pull Request Process`
    - L372 `### Before Submitting`, L395 `### PR Guidelines`, L406 `### CI Status Checks`, L421 `### PR Checklist`
  - L432 `## Project Structure`
    - L474 `### Important Files`
  - L487 `## Common Tasks`
    - L489 `### Adding a New API Endpoint`, L497 `### Adding a New Background Job`, L504 `### Creating a Database Migration`
  - L688 `## Resources`
  - L697 `## Getting Help`
  - L703 `## License`
  - L707 `## Contributor workflow reference`
  - L713 `## Testing Guidelines`
    - L1074 `### Known failure classes`
    - L1082 `### Local Manual / Browser Testing (SQLite + mock data)`
  - L1152 `## Task Recipes`
    - L1157 `### Adding a Mastodon-style API endpoint` … L1186 `### Adding a page in the (timeline) group`
  - L1198 `## Design Library Sync`
  - L1217 `## Documentation Maintenance`
  - L1235 `## Commit & Pull Request Guidelines`
    - L1247 `### Version Bump Prefixes`
  - L1302 `## Code Review Loop (Sub-Agents)`
    - L1306 `### Fan out sub-agents…` through L1350 `### Done when` (6 subsections)
  - L1356 `## Style, imports & tests`
  - L1437 `## Docs hygiene`
  - L1452 `## Commits & versioning`
  - L1469 `## CI checklist`
- notes: The file is effectively two documents. First half (L1–706) is a conventional human-facing CONTRIBUTING guide; second half (L707–1476, "Contributor workflow reference", ~770 lines / ~half the file) holds the authoritative rule bodies that AGENTS.md pointer stubs target (hidden `<a id="agents-...">` anchors, e.g. L713). Substantial duplication between halves: "Testing" (L260) vs "Testing Guidelines" (L713), "Common Tasks" (L487) vs "Task Recipes" (L1152), "Pull Request Process" (L370) vs "Commit & Pull Request Guidelines" (L1235) vs "Commits & versioning" (L1452), "CI Status Checks" (L406) vs "CI checklist" (L1469). L16 explicitly frames root files as "indexes into the durable guides".

### AGENTS.md
- bytes / lines: 43,713 / 468
- audience: agent rules
- purpose: agent-facing rulebook — Definition of Done, sub-agent orchestration policy, cross-cutting rules, a "required subsystem reading map", and ~48 pointer stubs routing to durable rule sources elsewhere.
- outline:
  - L5 `## Definition of Done (read this first)`
  - L19 `## Working with Sub-Agents (always)`
    - L32 `### Rules for the main thread`
    - L70 `### Choosing model and effort`
  - L134 `## Project Structure & Module Organization`
  - L149 `## Runtime Configuration Guidelines`
  - L160 `## Coding Style & Naming Conventions`
    - L170 `### Tailwind CSS variables`
  - L176 `## Logging Guidelines`
  - L194 `## API Response Guidelines`
  - L224 `## Build, Test, and Development Commands`
  - L230 `## Mandatory workflow`
  - L236 `## Required subsystem reading map`
  - L252 `## Cross-cutting data and protocol rules`
  - L260 `## Documentation Maintenance`
  - L264 `## Security & Data Safety`
  - then 48 short topic sections, L268–L456 (see notes)
  - ends with a generated `<!-- BEGIN:nextjs-agent-rules -->` block (final ~10 lines) re-added by `next dev`
- notes: Of the 48 `##` topic sections from L268 ("Client-Facing Entity IDs") to L456 ("Database Compatibility Guidelines"), 47 are pure pointer stubs whose only body is "The durable rule source moved to/lives in […]; read it before changing this subsystem." Destinations: docs/architecture.md (19), docs/mastodon-api-compatibility.md (11), CONTRIBUTING.md (4: Design Library Sync L408, Testing Guidelines L412, Task Recipes L416, Commit & PR Guidelines L420 + Code Review Loop L424 = 5), docs/fitness-file-storage.md (4), docs/maintenance.md (5), docs/setup.md (1). Exactly one stub carries extra inline content: L316 "Page Header & Sub-Navigation" repeats the `SectionNavDropdown` rule with a test reference. L144 states "`AGENTS.md` is canonical; `CLAUDE.md` is a symlink to `AGENTS.md`" and L262 repeats "Keep `CLAUDE.md` as the symlink" — see CLAUDE.md finding below.

### REVIEW.md
- bytes / lines: 10,605 / 90
- audience: agent rules, human contributor
- purpose: code-review checklist indexing the project-specific review invariants, with each row linking to the detailed checks in its owning guide.
- outline:
  - L9 `## How to use this checklist`
  - L13 `### Review lenses`
  - L22 `### Runtime and boundaries`
  - L32 `### Storage and database`
  - L42 `### Client and presentation`
  - L54 `### Federation, fitness, auth, and email`
  - L74 `### Workflow and release`
  - L86 `### Required final checks`
- notes: L4–5 and L13 state it is the "fast review index" while AGENTS.md "remains the authoritative source"; every checklist item is a one-line summary plus a `[Detailed checks](docs/…)` link. Dense cross-linking into docs/* and CONTRIBUTING.md anchors (L13–21 alone links ~30 targets).

### LICENSE.md
- bytes / lines: 1,076 / 21
- audience: human contributor, operator/self-hoster
- purpose: MIT license text.
- outline: (none — no `##`/`###` headings)
- notes: Copyright (c) 2022 Maythee Anegboonlap. Standard MIT text, nothing else.

### .github/PULL_REQUEST_TEMPLATE.md
- bytes / lines: 1,776 / 25
- audience: human contributor, agent rules
- purpose: PR template enforcing the squash-merge title convention and the project's Definition of Done checklist.
- outline:
  - L8 `## Summary`
  - L12 `## Screenshots`
  - L17 `## Checklist`
- notes: Leading HTML comment (L1–6) encodes the release rules (`minor:` in title triggers minor bump; `major:` needs human-applied `release:major` label; agents must never apply it). Checklist (L18–25) has 7 items mirroring AGENTS.md Definition of Done: the 5-command gate, sub-agent review loop "or 20 rounds", docs grep, dual schema dumps, Sketch design library sync, untouched `package.json` version, no production SQL in the description.

### CLAUDE.md
- Finding: **CLAUDE.md does not exist in this checkout — the AGENTS.md claim is false here.**
  - `git ls-files | grep -i claude` → no output (not tracked, in any form).
  - `ls -la CLAUDE.md` → `No such file or directory` (not a symlink, not a file).
  - Mentions found: AGENTS.md:144 ("`CLAUDE.md` is a symlink to `AGENTS.md`", with rationale), AGENTS.md:262 ("Keep `CLAUDE.md` as the symlink to this file"), CONTRIBUTING.md:1219 (lists CLAUDE.md among docs that must be updated), CONTRIBUTING.md:1230 ("AGENTS.md (which `CLAUDE.md` symlinks to)"). No mention in README.md.
  - Conclusion: four doc statements describe a symlink that does not exist in this working tree. Either it was never created here, it is gitignored/untracked, or it was deleted. Any cleanup should either restore the symlink or fix the four stale references (note: this checkout may differ from the upstream repo; the check reflects only what is on disk here).
