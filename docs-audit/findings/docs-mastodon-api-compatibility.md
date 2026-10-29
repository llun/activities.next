# Findings: docs/mastodon-api-compatibility.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

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

## docs/mastodon-api-compatibility.md lines 708-1171

(Slice covers the tail of "## Extensions" (gallery/album/reaction/migration features) and the start of "## Contributor rules" through the "ActivityPub & JSON-LD" section.)

### Duplicates
- docs/mastodon-api-compatibility.md:716-741 ≈ docs/maintenance.md:1015 — the gallery media owner-only query-parameter spec (`show`/`sort`/`cursor`/`taken_from`/`taken_to`/`place`/`activity_id`/`album_id`/`include_days`/`day_key`/`ids_only`, offset 0–100000, the four owner 422 cases, `album_id` excludes) is spelled out in near-full detail in both files. One should be canonical (maintenance.md is the more detailed of the two); the compatibility doc could keep only the endpoint list and link.
- docs/mastodon-api-compatibility.md:738 ≈ docs/maintenance.md:406 — `scripts/maintenance/backfillMediaSortAt.ts` backfill instruction stated in both.
- docs/mastodon-api-compatibility.md:1131-1158 (`### Zod Validation in API Routes`) ≈ CONTRIBUTING.md:223-240 — same rule set (`safeParse` never `.parse()`, `.max(255)` for bounded columns, `.transform((v) => v || null)`, the `.nullish()`-before-`.transform` caveat) plus a nearly identical Zod code example, restated in full. AGENTS.md:255 already routes here, so CONTRIBUTING.md or this section is redundant.
- docs/mastodon-api-compatibility.md:1117-1130 (`### Client-Facing Entity IDs`) ≈ AGENTS.md:254 and CONTRIBUTING.md:1162 — the emit/accept rule (`getClientStatusId`/`getClientActorId`, shared resolvers, batch forms) is summarized in both; pointer-style, lower severity than the Zod case.
- docs/mastodon-api-compatibility.md:916-1014 (status emoji reactions) ≈ docs/features.md:58 — the federation behaviour (`pleroma.emoji_reactions`/`reactions` rollups, inbound `EmojiReact` + Misskey `Like`, outbound Misskey-style `Like` that vanilla Mastodon shows as a favourite, glitch-soc `react`/`unreact` aliases) is summarized in features.md. Features list vs API detail; acceptable, but the whole paragraph is repeated, not just named.
- docs/mastodon-api-compatibility.md:1171 (inbound `Move` bullet) ≈ docs/architecture.md:2193+ — signer/actor/object/target checks, the 7-day `move_in_progress` cooldown, `MoveFollowerJob`, skip rules and `MoveRelationshipsJob` carry-over are described in full in both, with the compatibility bullet ending in a "Details in architecture.md" pointer anyway.

### Stale
- docs/mastodon-api-compatibility.md:1012-1013 — "the epic plan" ("see the reaction-spam note in the epic plan") — checked: `git ls-files | grep -i 'epic\|plan'` → no epic/plan doc in repo; `git grep -nF 'reaction-spam' -- .` → only this mention. Dangling reference to a planning document that is not tracked.
- No other stale content found. Verified as existing: `scripts/maintenance/backfillMediaSortAt.ts` (`git ls-files`), `lib/services/gallery/lookups/rateLimit.ts` + `createWindowCounter` (`git ls-files` / `git grep`), `lib/jobs/receiveFlagJob.ts`, `lib/services/mastodon/remoteFollowCollection.ts`, `lib/services/mastodon/resolveClientId.ts` (`resolveStatusIdParam` at line 14), `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts`, `lib/services/statuses/mediaIds.ts` (`resolveStatusAttachmentMediaIds`), `lib/utils/publicId.ts`, `lib/client.ts`, `lib/activities/jsonld/contexts/`, `lib/activities/inheritActivityPubContext.ts`, `lib/activities/noteContext.ts`, `lib/activities/quoteNoteFields.ts`, `scripts/backup/actorArchive.ts`, `lib/services/mastodon/clientCursor.ts`, `getPublicPlace`, `lib/services/guards/OptionalOAuthGuard.*`, `stripJsonLdArtifacts`/`offlineDocumentLoader`, `ACTIVITIES_TRUST_PROXY_IP_HEADERS` (`git grep` in lib/config), route files for `/api/v1/gallery/taxa`, `gallery/media/facets`, `gallery/albums/suggestions[/media]`, `users/[username]/quote_authorizations/[id]`.

### History / changelog text
- docs/mastodon-api-compatibility.md:750-752 — "(it was 255 here)" — old limit parenthetical in the media_attributes description rule.
- docs/mastodon-api-compatibility.md:1012-1013 — "deliberately out of scope for the first release — see the reaction-spam note in the epic plan" — release-planning narrative pointing at a plan doc.
- docs/mastodon-api-compatibility.md:1063 — "(it used to store any id)" — past-behaviour aside in the per-domain reports rule.
- docs/mastodon-api-compatibility.md:1064 — "the migration backfilled it" — one-time migration history note.
- docs/mastodon-api-compatibility.md:1122 — "a `null` took the entire status off the API... one audio clip made a post invisible to every Mastodon client" — past-bug narrative (the rule itself is durable; the failure story is history).
- docs/mastodon-api-compatibility.md:1123 — "(That is how the \"Follow back\" button on a follow notification broke the moment Account ids flipped.)" — past-bug narrative.
- docs/mastodon-api-compatibility.md:1166 — "which is why this survived so long... silently lost the terms" — past-incident narrative inside the note-context bullet.
- docs/mastodon-api-compatibility.md:1171 — "(it is no longer an accepted-and-ignored type)" — change-over-time aside.

### Long sections
- docs/mastodon-api-compatibility.md:489-1095 `## Extensions` (607 lines; ~388 of them in this slice) — reference-style API documentation, but a single flat bullet list where several bullets run 30-55 lines. Could be split into per-topic subsections (gallery, reactions, migration, admin) with sub-headings; the endpoint/facts tables and 422 lists are reference material that should stay.
- docs/mastodon-api-compatibility.md:1096-1171+ `## Contributor rules` (section extends past slice end; first `###` after it at 1318) — within the slice it is an anchor-mapped TOC plus "Client-Facing Entity IDs" (1117-1130), "Zod Validation" (1131-1158), "ActivityPub & JSON-LD" (1159-1171+); the rules themselves are fine-sized but "ActivityPub & JSON-LD" continues ~150 lines beyond the slice.

### Task/PR-specific
- docs/mastodon-api-compatibility.md:1012-1013 — reference to the "epic plan" (planning document, not durable reference).
- docs/mastodon-api-compatibility.md:738-739 — "photos with no `sortAt` (inserted by a build older than the migration)" — rollout-era caveat; durable only until the backfill completes.

### Readability
- docs/mastodon-api-compatibility.md:716-741 — the gallery media bullet is one 50-line bullet carrying dozens of nested parentheticals (day-key semantics, ids_only 422 matrix, facets, rate limits); a wall of text where every fact is qualified inline.
- docs/mastodon-api-compatibility.md:1166 — the outbound note-context bullet is a single ~25-line paragraph mixing the rule, the seven emitting surfaces, quote-fallback HTML, test-file lists and a reader limitation; hard to scan.
- docs/mastodon-api-compatibility.md:1171 — same pattern: one bullet paragraph covering the entire Move flow end-to-end (duplicated with architecture.md anyway).
- Repeated "429, in process" rate-limit asides appear at ~778, ~860, ~875, ~986, ~1010 — consistent but could be one shared note.

### Slice summary
The slice is the back half of the Extensions spec (gallery albums, reactions, migration, admin) plus the opening rules of "Contributor rules". It is dense, largely durable API reference, but the gallery-parameter spec and the Zod validation rules are duplicated near-verbatim elsewhere (maintenance.md, CONTRIBUTING.md), the Move bullet duplicates architecture.md, and one dangling "epic plan" reference plus a handful of past-bug/rollout narratives should be cut. Roughly 120 lines could shrink via deduplication and history removal; the Extensions section would benefit from sub-headings rather than deletion.

## docs/mastodon-api-compatibility.md lines 1172-1338

Slice covers the tail of "### ActivityPub & JSON-LD" (1159–1317; slice holds 1172–1317)
and the start of "### A Fetched Document's Own `id` Is Not Evidence" (1318–1340; slice
ends mid-bullet at 1338, inside the `confirmActorHandle` sub-bullet).

### Duplicates
- mastodon-api-compatibility.md:1172-1200 ≈ docs/architecture.md:2295-2350 — account-migration rules restated nearly rule-for-rule: 30-day cooldown answering 429 with `cooldownUntil`, 422 `Already moved to this account`, 502 unreachable / 500 no signing actor / 422 missing alias, DELETE clearing the pointer but not the cooldown, `movedTo` kept after a failed start.
- mastodon-api-compatibility.md:1201-1232 ≈ docs/architecture.md:2520-2530 — handle-rename rules: 30-day rename cooldown measured from handle history, 429 with `cooldownUntil`, current-password/current-username challenge, `localUsernameSchema`.
- mastodon-api-compatibility.md:1254-1263 ≈ docs/architecture.md:2427-2435 — moved-account rules: inbound `Follow` answered with `Reject` (`reject_follow_request!`), 403 `Target account has moved`, 422 `This account has moved` on authorize with reject still allowed.
- mastodon-api-compatibility.md:1264-1292 ≈ docs/architecture.md:2434-2444 — posting blocked while moved (statuses, reblogs, deprecated outbox/repost routes), scheduled statuses held and requeued on `DELETE`.
- mastodon-api-compatibility.md:1295 ≈ docs/architecture.md:1230 — `VerifyProfileLinksJob` fetch limits duplicated verbatim in spirit (safeRemoteFetch, 1 MiB, HTML only, two redirects, 5 s connect + 5 s read per hop).

### Stale
- none — checked every file path and symbol the slice names: 19 repo paths via `git ls-files` (lib/activities/orderedCollection.ts, lib/stub/fediverse/, the three fediverseInterop.test.ts suites, lib/utils/activitypub.ts, lib/jobs/createAnnounceJob.ts, lib/services/quotes/{fetchQuoteTargetForCreate,persistInboundQuoteEdge}.ts, lib/services/polls/syncRemotePoll.ts, lib/actions/utils.ts, lib/activities/{activityPubResponse,confirmActorHandle}.ts, lib/jobs/noteTags.ts, lib/actions/announce.ts, lib/database/kysely/usernameMatch.ts, lib/database/domains/actor/federationSigner.ts, lib/utils/normalizeUsername.ts, app/api/inbox/getJobMessage.ts — all present) and ~75 symbols via `git grep -l` (toCollectionItems, bindObjectToSender, ActivityPubVerifyGuard, refreshSenderPublicKeyDetails, confirmActorHandle, isSameActivityPubOrigin, getSenderPublicKey, ProcessForwardedActivityJob, deleteObjectJob, PUBLIC_ACTIVITY_RECIPIENTS, … — all present); 11 referenced test files via `git ls-files` (utils.actorBinding, getProfileData.actorBinding, confirmActorHandle, localizeAccount, activityPubResponse, createAnnounceJob, createRelayAnnounceJob, getJobMessage, domainBlockFilter, relationship, getSenderPublicKey tests — all present).

### History / changelog text
- mastodon-api-compatibility.md:1302 — "(`getAttachments` reads them as the `Document` they describe (#2226))" — PR number in a durable rule.
- mastodon-api-compatibility.md:1320 — "Three sites got that wrong at once, and the sink was the same in each" — past-bug narrative framing a durable rule.
- mastodon-api-compatibility.md:1330 — "that arm is what PR #1694 added" — PR history.
- mastodon-api-compatibility.md:1332 — "it is the regression that shipped in an earlier draft of this very change" — changelog of an earlier draft.
- mastodon-api-compatibility.md:1298 — "The corpus is what caught these" — how-the-bug-was-found narrative.
- mastodon-api-compatibility.md:1311 — "Rows stored before this change with a bare `Public`" — "before this change" phrasing; state the current behaviour instead.
- mastodon-api-compatibility.md:1338 — "A relay accepted since this check existed … one accepted before is not re-confirmed" and "Rows created before this check are not re-confirmed" — migration-era caveats tied to when a check landed.

### Long sections
- mastodon-api-compatibility.md:1159-1317 `### ActivityPub & JSON-LD` (159 lines; ~146 in slice) — a flat list of ~20 multi-paragraph rules mixing inbox security, dialect handling, tag parsing and rendering; could be split into subsections (inbound auth/fetch guards, dialect corpus, tags, content rendering). Content itself is reference material that must stay.
- mastodon-api-compatibility.md:1318-1340 `### A Fetched Document's Own \`id\` Is Not Evidence` (~23 lines) — under 80 lines, but several bullets are single physical lines of 3,000–7,000 characters (see Readability); splitting the giant bullets into sub-bullets would help more than splitting the section.

### Task/PR-specific
- none — content is durable reference throughout; the "Pinned by `<test name>` …" enumerations (e.g. 1332, 1335, 1338) are maintenance-heavy but are durable pointers to tests.

### Readability
- mastodon-api-compatibility.md:1293-1338 — one bullet per physical line, up to ~7,300 chars on line 1338; impossible to scan, review or diff. Earlier bullets in the same section (1172-1292) wrap at ~100 chars, so formatting is also inconsistent within the slice.
- mastodon-api-compatibility.md:1264-1292 — one paragraph carrying the posting ban, the DELETE/replay semantics, the partial-queue-failure recovery path and a survey of unaffected endpoints; nested caveats ("A redirect set again during the replay scan cancels that replay; the next DELETE, scoped to the new migration, replays those posts…") would read better as a sub-list.
- Dense bold-emphasis and repeated "never / do not / must never" imperatives throughout (e.g. 1313, 1326, 1327); several rules per bullet with inline exceptions make the key rule hard to find.

### Slice summary
Durable, technically accurate reference on inbox hardening, federated-dialect handling and origin/identity guards; every file, symbol and test reference checked still exists. The main cleanup targets are the near-duplication of the migration/rename/moved-account rules with docs/architecture.md:2295-2444 (this file could keep only the API-shape specifics and link the rest), a handful of PR-number/history sentences, and the unreadable 3k–7k-character single-line bullets from line 1293 onward.

## docs/mastodon-api-compatibility.md lines 1339-1705

Slice covers five sections of "Contributor rules": Actor Usernames Are Case-Insensitive (1342-1357), Status Posts & Actions (1358-1544), Post media layout (1545-1686), Local Usernames Are Actor-Id Path Segments (1687-1696), Local Actors (1697-1705).

### Duplicates
- docs/mastodon-api-compatibility.md:1344 ≈ docs/mastodon-api-compatibility.md:1689 — the rename semantics ("the id keeps the username it was minted with forever… see the handle-rename bullets in architecture.md#agents-actor-profile-deletion-federation") explained twice in this file, same cross-link both times.
- docs/mastodon-api-compatibility.md:1399-1424 ≈ docs/architecture.md:3135-3149 — the action-row rules duplicated almost point for point: `gap-1` cluster, `ml-auto` on the `⋯` menu, edit-history panel anchored to the row at `right-0` (25rem), picker in the row (`ReactionButton`), shared `useReactionState`/`useBookmarkState`, 400px `ResizeObserver` compact bar, `deferUntilClosed`, `disabled` while a write is in flight, absolutely-positioned row error.
- docs/mastodon-api-compatibility.md:1388-1393 ≈ docs/architecture.md:3086 — combined self-reply row rules: `Actions`' `splitTargets`, repost/like/bookmark/react act on the first post, reply goes to the latest, every later part keeps its own `⋯` menu, "Show as separate posts".
- docs/mastodon-api-compatibility.md:1456 ≈ docs/architecture.md:3145 — `deferUntilClosed` "also suppresses Radix's own focus restore".
- docs/mastodon-api-compatibility.md:1445 ≈ docs/mastodon-api-compatibility.md:1668 ≈ docs/architecture.md:3296 — "a post can sit in a narrow column on a wide window" (three occurrences across two files).

### Stale
- none — all 16 referenced paths checked with `git ls-files --error-unmatch` exist; both migration names (`20260826120000_add_actors_lower_username_index`, `20260821120000_normalize_empty_actor_private_key`) resolve via `git grep` into `lib/database/migrate/legacyKnexMigrations.ts`; `no-scrollbar` exists at `app/globals.css:635`; symbols `useMediaStripScroll`, `InlineStatusComposer`, `getLocalActorIdLimit`, `getServedLinkDomain`, `getFallbackBlockedAccount`, `isLocalFederationDomain`, `ACTIVITIES_TRUSTED_HOSTS`, `localPublicStatusesQuery`, `isRenderableAttachment`, `getMediaGeometry`, `StatusReplyBox` all resolve in lib/app. `aliasServedLocalActor` exists only in docs — consistent with the doc's own claim that it was reverted (history text, not stale). `ui_kits/web/Post.jsx` is not in this repo but the doc (1403) and three sibling docs consistently attribute `ui_kits/` to the external Design System project.

### History / changelog text
- docs/mastodon-api-compatibility.md:1347 — "`__INSTANCE__` passed the check and minted a confusable neighbour" (past-bug narrative).
- docs/mastodon-api-compatibility.md:1349 — "which is how `/users/%20alice%20` came to serve alice's whole ActivityPub surface" (past bug).
- docs/mastodon-api-compatibility.md:1350 — "Verified an index scan with both columns as index conditions on PostgreSQL 17 (50k rows)" (benchmark anecdote).
- docs/mastodon-api-compatibility.md:1380-1381 — "profiles used to lack Quote/Edit; six feeds had a dead Reply button" ("used to" history).
- docs/mastodon-api-compatibility.md:1492-1493 — "how that page drifted into a right-packed cluster" (past drift narrative).
- docs/mastodon-api-compatibility.md:1538-1540 — "Before this was shared, the avatar linked to `/@booster@domain`… a 404" (past bug).
- docs/mastodon-api-compatibility.md:1553-1554 — "the old single branch cropped every portrait photo to 16:9" (history).
- docs/mastodon-api-compatibility.md:1605 — "a photo dump was 4 requests and is now one per photo" (before/after).
- docs/mastodon-api-compatibility.md:1641-1642 — "left the button announcing as a bare 'button'" (past bug).
- docs/mastodon-api-compatibility.md:1660 — "reading `attachment.width` raw collapsed the box to 0x0" (past bug).
- docs/mastodon-api-compatibility.md:1676-1679 — "It had been applied in the emoji and reaction pickers' category rows for a long time while being defined nowhere" (history).
- docs/mastodon-api-compatibility.md:1689-1690 — "Both creation paths used to let `%` through… Proved against Next's own route matcher" (long past-bug story, ~half the bullet).
- docs/mastodon-api-compatibility.md:1692 — "a 256-character one overflowed the column and 500'd on PostgreSQL" (past bug).
- docs/mastodon-api-compatibility.md:1699 — "on production that was **216 of the 221** rows it matched" (production incident anecdote).
- docs/mastodon-api-compatibility.md:1701 — "On production that under-estimated the eligible rows ~48x (150 against 7,262)… 35,108 buffers" (benchmark log; buffer numbers 137/142/176 etc.).
- docs/mastodon-api-compatibility.md:1702 — "the former cross-domain `aliasServedLocalActor` fallback was reverted in #1019" (PR number) and "before, each of those compared against the primary host alone, so a server on a second domain forwarded to itself" (history).

### Long sections
- docs/mastodon-api-compatibility.md:1358-1544 `### Status Posts & Actions` (187 lines) — could be split: the shared action-row contract (1358-1520) vs the media/attachment rules could stay, but the per-surface exceptions (combined post, fitness detail, StatusBox) and the CSS mechanics (`-ml-13`, `ml-auto`, panel anchoring) belong in a component-level doc; also heavily overlaps architecture.md (see Duplicates).
- docs/mastodon-api-compatibility.md:1545-1686 `#### Post media layout (`attachments.tsx`)` (142 lines) — reference behaviour worth keeping but the load-bearing-why essays (focus outline physics, scroll-snap, lazy-loading trade-offs) could be halved; largely self-contained, no split needed if trimmed.
- Note: section length by line count understates these — several bullets are single 1,000-1,800-character lines (e.g. 1702), so "Actor Usernames" (1342-1357) is ~16 lines but reads like a multi-page essay.

### Task/PR-specific
- docs/mastodon-api-compatibility.md:1502-1504 — "What is still unwired is `onPostDeleted`/`onLikeChanged`/`onBookmarkChanged`… fix it in both or in neither" — a known-gap tracker for a current TODO, not durable reference.
- docs/mastodon-api-compatibility.md:1352 — "Pre-existing; unifying it is its own change" — work-tracking note inside a rule.
- docs/mastodon-api-compatibility.md:1699 — "(real, but unreachable: that method currently has no production callers)" — snapshot of current call graph that will rot.

### Readability
- docs/mastodon-api-compatibility.md:1342-1705 — walls of text: bullets routinely run 1,000-1,800 characters on one line with 3-5 nested parentheticals and em-dash chains; hard to scan and to diff.
- docs/mastodon-api-compatibility.md:1342-1705 — heavy ALL-CAPS emphasis (MUST/NOT/NEVER/EVERY) and repeated "never do X" restatements of the same rule within one bullet (e.g. 1470-1473 says "never" three ways).
- docs/mastodon-api-compatibility.md:1702 — one bullet mixes served domains, wildcards, `allowActorDomains`, federation policy, port comparison and `isOwnInstanceHost`; six rules in one paragraph.

### Slice summary
Dense contributor rules for usernames, the post/action-row component contract, and media layout. The component/CSS mechanics (1399-1544, 1545-1686) duplicate large parts of architecture.md's UI sections and could move or be cut to one cross-link; the production-incident and benchmark narratives (1350, 1699-1701) and the #1019 story are changelog text; the known-gap bullet (1502-1504) is task tracking. Roughly a third of the slice could go or move if the duplicated and historical material were consolidated into architecture.md.

## docs/mastodon-api-compatibility.md lines 1706-1979

### Duplicates
- none confirmed within the slice. Several rules here are stated as extensions of rules documented elsewhere (e.g. `confirmActorHandle` in architecture.md, `isSameActivityPubOrigin` in the ActivityPub & JSON-LD section), but each statement in this slice adds slice-specific detail rather than restating; no verbatim/semantic duplicate was confirmed.

### Stale
- none. All referenced paths checked and present: `scripts/backup/actorArchive.ts`, `lib/services/statusAccess.ts`, `lib/services/getViewerFollow.ts`, `lib/utils/username.ts`, `lib/utils/normalizeUsername.ts`, `lib/database/kysely/usernameMatch.ts`, `lib/database/kysely/visibility/{publiclyReadable,actorVisible}.ts`, `lib/database/publiclyReadableStatus{QueryShape,CallSites}.test.ts` (as `lib/database/publiclyReadable*.test.ts`), `lib/activities/quoteNoteFields.ts`, `lib/services/mastodon/resolveClientId.ts`, `app/api/v1/accounts/lookup/route.ts`, `app/(timeline)/[actor]/getProfileData.ts` and its `.identity.test.ts`, `lib/database/domains/status/statusReadableSql.test.ts`, `lib/services/accounts/localUsername.test.ts`. No stale package.json scripts, env vars or commands referenced.

### History / changelog text
- 1737-1739 — "That one was shipped correlated and caught in review, which is why the shape test now pins it" — PR-review narrative; the durable part (the shape test pins `getRebloggedBy`) survives without it.
- ~1748-1750 — "on 2026-08-25 a burst of 530 outbox root fetches in 11 minutes ... taking the query's average wall time to 899ms" — dated incident write-up inside the caching bullet; the rule (cache the promise, TTL + concurrent-miss collapsing) stands without the incident date and latency figures.
- 1835-1837 — "which round 1 of #1592 removed as false and which survived here only because that round fixed two of the three copies" — pure change-log narrative about how the wording evolved.

### Long sections
- 1706-1721 "Who May See an Actor's Statuses" continuation bullets (slice opens mid-section; the section header precedes 1706) — bullets run 8-15 lines each with nested caveats; could be split but content is load-bearing.
- 1740-1776 "Review: API routes" (37 lines) — reference-list shape, fine.
- 1777-1890 "Review: Actor usernames" (~114 lines) — a single bullet on username validation runs ~40 lines and the rename/lookup bullets ~20 each; could be split into "validation" vs "lookup/folding" subsections.
- 1891-1906 "Review: Mastodon and Fediverse Interoperability Quirks" — bullets are long but individually scoped.
- 1907-1978 "Review: Fetched ActivityPub document ids" (~72 lines) — under the 80-line threshold only because the slice ends; individual bullets are dense walls (one runs ~14 lines unpunctuated).

### Task/PR-specific
- 1835-1837 — "round 1 of #1592" — release/PR-round narrative, not a durable rule.
- 1743-1751 — the seed-shape benchmark figures (176,000 statuses, 14,900 actors, "33,308-33,311 buffers at limits of 20, 30 and 40") are measurements of a past tuning exercise, not rules; the durable rule is "keep the correlated form, do not add a check-depth-1 fast path".
- 1763-1766 — the caching bullet's CloudFront/`Signature`/`Date` deployment history ("llun.dev's CloudFront policy keyed on Signature and Date when this was written") is incident narration; the rule it supports (origin must survive a burst alone) is durable.

### Readability
- Whole slice is bullet lists with 8-15-line bullets carrying three or more caveats per bullet (bold rule, then exceptions, then measurements, then "left for its own change" footnotes) — hard to scan; the bolded first sentence carries the rule and the rest could move to a rationale note.
- Measurements (buffers/ms figures) are interleaved with normative rules in the same bullets, blurring which sentence is the rule; separating "rule" from "why/measured" would fix most of the length.

### Slice summary
Review-style bullet reference: profile/status visibility fail-open rules, viewer-follow read path, username validation/folding, and fetched-document id guards. No duplication or staleness found; the main issues are PR-narrative sentences embedded in three or four bullets and very long multi-caveat bullets in the Actor-usernames and Fetched-ids sections.

