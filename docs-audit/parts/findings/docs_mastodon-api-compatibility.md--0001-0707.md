## docs/mastodon-api-compatibility.md lines 1-707

### Duplicates
- docs/mastodon-api-compatibility.md:23-54 ≈ docs/mastodon-api-compatibility.md:1895 — id forms (UUIDv7 `publicId`, legacy colon form, `apurl_`, raw AP URI, "neither can be derived from the other") restated almost verbatim in a later "Actor URIs vs. Opaque IDs" bullet (confirmed via `git grep -nF "legacy colon"`).
- docs/mastodon-api-compatibility.md:23-54 ≈ docs/maintenance.md:392-399 — "keeps emitting the legacy colon form" for pre-publicId rows is the Public ID Backfill section's core statement (confirmed via `git grep -nF "legacy colon"`); this file already links `./maintenance.md#public-id-backfill`.
- docs/mastodon-api-compatibility.md:55-104 ≈ docs/maintenance.md:413-421 — the `20261009163215_time_ordered_notification_ids` migration, v4 leftovers not aging out, and marker reset are described both here and in "Notification ID Rewrite" (this file links it at line 78).
- docs/mastodon-api-compatibility.md:152-157 ≈ docs/architecture.md:2855 — `refresh_token` grant not advertised, `unsupported_grant_type` from the token endpoint, `offline_access` not offered: stated in both the OAuth bullet here and "OAuth Access Token Sliding Expiry" (architecture.md:2851), which this bullet already links (confirmed via `git grep -nF "unsupported_grant_type"`).
- docs/mastodon-api-compatibility.md:83-88 ≈ docs/mastodon-api-compatibility.md:355-357 — `POST /api/v1/markers` storing an epoch-ms value as the highest UUIDv7 for that millisecond (Phanpy's `most_recent_notification_id`) explained twice within this slice.

### Stale
- none — verified, all referenced artifacts exist: `lib/services/quotes/fetchQuoteTargetForCreate.ts`, `lib/services/statuses/expectedActor.ts`, `lib/database/domains/status/{writes,deletion}.ts`, `lib/utils/postingLanguage.ts`, `lib/services/oauth/userinfo.ts`, `lib/services/auth/constants.ts`, `lib/services/guards/OAuthGuard.ts`, `lib/services/actors/actorDeletion.ts` (`git ls-files | grep -x` → all present); `IDEMPOTENCY_PENDING_STALE_MS`/`IDEMPOTENCY_KEY_TTL_MS` (lib/database/domains/idempotency/types.ts), `LIST_*_BACKFILL_*` (lib/database/domains/list/queries.ts), `ACTIVITIES_PRIVACY_POLICY`, `ACTIVITIES_WEB_VITALS_SAMPLE_RATE` (lib/config/webVitals.ts) (`git grep -n` → found); `20261009163215_time_ordered_notification_ids` exists as a legacy Knex migration name in `lib/database/migrate/legacyKnexMigrations.ts:187` (no standalone file — fine, it is pre-baseline); `ProcessFitnessFileJob`/`SendNoteJob` in `lib/jobs/names.ts`; anchors `maintenance.md#public-id-backfill`, `#notification-id-rewrite`, `architecture.md#oauth-access-token-sliding-expiry`, `#account-data-export`, `#account-data-import`, `#browser-web-vitals` all resolve.

### History / changelog text
- docs/mastodon-api-compatibility.md:65-78 — "Ids minted before this were rewritten by the … migration"; "The previous build keeps minting v4 ids while that migration runs ahead of the rollout"; "ships with v1.192.34" — deployment-moment rollout narrative tied to one release.
- docs/mastodon-api-compatibility.md:163-167 — "used to land here as an ordinary favourite and inflate `favourites_count`"; "Reactions received before this change stay favourites" — past-behavior/change narrative.
- docs/mastodon-api-compatibility.md:140-144 — "a `null` entry failed the entity's own validation and took the entire status off the API" — past-bug war story justifying the current behavior.
- docs/mastodon-api-compatibility.md:96-104 — "Ids a client cached before the rewrite no longer resolve… The remedy is a full refresh" — one-time migration aftermath, will not age well.

### Long sections
- docs/mastodon-api-compatibility.md:18-464 `## Intentional divergences` (447 lines) — 30 bullets in one section; could be split into grouped subsections (ids, auth/OAuth, media, admin, notifications); individual bullets below are the worst offenders.
- docs/mastodon-api-compatibility.md:55-104 `Notification ids are time-ordered UUIDv7s` (50 lines) — mixes the durable rule with migration/rollout history; could shrink by a third by moving 65-104 to maintenance.md.
- docs/mastodon-api-compatibility.md:366-413 `Quote approval is consent-gated (FEP-044f)` (48 lines) — dense single paragraph; could be split into protocol behavior vs. API surface.
- docs/mastodon-api-compatibility.md:603-688 `Atomic Idempotency-Key on POST /api/v1/statuses` (86 lines) — one bullet covering happy path, failure paths, crash recovery, TTL; reference-detail that could be a subsection or move to architecture.md.
- docs/mastodon-api-compatibility.md:514-570 `Account archive import` (57 lines incl. a 9-row table) — table must stay; the surrounding status-code prose could shrink.

### Task/PR-specific
- docs/mastodon-api-compatibility.md:14-16 — "Keeping this page current is part of the definition of done… updates this page in the same pull request" — contributor process rule living in a reference doc (only occurrence of the phrase in the audited set).

### Readability
- Bullets routinely run 20-40 lines as single paragraphs with nested em-dash caveats (e.g. 340-365, 434-464); hard to scan.
- Repeated defensive "Do not…" asides addressed at future code editors ("Do not go back to `crypto.randomUUID()`" :62, "Do **not** 'fix' `most_recent_notification_id`" :362) read like review comments, not reference text.
- Mixed audiences: client-facing behavior, internal file paths, and ops/migration guidance interleaved in the same bullets.

### Slice summary
Durable reference of intentional Mastodon divergences (lines 18-464), not-planned endpoints (465-488), and the start of extensions (489-707). Content is accurate — no stale references found — but the section is a 447-line bullet wall with heavy duplication of the id/notification migration stories already in maintenance.md and architecture.md, plus rollout/changelog narrative (v1.192.34, "previous build", "used to") that should move to maintenance.md; roughly 100-150 lines of the slice could go or move.
