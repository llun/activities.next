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
