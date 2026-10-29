# References to docs from non-markdown files

Source: `git grep -nE '(docs/[a-z-]+\.md|AGENTS\.md|CONTRIBUTING\.md|REVIEW\.md|README\.md|CLAUDE\.md|PULL_REQUEST_TEMPLATE)' -- ':!*.md' ':!docs-audit'`
111 hits. No `#anchor` links are used anywhere; all references are prose heading names. Only one file reads a doc at test time (see second section). `CLAUDE.md` and `PULL_REQUEST_TEMPLATE` are never referenced from non-md files.

## Hits by target

### AGENTS.md (67 hits)

- .env.example — (see setup.md group; that line also cites AGENTS.md context, counted under setup)
- .github/workflows/ci.yml:763 -> "Keeping the reference schema dumps in sync" — error msg: regenerate both schema dumps
- .github/workflows/ci.yml:862 -> "Keeping the reference schema dumps in sync" — error msg: regenerate both schema dumps
- .oxlintrc.json:4 -> TypeScript — comment: plugin must load before rules
- .oxlintrc.json:5 -> (conventions carried over) — comment: migrated from eslint.config.mjs per AGENTS.md
- .oxlintrc.json:174 -> (see CONTRIBUTING.md group; Testing Guidelines)
- .oxlintrc.json:180 -> "Coding Style & Naming Conventions" — lint msg: use absolute imports
- .oxlintrc.json:198 -> (conventions as selectors) — comment: former no-restricted-syntax rules
- .oxlintrc.json:210 -> "A stored path…" — comment: storage-path rule origin
- .oxlintrc.json:230 -> (client fetch rule) — comment: named functions in lib/client.ts
- app/api/v1/accounts/relationships/route.test.ts:21 -> Testing Guidelines — comment: explains the route mock
- app/api/v1/admin/custom_emojis/route.ts:188 -> "A stored media URL is only ours if the host says so" — comment: remote-host check
- app/api/v1/files/[...pathname]/route.ts:28 -> "A stored path is confined to the storage root" — comment: path confinement check
- lib/actions/emojiReaction.ts:39 -> ActivityPub & JSON-LD — comment: model only what is consumed
- lib/activities/index.ts:192 -> ActivityPub & JSON-LD — comment: tolerate unknown activity fields
- lib/client/http.ts:1 -> API (error-shape section) — comment: `{ error }` response shape
- lib/components/posts/actions/actions.tsx:46 -> "Status Posts & Actions" — comment: action visibility cases
- lib/components/posts/actions/post-menu.tsx:173 -> "Status Posts & Actions" — comment: menu actions on every surface
- lib/components/posts/actor.tsx:214 -> (unqualified) — comment: defers to AGENTS.md rules
- lib/components/posts/actor.tsx:256 -> "Status Posts & Actions" — comment: see case breakdown there
- lib/components/posts/post.tsx:114 -> "Link prefetching in feeds" — comment: prefetch not persisted
- lib/components/posts/reaction-picker.tsx:48 -> (prop-drilling warning) — comment: instance-wide emoji props
- lib/components/settings/ImageUploadField.tsx:80 -> (chevron behavior) — comment: chevrons documented there
- lib/config/environmentTemplates.ts:10 -> (constants stay in lib/config) — comment: enforced by envAccess.test.ts
- lib/config/serverSettings.ts:21 -> (env-var constants in lib/config) — comment: resolver lives elsewhere
- lib/database/domains/fitnessFile/writes.ts:85 -> Fitness Gear — comment: gear import fills holes only
- lib/database/testing/schema.ts:9 -> (schema matches migrations) — comment: dumps regenerated in lockstep
- lib/jobs/createRelayAnnounceJob.ts:22 -> (be liberal) — comment: accept relay Announce shapes
- lib/jobs/followTimelineBackfillJob.ts:63 -> "Who May See an Actor's Statuses" — comment: resolver answers visibility
- lib/jobs/followTimelineBackfillJob.ts:85 -> (SQL scope caveat) — comment: scope necessary not sufficient
- lib/jobs/followTimelineBackfillJob.ts:196 -> ActivityPub & JSON-LD — comment: tolerate unknown fields
- lib/jobs/processFitnessFileJob.ts:581 -> Fitness Gear — comment: import only fills holes
- lib/services/accountArchive/actorArchive.ts:584 -> "A stored path is confined…" — comment: storage drivers share the rule
- lib/services/auth/twoFactorSignIn.test.ts:20 -> (schema dumps in lockstep) — comment: why test asserts both dumps
- lib/services/fitness-files/heatmapTiles/constants.ts:7 -> Server/Client Module Boundary — comment: no 'use client' needed
- lib/services/fitness-files/heatmapTiles/constants.ts:139 -> Server/Client Module Boundary — comment: constant out of client map
- lib/services/fitness-files/heatmapTiles/edgeMerge.ts:8 -> Server/Client Module Boundary — comment: pure, no 'use client'
- lib/services/fitness-files/heatmapTiles/tileCodec.ts:14 -> Server/Client Module Boundary — comment: decoder stays server-side
- lib/services/fitness-files/heatmapTiles/tiler.ts:19 -> Server/Client Module Boundary — comment: no env, no 'use client'
- lib/services/fitness-files/sportTypes.ts:16 -> Server/Client Module Boundary — comment: constants importable both sides
- lib/services/fitness-gears/deviceIdentity.ts:25 -> Server/Client Module Boundary — comment: keep logic server-side
- lib/services/guards/OAuthGuard.ts:752 -> "An Unconfirmed Account May Not Act" — comment: unconfirmed accounts rejected
- lib/services/guards/accountState.ts:25 -> "An Unconfirmed Account May Not Act" — comment: confirmation mechanism explained
- lib/services/navigation/navPreferences.ts:10 -> (unqualified) — comment: defers to AGENTS.md rule
- lib/services/polls/syncRemotePoll.test.ts:329 -> (deliberate split) — comment: width test for documented split
- lib/services/statuses/reactionLimits.ts:7 -> Server/Client Module Boundary — comment: limits shared both sides
- lib/types/activitypub/activities.ts:120 -> ActivityPub & JSON-LD — comment: stay liberal in types
- lib/types/database/gallery.ts:4 -> Server/Client Module Boundary — comment: viewer imports these types
- lib/types/database/galleryAlbums.ts:4 -> Server/Client Module Boundary — comment: viewer imports these types
- lib/utils/activitypub.ts:55 -> (fetched note.id exception) — comment: unconstrained writes documented open
- lint/agentsRules.mjs:3 -> (plugin carries conventions) — comment: Oxlint plugin from AGENTS.md rules
- lint/agentsRules.mjs:33 -> "A stored path is confined to the storage root" — comment: rule title sourced from doc
- lint/agentsRules.mjs:359 -> "API Response Guidelines" — lint rule name/message
- lint/agentsRules.mjs:365 -> "API Response Guidelines" — lint message text
- lint/agentsRules.mjs:371 -> "API Response Guidelines" — lint message text
- lint/agentsRules.mjs:377 -> "Zod Validation in API Routes" — lint rule name/message
- lint/agentsRules.mjs:383 -> "Zod Validation in API Routes" — lint message text
- lint/agentsRules.mjs:393 -> "A stored path is confined to the storage root" — lint rule name/message
- lint/agentsRules.mjs:404 -> "A stored path is confined to the storage root" — lint message text
- lint/agentsRules.mjs:416 -> "A stored path is confined to the storage root" — lint rule name/message
- lint/agentsRules.mjs:431 -> "A stored path is confined to the storage root" — lint message text
- lint/agentsRules.mjs:443 -> "Client-Side API Calls" — lint rule name/message
- lint/agentsRules.mjs:477 -> "Client-Side API Calls" — lint message text
- lint/agentsRules.test.ts:13 -> (plugin guarded) — comment: test guards the AGENTS.md plugin
- lint/agentsRules.test.ts:241 -> (claimed detections) — comment: list matches what AGENTS.md claims
- lint/oxlintrc.scripts.json:3 -> "Build, Test, and Development…" — comment: why scripts not linted
- next.config.ts:39 -> TypeScript — comment: webpack config rewrites package.json

### CONTRIBUTING.md (4 hits)

- .github/workflows/ci.yml:722 -> "SQLite — migrations/schema.sqlite.sql" — comment: dump-and-strip pipeline
- .github/workflows/ci.yml:771 -> "PostgreSQL — migrations/schema.sql" — comment: documented normalization
- .oxlintrc.json:174 -> Testing Guidelines — lint msg: date-fns barrel slows tests
- app/api/v1/routeScopeWiring.test.ts:832 -> Testing Guidelines — comment: tests skip re-proving guards

### docs/architecture.md (11 hits)

- app/(timeline)/PendingProfileNavigation.tsx:35 -> (unqualified) — comment: router renders nothing early
- lib/components/layout/chromeLayout.ts:7 -> "Server/Client Module Boundary" — comment: chrome renders on server
- lib/components/posts/attachments.tsx:112 -> "Post media layout" — comment: media grid layout rule
- lib/components/posts/compactRelativeTime.ts:12 -> (rendering data-flow section) — comment: hydration-safe timestamps
- lib/components/posts/compactRelativeTime.ts:16 -> "Date Serialization in Server Components" — comment: serialized date caveat
- lib/components/section-nav-dropdown.tsx:167 -> (unqualified) — comment: dropdown behavior rationale
- lib/components/sectionNavPattern.test.ts:10 -> "Page Header & Sub-Navigation" — comment: why nav rail was removed
- lib/components/surface/alertOutsideFrame.test.ts:8 -> "Surfaces" — comment: Alert never inside a box
- lib/components/surface/surfaceKitUsage.test.ts:235 -> "Forms." — assertion message: form rows in Frame forms
- lib/components/web-vitals/WebVitalsReporter.tsx:10 -> "Browser Web Vitals" — comment: loaded on demand
- lib/config/webVitals.ts:1 -> "Browser Web Vitals" — comment: reporting config rationale

### docs/environment-variables.md (5 hits)

- .env.example:4 -> (complete reference) — comment: see doc for full list
- app/api/v1/instance/privacy_policy/route.ts:19 -> (unset policy returns 404) — comment: documented behavior
- lib/components/instance-limits.tsx:37 -> (full explanation) — comment: limits env vars explained there
- lib/config/envDocumentation.test.ts:9 -> (test READS the doc) — comment: allowlist for undoc vars
- lib/utils/traceApiRoute.ts:72 -> (unqualified) — comment: tracing env vars listed there

### docs/mastodon-api-compatibility.md (6 hits)

- app/api/v1/gallery/taxa/route.test.ts:155 -> (limit documented) — comment: test asserts documented limit
- app/api/v1/media/[id]/subject-suggestions/route.test.ts:357 -> (limit documented) — comment: test asserts documented limit
- lib/activities/confirmActorHandle.ts:105 -> (accepted trade-off) — comment: handle mismatch tolerated
- lib/activities/getActorPerson.ts:62 -> (unqualified) — comment: lookup caveat recorded there
- lib/jobs/createAnnounceJob.ts:77 -> "A Fetched Document's Own `id` Is Not…" — comment: fetched id untrusted
- lib/jobs/dispatchCreateNoteOrPollJob.ts:42 -> "A Fetched Document's Own `id` Is Not…" — comment: fetched id untrusted

### docs/maintenance.md (6 hits)

- instrumentation.ts:18 -> (unqualified) — comment: app starts either way
- lib/database/kysely/guard.ts:10 -> (keep out of transactions) — comment: guard honors doc requirement
- lib/database/migrate/baseline.ts:32 -> "Upgrading past the Knex handover" — constant: doc pointer in refusal messages
- lib/database/migrate/startupCheck.ts:30 -> "Upgrading past the Knex handover" — log message: pending migrations
- scripts/maintenance/bundleReport.ts:4 -> "Bundle Size Report" — comment: script documented there
- scripts/mock/createWebVitalsFixtures.ts:61 -> "Create Web Vitals Fixtures" — comment: full guide there

### docs/setup.md (8 hits; line also names sqlite/postgresql setup)

- .env.example:80 -> (also names docs/sqlite-setup.md and docs/postgresql-setup.md) — comment: setup details there
- .github/workflows/ci.yml:879 -> "Regenerating the Kysely DB types" — error msg: regenerate db.ts
- lib/config/database.ts:82 -> (unqualified) — error msg: set ACTIVITIES_DATABASE_CLIENT
- lib/database/connection.ts:630 -> (unqualified) — error msg: set ACTIVITIES_DATABASE_CLIENT
- lib/database/kysely/db.ts:3 -> "Regenerating the Kysely DB types" — comment: regenerate after schema change
- migrations/migration.stub:14 -> (unqualified) — comment: regenerate dumps and types
- scripts/maintenance/generateDatabaseTypes.ts:11 -> "Regenerating the Kysely DB types" — comment: output matches doc steps
- scripts/maintenance/generateDatabaseTypes.ts:268 -> "Regenerating the Kysely DB types" — comment: regenerate after migration

### REVIEW.md (3 hits)

- app/(timeline)/fitness/activityFilter.ts:43 -> (auth error page) — comment: documented error-page behavior
- app/api/v1/timelines/public/route.ts:123 -> (cross-view filtering invariant) — comment: filter invariant honored
- app/api/v1/timelines/tag/[hashtag]/route.ts:143 -> (cross-view filtering invariant) — comment: filter invariant honored

### scripts/README.md (1 hit, not a real reference)

- lint/agentsRules.test.ts:511 -> (none) — fixture: fake filename in an oxlint test map, not a doc link

## Doc content parsed or required by tests, lint, CI

| Checker file:line | Doc file | Heading/anchor/text required | What breaks if renamed or moved |
| --- | --- | --- | --- |
| lib/config/envDocumentation.test.ts:31-45 (reads doc via readFileSync) | docs/environment-variables.md | none — substring match: every `ACTIVITIES_*`/`OTEL_*` var read in lib/config must appear as a substring of the file | Renaming the file breaks the test (readFileSync throws). Removing a variable's row fails the test. Renaming/moving headings is safe. |
| lint/agentsRules.mjs (error messages), guarded by lint/agentsRules.test.ts:13,241 | AGENTS.md | headings quoted in lint messages: "API Response Guidelines", "Zod Validation in API Routes", "A stored path is confined to the storage root", "Client-Side API Calls" | Nothing executable — but lint output cites stale section names if headings are renamed. |
| .oxlintrc.json:174,180 + comments | AGENTS.md, CONTRIBUTING.md | "Testing Guidelines", "Coding Style & Naming Conventions", "TypeScript" | Nothing executable; comments/rule text go stale. |
| .github/workflows/ci.yml:763,862,879 | AGENTS.md, docs/setup.md | "Keeping the reference schema dumps in sync", "Regenerating the Kysely DB types" (in `::error::` messages) | Nothing executable; CI error messages point contributors at stale headings. |
| lib/database/migrate/baseline.ts:32, startupCheck.ts:30 | docs/maintenance.md | "Upgrading past the Knex handover" (in refusal/log messages) | Nothing executable; operator-facing messages go stale. |
| lib/components/surface/surfaceKitUsage.test.ts:235, alertOutsideFrame.test.ts:8; lib/components/sectionNavPattern.test.ts:10 | docs/architecture.md | "Forms.", "Surfaces", "Page Header & Sub-Navigation" (comments/assertion messages only) | Nothing executable; rationale comments go stale. |
| lint/agentsRules.test.ts:511 | scripts/README.md | none — literal fixture filename inside a temp-dir map | Nothing; it is a fake path, not a reference to a real doc. |

No CI workflow has a paths filter, markdown lint step, or link check touching docs; `ci.yml`, `codeql.yml`, `package.yml`, `tag-version.yml`, `version-bump.yml`, `dependabot-auto-merge.yml`, `sync-main-to-prod-dispatch.yml` only mention docs in comments and error strings. No runtime or test code other than `envDocumentation.test.ts` reads a `.md` file (`git grep` for `readFileSync|readFile` over `*.ts`, `lint/`, `scripts/` filtered to `.md` returns only that test and non-md reads).

## Anchors referenced

No `file.md#anchor` links exist in non-markdown files. Referenced heading texts (prose only), sorted with hit counts:

- AGENTS.md#A stored path is confined to the storage root — 7
- AGENTS.md#Server/Client Module Boundary — 10
- AGENTS.md#ActivityPub & JSON-LD — 4
- AGENTS.md#Status Posts & Actions — 3
- AGENTS.md#API Response Guidelines — 3
- AGENTS.md#An Unconfirmed Account May Not Act — 2
- AGENTS.md#Fitness Gear — 2
- AGENTS.md#Keeping the reference schema dumps in sync — 2
- AGENTS.md#TypeScript — 2
- AGENTS.md#Zod Validation in API Routes — 2
- AGENTS.md#Client-Side API Calls — 2
- AGENTS.md#Coding Style & Naming Conventions — 1
- AGENTS.md#Who May See an Actor's Statuses — 1
- AGENTS.md#A stored media URL is only ours if the host says so — 1
- AGENTS.md#Link prefetching in feeds — 1
- AGENTS.md#The archive manifest withholds where storage… (productionArchive.ts:1549) — 1
- AGENTS.md#Build, Test, and Development… (oxlintrc.scripts.json:3, truncated in source) — 1
- AGENTS.md#Testing Guidelines — 1
- AGENTS.md#API (error-shape section, exact title truncated in comment) — 1
- CONTRIBUTING.md#Testing Guidelines — 2
- CONTRIBUTING.md#SQLite — migrations/schema.sqlite.sql — 1
- CONTRIBUTING.md#PostgreSQL — migrations/schema.sql — 1
- docs/architecture.md#Browser Web Vitals — 2
- docs/architecture.md#Server/Client Module Boundary — 1
- docs/architecture.md#Surfaces — 1
- docs/architecture.md#Forms. — 1
- docs/architecture.md#Page Header & Sub-Navigation — 1
- docs/architecture.md#Post media layout — 1
- docs/architecture.md#Date Serialization in Server Components — 1
- docs/mastodon-api-compatibility.md#A Fetched Document's Own `id` Is Not… — 2
- docs/maintenance.md#Upgrading past the Knex handover — 2
- docs/maintenance.md#Bundle Size Report — 1
- docs/maintenance.md#Create Web Vitals Fixtures — 1
- docs/setup.md#Regenerating the Kysely DB types — 4
