## docs/architecture.md lines 2049-2710

Single `### Actor Profile & Deletion Federation` section (2049-2802, this slice is
its middle). Twenty-two top-level bullets covering profile editing/federation,
account migration (in/out), handle rename, and profile-link verification.

### Duplicates
- docs/architecture.md:2193-2284 ≈ docs/mastodon-api-compatibility.md:1171 — the
  inbound `Move` handling is described twice at near-equal depth: cooldown
  (`move_in_progress`), alias verification, `MoveFollowerJob`/`MoveRelationshipsJob`
  carry-over rules, silenced-vs-unsilenced local followers, deterministic ids. The
  compatibility doc even ends "Details in architecture.md", yet restates nearly all
  of it. Checked: `git grep -nF 'move_in_progress'` → both files.
- docs/architecture.md:2666-2674 ≈ docs/architecture.md:1230 — `VerifyProfileLinksJob`
  fetch mechanics (`safeRemoteFetch`, 5 s + 5 s per hop, 1 MiB body, HTML only, two
  redirects) stated in both places in the same file.
- docs/architecture.md:2686-2710 ≈ docs/mastodon-api-compatibility.md:1295 —
  `fields[].verified_at` semantics: single-https-URL rule, `rel="me"` token matching
  profile URL/actor id/replaced handles, `requires_verification?` re-queue,
  `linksCheckedAt` never federated, "at most four fields", "verified link is not
  checked again until its value changes" — restated nearly verbatim.
- docs/architecture.md:2410-2481 (moved-account rules: posting refused, follow
  refused, scheduled statuses, fitness imports) ≈ docs/features.md:12 — the same
  rules (30-day cooldown, `PUT /api/v1/scheduled_statuses/:id` recovery, "A performed
  move is not undone", fitness backing status) restated in the feature list.
- docs/architecture.md:2488-2554 (rename, 30-day cooldown, handles reserved forever,
  rejected sign-up frees them, 308 redirects, remote rename via WebFinger) ≈
  docs/features.md:13 — same rules restated.
- docs/architecture.md:2490-2503 (createdWhileMoved / `isIsolatedFromFitnessImport`
  isolation rules, direct-with-no-mentions case, Wahoo revision) ≈
  docs/fitness-file-storage.md:11 — near-verbatim duplication of the whole paragraph.

### Stale
- none — every file path, symbol, route and migration id sampled exists:
  `lib/services/actors/actorUpdate.ts`, `hasFederatedProfileChange`,
  `lib/jobs/moveActorJob.ts`, `sendMoveJob.ts`, `isOutgoingMoveAuthorized`,
  `lib/services/accounts/migration/outgoingMove.ts`, `actorMigration/queries.ts`,
  `movedAccount.ts`, `actor/deletion.ts`, migrations `20261024131756` /
  `20261025141323`, `actorHandle/queries.ts`, `renameStatusUrlsJob.ts`,
  `getLocalHandleRedirect`, `lib/utils/http-headers/localHandleRedirect.ts`,
  `confirmActorHandle`, `formatProfileFieldValue`, `profileFieldVerification`,
  `queueProfileLinkVerification`, `fitnessImportIsolation`,
  `servedDomain/queries.ts`, `profile-links/html.ts`, `verifyProfileLink.ts`,
  `app/api/v1/accounts/migration/route.ts`, `interaction_policy/route.ts`,
  `settings/profile/page.tsx`, and symbols `rejectPendingAccount`,
  `updateActorWithPrevious`, `getPersistableProfile`, `publishActorUpdate`,
  `MAX_PROFILE_FIELDS` (checked via `git ls-files | grep` and `git grep -nF`);
  `htmlparser2` is in package.json.

### History / changelog text
- docs/architecture.md:2391-2392 — "Both used to refuse an origin with a private
  key. Now a local origin…" — past-behaviour narrative; state current behaviour only.
- docs/architecture.md:2102-2104 — "replacing profile editing from the former
  General page and the old Featured hashtags settings tab" — migration-history note
  about removed UI; the "former/old" framing is changelog, not reference.
- docs/architecture.md:2413-2415 — "The former 'General' page is removed: settings
  are split into focused pages" — same removed-UI history pattern.
- docs/architecture.md:2543-2544 — "keeps its handles reserved (a behaviour
  change)" — "(a behaviour change)" is a changelog aside.
- docs/architecture.md:2679 — "or — since the in-place rename —" — "since X"
  history marker; the rule alone suffices.

### Long sections
- docs/architecture.md:2049-2802 `### Actor Profile & Deletion Federation` (754
  lines, this slice is 662 of it) — far over any reasonable section size; should be
  split into subsections (Profile editing / Account migration / Handle rename /
  Profile links), each of which is still large.
- docs/architecture.md:2193-2284 inbound `Move` bullet (92 lines) — split; the
  MoveFollowerJob mechanics alone are ~50 lines.
- docs/architecture.md:2096-2171 Edit profile page bullet (76 lines) — mixes page
  structure, unsaved-changes guard browser quirks, and actor-check UX; split.
- docs/architecture.md:2410-2481 clearing/posting/deletion bullet (72 lines) —
  mixes DELETE semantics, moved-account API matrix, and fitness-import isolation;
  the isolation part duplicates fitness-file-storage.md and could go entirely.
- docs/architecture.md:2285-2352 outgoing move + recording bullets (68 lines) —
  dense status-code narrative; could be a table of error → condition.
- docs/architecture.md:2488-2554 rename bullets (67 lines) — reference-dense but
  readable; keep, trim the defensive asides.

### Task/PR-specific
- none — no checklists, PR numbers, or single-task instructions in this slice.

### Readability
- Bullets routinely run 60-90 lines as a single sentence chain with nested
  parentheticals three levels deep (e.g. 2136-2150 on the Navigation API and
  Chromium's interaction requirement); sentences of 80+ words are normal.
- Repeated defensive hedging: "best effort", "never fails the request",
  "as Mastodon does/does not", Mastodon parity asides appear dozens of times and
  often duplicate the adjacent normative statement.
- The slice mixes four audiences in one section: federations wire format, API
  status-code contracts, UI behaviour (toasts, focus, container queries at 860px,
  sticky bars), and DB schema — none separated by subheadings.

### Slice summary
Deep reference material for profile federation, account migration and handle
rename; all checked symbols/paths are current, so nothing is stale. The bulk of
the trim comes from duplication: the Move, moved-account and rename bullets
restate (or are restated by) mastodon-api-compatibility.md, features.md and
fitness-file-storage.md — roughly 150-200 lines here could shrink to links. The
single 754-line section needs subheadings and its 60-90-line bullets split.
