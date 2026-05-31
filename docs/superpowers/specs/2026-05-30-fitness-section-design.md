# Move Fitness out of Settings into a top-level `/fitness` section

Date: 2026-05-30

## Goal

Promote Fitness to a first-class top-level section that matches the design
system: a single `/fitness` area with a vertical icon nav rail
(**Overview · Files · Privacy · Strava**), restyled to the design-system card
look. Remove the `Fitness` tab from Settings and the actor-scoped
`/@user@domain/fitness` route. Rename the fitness API routes from
`/api/v1/settings/fitness/*` to `/api/v1/fitness/*`.

## Decisions (confirmed with user)

1. **Location:** new top-level route group `app/(timeline)/fitness/` (mirrors
   `app/(timeline)/settings/`). Not actor-scoped.
2. **Overview scope:** restyle but keep existing features — date-range presets,
   the Elevation stat card, and the Activity Mix table all stay. Add a new
   Recent activities post feed.
3. **Recent feed:** build it, reusing the existing `Posts` component.
4. **API routes:** rename `/api/v1/settings/fitness/*` → `/api/v1/fitness/*`.

## Target file structure

```
app/(timeline)/fitness/
  layout.tsx          ← PageHeaderSectionProvider + vertical icon rail (Overview/Files/Privacy/Strava)
  layout.test.tsx     ← rail renders + active-state resolution
  page.tsx            ← Overview: PageHeader + ActorFitnessDashboard + RecentFitnessActivities
  RecentFitnessActivities.tsx  ← server-rendered recent fitness posts feed (new)
  files/page.tsx      ← from settings/fitness/general (File management + Import)
  privacy/page.tsx    ← from settings/fitness/privacy
  strava/page.tsx     ← from settings/fitness/strava
  strava/StravaSettingsForm.tsx        ← moved
  strava/StravaArchiveImportSection.tsx ← moved
  heatmap/page.tsx    ← from [actor]/fitness/heatmap
  heatmap/FitnessHeatmapView.tsx       ← moved
  heatmap/FitnessHeatmapView.test.tsx  ← moved
  ActorFitnessDashboard.tsx            ← moved from [actor]/, restyled
```

### Removed

- `app/(timeline)/settings/fitness/**` (all)
- `app/(timeline)/[actor]/fitness/**` (all)
- `app/(timeline)/[actor]/ActorFitnessDashboard.tsx` (moved into fitness group)

## Navigation rail (`fitness/layout.tsx`)

Same shape as `app/(timeline)/settings/layout.tsx` (the design-system default
rail): `PageHeaderSectionProvider`, wrapper `data-layout-width="wide"` with
`mx-auto w-full max-w-4xl`, dropdown below `lg`, vertical rail at `lg+`,
orange-wash active state (`bg-primary/10 text-primary`), sentence-case labels,
one Lucide icon per item. Active-tab resolution: longest matching `url` prefix
wins (same logic as settings).

| Label    | URL                | Icon (lucide-react) |
| -------- | ------------------ | ------------------- |
| Overview | `/fitness`         | `Activity`          |
| Files    | `/fitness/files`   | `Files`             |
| Privacy  | `/fitness/privacy` | `Lock`              |
| Strava   | `/fitness/strava`  | `Globe`             |

The nested General/Privacy/Strava segmented control inside the old
`settings/fitness/layout.tsx` is **removed** — those become first-class rail
items, so the separate `settings/fitness/layout.tsx` is deleted.

## Overview tab (`fitness/page.tsx`)

Server Component. Auth + actor resolution identical to the current
`[actor]/fitness/page.tsx`, but using the session actor directly (no `[actor]`
param to validate). Still 404s when `getActorHasFitnessData` is false.

Renders, in order:

1. `<PageHeader title="Fitness" description="Your last 6 months of activity" />`
   (renders in section mode under the provider). A **Heatmap** link/button
   (`Flame` icon → `/fitness/heatmap`) sits in the header `actions` slot.
2. `<ActorFitnessDashboard actorId={currentActor.id} />` — kept, restyled to the
   design-system card look (bordered stat tiles, calendar). Keeps presets,
   Elevation card, Activity Mix table.
3. `<RecentFitnessActivities ... currentTime={Date.now()} />`.

### RecentFitnessActivities (new component)

- Server Component. Loads the latest N (default 5) fitness files for the
  account via `getFitnessFilesWithStatusForAccount`, collects their non-null
  `statusId`s, loads those statuses (`getStatus`/equivalent), filters to ones
  visible to the current actor, and renders
  `<Posts currentTime={currentTime} statuses={...} />` under a
  "Recent activities" heading.
- `currentTime: number` is computed in the parent Server Component
  (`Date.now()`) and passed down — never `new Date()` across the boundary,
  never `Date.now()` during client render (hydration rule, AGENTS.md).
- Renders nothing (or an empty-state line) when there are no fitness posts.

## API route rename

Move every route + co-located test from `app/api/v1/settings/fitness/*` to
`app/api/v1/fitness/*`:

```
settings/fitness/general/route.ts                → fitness/general/route.ts
settings/fitness/general/regenerate-maps/route.ts → fitness/general/regenerate-maps/route.ts
settings/fitness/import/route.ts                 → fitness/import/route.ts
settings/fitness/import/[batchId]/route.ts       → fitness/import/[batchId]/route.ts
settings/fitness/strava/route.ts                 → fitness/strava/route.ts
settings/fitness/strava/authorize/route.ts       → fitness/strava/authorize/route.ts
settings/fitness/strava/callback/route.ts        → fitness/strava/callback/route.ts
settings/fitness/strava/archive/route.ts         → fitness/strava/archive/route.ts
settings/fitness/strava/archive/presigned/route.ts → fitness/strava/archive/presigned/route.ts
```

(The separate `app/api/v1/fitness-files/*` namespace is unrelated and stays.)

### Callers to update

- **`lib/client.ts`** — fitness import + strava archive fetches (lines ~1335,
  1365, 1422–1496, 1519, 1544). Update to `/api/v1/fitness/*`.
- **`lib/client.test.ts`** — expected URLs (~761, 797).
- **`lib/components/settings/FitnessPrivacyLocationSettings.tsx`** — direct
  `fetch('/api/v1/settings/fitness/general'...)` and `.../regenerate-maps`
  (~428, 706, 846). Update paths only; do **not** refactor these into
  `client.ts` (out of scope — pre-existing pattern).
- **`lib/components/settings/FitnessPrivacyLocationSettings.test.tsx`** — mocked
  URLs.
- **`lib/components/settings/FitnessFileManagement.tsx`** — `router.push`
  targets `/settings/fitness/general?...` → `/fitness/files?...` (~121, 125).
- **`app/api/v1/.../strava/route.ts`** — `authorizeUrl` →
  `/api/v1/fitness/strava/authorize`.
- **`strava/authorize/route.ts`** — `redirectUri` →
  `https://${host}/api/v1/fitness/strava/callback`. (Strava validates the
  callback _domain_ only, not the path, so existing apps keep working.)
- **`strava/callback/route.ts`** — all success/error UI redirects
  `/settings/fitness/strava?...` → `/fitness/strava?...`.

### Shared settings components

`FitnessFileManagement`, `FitnessImport`, `FitnessPrivacyLocationSettings`,
`fitnessImportStatus` stay in `lib/components/settings/` (moving them is
unnecessary churn and they are imported by path). Only their internal URL
strings change.

## Navigation wiring

- `app/(timeline)/layout.tsx`: `fitnessUrl` becomes the static string
  `/fitness` when `hasFitnessData` is true (was `/${user.handle}/fitness`).
- `lib/components/layout/nav-items.ts`: unchanged shape; still receives
  `fitnessUrl`. Main-nav "Fitness" item now points at `/fitness`.
- `app/(timeline)/settings/layout.tsx`: remove the
  `{ name: 'Fitness', url: '/settings/fitness', icon: Activity }` tab (and the
  now-unused `Activity` import).

## Tests

- **Update** `app/(timeline)/settings/layout.test.tsx`: drop the
  `/settings/fitness/privacy` active-tab assertion; Fitness no longer in the
  settings rail.
- **Add** `app/(timeline)/fitness/layout.test.tsx`: rail lists the four items,
  active state resolves by longest-prefix (e.g. `/fitness/strava` → Strava,
  `/fitness` → Overview and not a false match on a longer url).
- **Move** `FitnessHeatmapView.test.tsx` with its component.
- **Update** `lib/client.test.ts` and `FitnessPrivacyLocationSettings.test.tsx`
  to the new `/api/v1/fitness/*` URLs.
- **Add** a regression test for `RecentFitnessActivities` rendering with a fixed
  `currentTime` and a known-age fitness post (asserts the rendered relative time
  and that no `Date.now()` is called during client render), per the AGENTS.md
  hydration testing pattern.
- Co-located API route tests move with their routes; their internal request
  paths are relative to the handler so most need no path edits, but verify.

## Out of scope

- Refactoring `FitnessPrivacyLocationSettings` direct `fetch` calls into
  `lib/client.ts` (pre-existing; unrelated).
- Changing fitness data models, summary/calendar APIs, or the heatmap internals.
- Visual redesign beyond matching the design-system card styling shown in the
  reference screenshots.

## Verification gate (before commit)

1. `yarn run prettier --write .`
2. `yarn lint`
3. `yarn build`
4. `yarn test`
5. Browser check of `/fitness`, `/fitness/files`, `/fitness/privacy`,
   `/fitness/strava`, `/fitness/heatmap` against a local SQLite mock user with
   seeded fitness data.

## Delivery

Commit on the worktree branch, push, open a PR to `main`. PR title prefix
`minor:` (new top-level UI section / new optional feature) so the version bump
is correct.
