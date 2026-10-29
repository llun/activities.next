## docs/architecture.md lines 2902-3458

Slice covers three `###` sections: "Review: Runtime vs. build-time configuration" (2905-2946), "Review: Client components & data flow" (2948-3252), "Review: Page chrome, layout & accessibility" (3254-3457).

### Duplicates
- docs/architecture.md:2950 ≈ CONTRIBUTING.md:250 — "never call `fetch()` directly" client-API rule (named functions in `lib/client`) stated in both.
- docs/architecture.md:2968-2984 ≈ docs/fitness-file-storage.md:598-604 — same hydration/timezone rule: render UTC until `useHasHydrated`, never paper over with `suppressHydrationWarning`, `ActivityStartTime` as reference.
- docs/architecture.md:2922-2928 ≈ docs/setup.md:376 — optional SDKs in `packages/*`, `dynamicImport`, type stubs in `lib/types/optional-modules.d.ts` stated in both (setup.md adds workspace names).
- docs/architecture.md:3145-3160 ≈ docs/features.md:15 — combined self-replies mechanics (10-minute gap, one action bar, per-part ⋯ menus, "Show as separate posts") restated condensed in the features list.
- docs/architecture.md:3277-3289 ≈ docs/fitness-file-storage.md:1247-1258 — sticky first column via `STICKY_COLUMN`/`STICKY_CLICKABLE_COLUMN`, `bg-background` surface, opacity-on-cells rule restated in depth in both.
- docs/architecture.md:3312-3321 ≈ docs/fitness-file-storage.md:1233-1244 — orange text = `text-primary-text`, `--primary` is 3.37:1, `--primary-text` clears 4.5:1; fitness-file-storage points back here for exceptions but restates the core rule.
- docs/architecture.md:3285-3286 ≈ AGENTS.md:318 — `SectionNavDropdown` at every width, never a rail beside content; AGENTS.md labels the repeat as deliberate, but it is a full second statement.
- docs/architecture.md:3113-3115 ≈ docs/mastodon-api-compatibility.md:1456-1458 — `deferUntilClosed` semantics (runs from `onCloseAutoFocus`, suppresses Radix focus restore) explained in both.
- docs/architecture.md:3201-3203 ≈ docs/architecture.md:3205-3209 — internal: "React Compiler does not memoize per `.map` iteration, so list rows still need `memo`" appears twice in adjacent bullets.

### Stale
- none — every file, symbol, env var, test and package referenced in the slice was checked and exists (`lib/config/photoEditor.ts`, `lib/utils/http-headers/csp.ts`, `selfThreadModel.ts`, `combinedThreadModel.ts`, `post-options-menu.tsx` at `lib/components/post-box/`, `read-only-stats.tsx`, `optional-modules.d.ts`, `test/feed-row-*.test.ts`, `gearUi.ts`, `reactCompiler`/`babel-plugin-react-compiler`, `BUILD_STANDALONE` in Dockerfile/next.config.ts, the six optional-SDK workspace packages, `.oxlintrc.json` frozen legacy list at line 231).

### History / changelog text
- docs/architecture.md:3248-3250 — "Never hand-roll sticky breakout headers (e.g. 75px hand-rolled headers cause 4px layout shifts)" — rationale from a fixed bug.
- docs/architecture.md:3249-3250 — "No reintroduced `max-w-2xl`/`max-w-4xl` split, `contentWidth` prop, or `data-layout-width`" — regression-guard wording naming APIs that no longer exist (checked: `git grep contentWidth|data-layout-width -- app lib` → no hits).
- docs/architecture.md:3159-3160 — "keeps its collapsed first post, expander and last post exactly as before" — change-relative phrasing.
- docs/architecture.md:3124-3127 — "a bordered box fitted without it is 2px short and scrolls its last line away" — past-bug narrative as rationale.

### Long sections
- docs/architecture.md:2948-3252 `Review: Client components & data flow` (305 lines) — far over 80; mixes data-flow rules, lazy-loading/`createPreloadable`, combined-post models, composer toolbar/geometry, CSS containment, React Compiler and fitness-gear rules. Could split into at least 4 subsections; the combined-posts block (3145-3183) alone is ~40 lines of dense spec.
- docs/architecture.md:3254-3457 `Review: Page chrome, layout & accessibility` (204 lines) — over 80; mixes layout/navigation rules, color-token contracts (3305-3378) and per-component styling. Could split layout vs color tokens vs form primitives.
- docs/architecture.md:2905-2946 `Review: Runtime vs. build-time configuration` (42 lines) — under limit; dense but cohesive reference, keep.

### Task/PR-specific
- docs/architecture.md:3121-3135 — pixel-level post-action-row layout rationale (`-ml-13`, `gap-1`, `ml-auto`, 400px `ResizeObserver` threshold) reads as a single PR review frozen into the architecture doc.
- docs/architecture.md:3164-3172 — combined-post UI minutiae (exact aria-label strings "More actions for part 2 of 4", "2 of 4 · 15m" label, focus behavior after menu closes) is component-spec detail better owned by the components/tests.
- docs/architecture.md:3395-3403 — per-button dark-mode backgrounds enumerated one by one (scroll-to-top pill, refresh button, announcements button, "N new posts" pill) — snapshot-level styling detail.

### Readability
- Several bullets are single sentences of 15-25 lines with nested parentheticals (e.g. 2968-2984 hydration, 3013-3032 `createPreloadable`, 3147-3152 combined-blocks rule); hard to scan and easy to misread.
- The "only when the profile has a panel that shows it (a Media or Gallery tab, or the media-only gallery)" condition is repeated verbatim at 3020 and 3041-3043.
- The color-token block (3305-3345) interleaves WCAG math, hex values, design-history notes ("the design's Destructive Text") and usage rules in single paragraphs; a table would compress it.

### Slice summary
Dense, well-maintained contributor rules; no stale references found. Main costs: two ~200-300-line `Review:` sections that each bundle 4-5 unrelated subsystems, ~9 confirmed duplications (mostly with docs/fitness-file-storage.md, CONTRIBUTING.md, setup.md, features.md, AGENTS.md), and several PR-review-grade pixel/spec details that could move to component-level docs. Roughly a third of the slice is duplicated elsewhere or is component-spec detail rather than architecture.
