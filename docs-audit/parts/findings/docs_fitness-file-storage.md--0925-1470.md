## docs/fitness-file-storage.md lines 925-1470

Slice covers the entire `### Fitness Gear` section (925-1470) of the "Contributor rules" part: derived gear totals, component install periods, gear/component table rendering, product links, activity gear assignment, Strava import policy, and device gears.

### Duplicates
- docs/fitness-file-storage.md:1098-1101 ≈ docs/fitness-file-storage.md:299 — "evaluate service reminders only after the activity is `completed`" / "reads the total from before the activity that caused the crossing" stated in both Gear Tracking and Fitness Gear.
- docs/fitness-file-storage.md:1228-1231 ≈ docs/fitness-file-storage.md:299 — "no recurring job infrastructure; the queue can delay a message but not repeat one" repeated verbatim in intent.
- docs/fitness-file-storage.md:1197-1206 ≈ docs/fitness-file-storage.md:298 — "neither the webhook path nor the archive path reads gear from Strava... no import ever creates a gear row" vs "**Strava's own gear is deliberately ignored**" — near-verbatim, including the `kind`-guess rationale.
- docs/fitness-file-storage.md:1205 ≈ docs/architecture.md:3172-3173 — "No importer reads gear from Strava or creates a gear row" third statement of the same rule.
- docs/fitness-file-storage.md:927-933 ≈ docs/architecture.md:3168-3170 — "derived, never stored" gear distance plus the shared stats-predicate rule.
- docs/fitness-file-storage.md:1076-1080 ≈ docs/architecture.md:3170-3171 ≈ docs/maintenance.md:697 — sport matching through `normalizeActivityTypeToSportKey`, never the raw `activityType`.
- docs/fitness-file-storage.md:1232-1243 ≈ docs/fitness-file-storage.md:1362-1364 ≈ docs/architecture.md:3327-3331 — orange text uses `text-primary-text`, `text-primary` is 3.37:1 / below AA; stated three times (architecture.md:1390 even cross-references back to this section, then architecture.md:3327 restates it).
- docs/fitness-file-storage.md:1329-1334 ≈ docs/architecture.md:1387 — `SectionNavSelect` "state-driven twin of `SectionNavDropdown`", boolean `aria-current` "because nothing is a page" — near-identical explanation.
- docs/fitness-file-storage.md:1344-1368 ≈ docs/fitness-file-storage.md:276 — product page rule: `GearProductLink` hostname-only, `getProductUrlHostname` http(s) guard against `javascript:` hrefs, `resolveDeviceGear` brand-map seeding — duplicated within the file (~70 lines apart).
- docs/fitness-file-storage.md:1416-1422 ≈ docs/fitness-file-storage.md:293 — "`resolveDeviceGear` is the only thing that creates a device" + `POST /api/v1/fitness/gear` rejects `device` with 422, duplicated within the file.
- docs/fitness-file-storage.md:1026-1031 ≈ docs/fitness-file-storage.md:1378 — the gear-list "known gap" (tables pin but do not snap, `min-w-[560px]`) described twice.

### Stale
- none — all referenced symbols verified to exist: `useGearTableColumns.ts`, `gearUi.ts`, `scripts/fitness/normalizeFitnessActivityTypes.ts`, `activityPresentation.ts`, `sportTypes.ts` (`SPORT_KIND`, `getSportKeysForKind`), `fitnessDeviceBrands.ts` (`getDeviceLinkTarget`), `lib/database/kysely/dialect.ts`, `lib/database/domains/fitnessGear/queries.ts`, `GearListView.tsx` (`min-w-[560px]` at GearListView.tsx:155), `GearActivitiesFeed.tsx`, `section-nav-select.tsx`, `GearProductLink.tsx`, `globals.contrast.test.ts`, `processFitnessFileJob.test.ts`, `fitnessGearComponentPeriods.test.ts`, plus `evaluateGearServiceReminders`, `diffGearComponents`, `isUniqueConstraintError`, `normalizeStoredActivityType`, `lastAlertedDistanceMeters`, `assignFitnessFileGearIfUnset`, `setFitnessFileGear`, `findFitnessGearByDefaultSport` (checked via `git ls-files | grep` and `git grep -nE` over app/lib/scripts). `docs/architecture.md` orange-text exceptions reference also resolves.

### History / changelog text
- 943-948 — "clearing `removedAt` reopened the ORIGINAL window, so a part unretired months later was credited every activity"
- 964-975 — "lets `[May 1, Feb 15)` through — a period no activity can fall inside... The bug reads as correct because"
- 1030-1031 — "the same failure `min-w-[720px]` used to cause on the components table"
- 1072-1075 — "\"Refit\" beside \"Confirm delete\" measured 152px against the 124px"
- 1129-1134 — "rows imported before this rule keep whichever one they came in with"
- 1141-1142 — "exactly what captioned a `MountainBikeRide` with the road-bike glyph"
- 1154-1157 — "made a directly uploaded handcycle ride disagree with the same ride imported from Strava"
- 1205-1208 — "the `stravaGearId` column is gone with them... it was guessed from an undocumented `b`/`g` id prefix"
- 1254-1256 — "the rows read as loose text, which is what these tables looked like before"
- 1264-1266 — "came out a bright stripe in light mode... and a sunk well in dark"
- 1281-1292 — "\"Handlebar\" (72.6px...) broke mid-word" and "\"Continental\"... wrapped its trailing 'l'" — pixel-measurement anecdotes
- 1309-1311 — "a 390px phone grew to ~1,770px wide on a gear's page"
- 1354-1355 — "It was device-only and the API 422'd it for anything else; that restriction is gone"
- 1357-1359 — "a row written before the API validated the column" (legacy-data aside; also at :276)

### Long sections
- 925-1470 `### Fitness Gear` (546 lines) — a single bullet list, most bullets 15-50 lines; should be split into sub-headings (derived totals & periods / table rendering / product links / assignment & Strava / devices). Not reference tables — prose.

### Task/PR-specific
- none — the rules are durable, though the past-bug anecdotes listed above are the PR write-up residue inside them.

### Readability
- Several bullets run 20-50 lines as one sentence with nested bolded sub-rules and em-dash chains (984-998, 1246-1300); the table bullet even contains display math (`$W_{\text{avail}}$`, `$N_{\text{fit}}$`) inside prose.
- High interdict density — "Do not reintroduce", "Do not put ... back", "Do not write a third copy", multiple "never"s per bullet — often restating the same prohibition in both positive and negative form.

### Slice summary
The slice is the whole 546-line `### Fitness Gear` contributor-rules section. It is dense durable guidance, but roughly a third of it is past-bug/past-measurement narrative that belongs in history, and most of its storage/import rules are stated a second (or third) time in the file's own "Gear Tracking" section (266-300), docs/architecture.md (~3168-3173, ~1387, ~3327) and docs/maintenance.md:697. Splitting the section and replacing the duplicated statements with cross-references would remove the bulk of its length.
