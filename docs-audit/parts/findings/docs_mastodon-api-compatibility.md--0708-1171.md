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
