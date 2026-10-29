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
