## docs/architecture.md lines 3459-4033

### Duplicates
- docs/architecture.md:3589-3610 ("Review: Unconfirmed accounts & app tokens", the `OptionalOAuthGuard` downgrade and the `unconfirmedAccount: 'allow'` single-consumer rule) ≈ docs/architecture.md:2889-2895 — the same unconfirmed-account refusal, downgrade-to-anonymous, and single-carve-out rules are stated at full length in two places in this file (slice version is the condensed one).
- docs/architecture.md:3687 vs 1298/1429/1480 — `MOBILE_FEED_SURFACE_CLASS` feed-framing geometry is described at line 3687 and again in the layout sections at 1298, 1429 and 1480.

### Stale
- none — spot-checked symbols and paths against the repo and all exist: `scripts/mock/renderEmailPreviews.ts`, `buildPreviews`, `getServedLinkDomain`, `resolveStatusPreviewUrl`, `extractPreviewUrl`, `recordLinkPreviewFailure`, `MOBILE_FEED_SURFACE_CLASS`, `useMediaStripScroll`, `getMediaGeometry`, `isRenderableAttachment`, `isActorConfirmationPending`, `surfaceKitUsage.test.ts`, `docs/maintenance.md`.

### History / changelog text
- docs/architecture.md:3572-3574 — "two attempts at that bound shipped wrong in opposite directions" (past-bug narrative inside the verifiedAt rule).
- docs/architecture.md:3663 — "This has bitten twice." (incident history, not a rule).
- docs/architecture.md:3757 — "the branch this replaced cropped every portrait photo to a full-width 16:9" (old-implementation history).
- docs/architecture.md:3895 — "that is precisely how `sendUndoAnnounceJob` shipped broken" (past-bug narrative).

### Long sections
- docs/architecture.md:3684-3876 `Review: Post media layout` (193 lines) — several walls of text; the media-strip/bleed and lightbox bullets could be split into subsections or tables.
- docs/architecture.md:3908-4002 `Review: Link preview cards` (95 lines) — could be split (caching vs extraction vs parser divergence).
- (section 4003 `Offline-First PWA Launch & Timeline Caching` begins at the slice boundary and continues past it.)

### Task/PR-specific
- none found — the slice is review-rule reference content.

### Readability
- 3564-3642 `Review: Unconfirmed accounts & app tokens` is 79 lines of dense single-paragraph bullets nesting three interlocking rules (verification columns, guard dispositions, migration history); a wall of caveats.
- 3684-3876: one bullet on media bleed spans ~30 lines with mid-sentence bold switches; the corner-rounding bullet re-explains tailwind-merge resolution in prose.

### Slice summary
This slice is the tail of the "Review:" rule catalog (surfaces, logging, auth, emails, media layout, link previews) plus the first lines of the offline-PWA section. It is almost entirely durable rule content; the cleanup opportunities are the duplicated unconfirmed-accounts rules (3564-3642 vs 2889-2895), four history-narrative sentences, and splitting the two 95+ line sections.
