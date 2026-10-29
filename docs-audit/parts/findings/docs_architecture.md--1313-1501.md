## docs/architecture.md lines 1313-1501

### Duplicates
- docs/architecture.md:1487 ("Every route that reads on the server has a `loading.tsx`... streamed loading boundary turns `redirect()`/`notFound()` into a 200") ≈ docs/architecture.md:1483 ("Each `/admin/*` route but `/admin` itself has a `loading.tsx`... a streamed loading boundary would turn the non-admin `redirect()` into a 200") — the loading.tsx-per-route rule and its redirect/200 rationale are stated twice within the slice.
- docs/architecture.md:1324 ≈ docs/architecture.md:1390 — the `text-primary-text` (not `text-primary`) rule for section-nav rows is stated in the Menu bullet (1324) and again in the SectionNavSelect bullet (1390), both pointing at the "orange-text rule under **Fitness Gear**" (which lives in AGENTS.md, not here).
- The Back/`BackLink`/`profileBack` rules (docs/architecture.md:1410) largely restate the `back` prop description at docs/architecture.md:1286 (same "Back to profile", `backDestination.ts`, x=40 row geometry).

### Stale
- docs/architecture.md:1383 — `ui_kits/web/GearKit.jsx` — checked: `ls ui_kits/web/GearKit.jsx` → "No such file or directory"; `git ls-files | grep -i uikit|GearKit` → no matches. The whole `ui_kits/` directory is gone; also referenced at docs/fitness-file-storage.md:1251 and docs/mastodon-api-compatibility.md:1403.
- docs/architecture.md:1320 — PR numbers `#2594`/`#2597` cited as the origin of the removed rail — history text, not durable rule.
- Verified present (not stale, for the record): `lib/components/section-nav-dropdown.tsx`, `section-nav-select.tsx`, `sectionNavActive.ts`, `sectionNavPattern.test.ts`, `lib/components/surface/*` (AddBar, Alert, EmptyState, FramedList, FormRow, SaveBar, ScreenSkeleton, SectionSkeleton, StatStrip, TableFrame, surfaceKitUsage.test.ts, alertOutsideFrame.test.ts), `lib/components/refresh-button.tsx`, `page-refresh-button.tsx`, `lib/components/photo-editor/engine/{adjustments,shaders,tiles}.ts`, `lib/client/mediaEdit.ts`, `MapLoadingOverlay`, `MOBILE_INSET_STACK_CLASS` in `lib/components/posts/feedLayout.ts`.

### History / changelog text
- docs/architecture.md:1320 — "(app PRs #2594 and #2597)" and "the rail ... its 'Back to …' row below `lg` and the wider `--container-section` column were removed on purpose" — narrative of a past removal.
- docs/architecture.md:1371 (PageSubnavProvider bullet) — "No settings-style section layout uses this any more (admin moved to `SectionLayout` to match the design system)" — change-log narrative; the "moved" rationale belongs in history.
- docs/architecture.md:1449-1448 region (### Surfaces intro) — "The kit began as the Fitness overview's own primitives, which Gallery already borrowed; they were promoted to neutral names" — origin story, not a durable rule.
- docs/architecture.md:1483 — "The stats page moved to `/admin/overview` ('Dashboard')" — relocation history.

### Long sections
- docs/architecture.md:1318-1401 `#### Section navigation...` / `#### Section sub-nav...` / `#### Mobile chrome...` run of bullets (~85 lines to 1403) — each bullet is a 300-500+ word wall mixing normative rules with implementation trivia (pixel offsets, class strings); could be split into a rule line plus a "why" sub-note, or tabled.
- docs/architecture.md:1449-1489 `### Surfaces (Shared Surface Kit)` — the component table rows (SaveBar, StatStrip, FormRow) are single 500-1000+ character cells; near-impossible to scan. Reference content that must stay, but should be split per-component or into subsections.

### Task/PR-specific
- docs/architecture.md:1320 — "the rail that Settings, Account & security and Admin had from `lg` (app PRs #2594 and #2597)" — PR-number history.
- docs/architecture.md:1483 — "the Dashboard (`/admin/overview`)" relocation note — describes a one-time move.

### Readability
- docs/architecture.md:1313-1501 overall — nearly every bullet is one unbroken 200-600 word paragraph (Mobile chrome, Z-order, the Admin kit bullet at 1483, the auth-pages bullet); nested caveats inside parentheses run three deep. Rule + rationale separation would fix most of it.
- docs/architecture.md:1314 — the hashtag-page bullet is a single ~150-word sentence with four parentheticals; the key rule ("keep the inline icon-and-title block") is buried at the end.
- The huge class-string enumeration in 1324 and 1483 (every prop, tone and file name in one sentence) duplicates what the linked source files already show; trimming to the invariant + file pointer would halve the section.

### Slice summary
This slice is the mobile-chrome and surface-kit portion of the UI architecture guide: section-nav rules, the shared Surface Kit table, kit-usage guard rules, and the start of the Photo Editor section. It is dense but accurate-looking reference material; the main cleanups are PR-number history (1320, 1371, 1483), the dead `ui_kits/web/GearKit.jsx` reference (1383), duplicated text-primary-text and loading.tsx rules, and breaking the wall-of-text bullets and the Surfaces table into scannable units.
