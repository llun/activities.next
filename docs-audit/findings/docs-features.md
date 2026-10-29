# Findings: docs/features.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

## docs/features.md lines 1-159

### Duplicates

- features.md:12 (Account migration) ≈ features.md:131 — the moved-profile rule ("takes no new followers", Follow turned off) stated in the migration bullet and again in Remote follow.
- features.md:12 ≈ features.md:13 — both Moving-page bullets restate "Settings → Moving offers both kinds / has the rename form" and the alias rules.
- features.md:13 ≈ docs/mastodon-api-compatibility.md:1201 — handle-rename API (`GET/POST /api/v1/accounts/handle`, old handles reserved) described in both.
- features.md:56 ≈ features.md:84 — `/settings/navigation` permanently redirects to `/settings/sidebar` stated twice.
- features.md:74-78 (Gallery, Gallery albums, Add to album, Smart subjects) — the day-header/Select-day picker, the 2,000-photo cap, and the threatened-species place-hiding rule are each stated 2-3 times across these bullets.
- features.md:78 ≈ docs/maintenance.md:1026,1151 and docs/architecture.md — the fails-closed threatened-species rule restated in three docs.
- features.md:68-69 ≈ docs/architecture.md:547,651,713 — export/import limits (7-day cooldown, `reply-uri-too-long`, 200k caps) duplicated from the architecture account-data-import section.
- features.md:130 (WebFinger ostatus template) ≈ docs/architecture.md:202 and docs/mastodon-api-compatibility.md:906.
- features.md:44 (Sign out, `countDraftsByState`, offline cache) ≈ docs/architecture.md:4005-4018; the offline-cache/`activities_offline_v1` details belong there.
- features.md:51 ≈ features.md:58 — Pleroma `emoji_reaction` typing and serving shape described in Notifications and again in Status emoji reactions.
- features.md:110 (Quote posts) ≈ features.md:113 — FEP-044f handshake, per-post policy and clamping described in both Quote posts and Quote posts API.
- features.md:62 (SQL database support) ≈ README.md:15 and docs/environment-variables.md:154 — same SQLite/PostgreSQL statement in three places.

### History / changelog text

- features.md:82 — "what the old `General` page held moved to Appearance, Privacy and Delete this profile" — migration narrative, keep only the current layout.
- features.md:74 — "(`/gallery/media`, which replaces Recent; `/gallery/recent` redirects there)" — "replaces Recent" is changelog framing; the redirect alone is durable.
- features.md:36 / 113 — "(Mastodon 4.5)" and "Mastodon 4.2" release pinning; the API surface is the durable fact, the version tag will age.

### Stale

None confirmed. Checked scripts (`backfillGalleryLookups.ts`, `backfillFitnessDevices.ts`, `exportActorArchive.ts`), API routes (`accounts/handle|migration|aliases`, `gallery/albums/suggestions`, `pleroma/.../reactions`, `fitness/general/regenerate-maps`, `web-vitals`), env vars (`ACTIVITIES_GALLERY_*`, `ACTIVITIES_WEB_VITALS_SAMPLE_RATE`, `ACTIVITIES_TERMS_OF_SERVICE`, `ACTIVITIES_HOST`, `ACTIVITIES_TRUSTED_HOSTS`) — all exist.

### Long sections

- features.md:7-33 (### Core, 27 lines) — six bullets exceed 2,000 chars; line 74 (Gallery) is ~4.5 KB, line 75 ~3 KB. These are feature paragraphs pretending to be list items; split per-feature into sub-headings or move detail to architecture.md.
- features.md:63-108 (### Storage & Media through ### API Compatibility) — bullets 69 (archive import, ~2.3 KB), 77 (Add to album, ~2 KB), 110, 113, 121, 149 (2 KB each) each pack 5-15 sub-behaviors into one line.

### Task/PR-specific

None — the slice is roadmap/reference content, no single-task checklists.

### Readability

- Average line ~400 bytes with a max near 5.8 KB; the checklist format (✅ + one line per feature) breaks down when a "line" is a full paragraph — unreadable in any editor or diff.
- Deeply nested parentheticals (up to 3 levels, e.g. lines 13, 74, 75) make the one-line-per-feature format the main readability cost, independent of content quality.
- Section anchors referenced (`environment-variables.md#database-backed-server-settings-env--database--default`, `architecture.md#account-data-import`, `#browser-web-vitals`, `fitness-file-storage.md#gear-tracking`, `#security-and-privacy`, `maintenance.md#actor-archive-export`) all verified to exist.

