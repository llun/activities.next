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
