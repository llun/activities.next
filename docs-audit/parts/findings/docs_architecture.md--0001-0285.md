## docs/architecture.md lines 1-285

### Duplicates
- docs/architecture.md:117 ≈ AGENTS.md:138 ≈ CONTRIBUTING.md:520 — the migrations boilerplate ("`yarn migrate` runs with Kysely's migrator, registered in `migrations/index.ts` (their names in `migrations/names.ts`). The first, `20261014000000_baseline`, loads the frozen schema in `migrations/baseline/`") is stated three times almost verbatim; docs/maintenance.md:7 covers the same handover in its authoritative form.
- docs/architecture.md:211 ≈ docs/mastodon-api-compatibility.md:1170 — the whole RFC 9421 / draft-cavage inbound-verification spec (covered components, 8 KB/1 KB caps, 64-parameter limits, 12-hour freshness window, RFC 9530 Content-Digest, "no RFC 9421 signing and no double-knocking") is restated in both. The Mastodon doc even cross-links to architecture.md for the required components, then repeats them anyway. One location should carry the spec.
- docs/architecture.md:261 ≈ docs/architecture.md:325 ≈ docs/environment-variables.md:417 — polynomial-backoff retry + dead-letter behavior described twice inside this slice's file and again in the env-var table.
- docs/architecture.md:266 ≈ docs/fitness-file-storage.md:17-18 ≈ docs/maintenance.md:633 — the Wahoo routes (`/api/v1/settings/fitness/wahoo/authorize|callback`, `/api/v1/webhooks/wahoo/` with its trailing slash), the `wahoo_imports` row, and the retry/history behavior each appear in three files. architecture.md:266 is a ~200-word paragraph that belongs in the fitness guide.
- docs/architecture.md:274 ≈ docs/mastodon-api-compatibility.md:438,460 — the bulk-CSV-import behavior (20,000 rows, `bulk_imports`/`bulk_import_rows`, "Abandoned: no progress" lease handling) is described in both files.

### Stale
- none — verified: all 23 referenced files/symbols resolve via `git ls-files` (resolveClientId.ts, resolveStatusFromPath.ts, urlToId.ts, domainCheck.ts, servedDomainSnapshot.ts, signUpDomain.ts, domainIdentity*.ts, domainScope.ts, visitedFeatures.ts, domainAudience.ts, httpMessageSignature.ts, contentDigest.ts, deliverActivityJob.ts, replyCommunity.ts, createNote.ts, gallery/albums.ts, getSQLDatabase.ts, connection.ts, test/next.config.test.ts, proxy.ts, app/manifest.ts); all `ACTIVITIES_*` env vars named in the slice exist in `lib/` (ACTIVITIES_HOST, ACTIVITIES_TRUSTED_HOSTS, ACTIVITIES_SERVICE_NAME, ACTIVITIES_ENABLE_INBOX_FORWARDING, ACTIVITIES_QUEUE_TYPE); all six `@activities/*` workspace packages exist under `packages/`; the Wahoo routes exist under `app/`; the `#agents-better-auth-session-refresh` anchor target exists (explicit `<a id>` at docs/architecture.md:2831).

### History / changelog text
- docs/architecture.md:92-93 — "(rewritten from `/inbox`)" and "(rewritten from `/.well-known/nodeinfo`)" — notes about where these routes used to live; meaningless to a new reader of the current tree.
- docs/architecture.md:117 — "or records it on one the Knex migrations of v1.192.34 built" — Knex-handover release narrative inside the durable migrations paragraph.
- docs/architecture.md:167-170 — "a row written before the publicId backfill … backfill script that ships with v1.192.34" — rollout history of a one-time migration, twice in five lines.

### Long sections
- none over 80 lines in this slice. Longest is Public Identifiers at 43 lines (129-171); it is reference explanation and must stay, though its three history sentences (above) can go.

### Task/PR-specific
- docs/architecture.md:194 — "**Rules, announcements, reports and features are per domain too** (step 5)" — "(step 5)" is a dangling reference to a numbered implementation/migration plan that does not exist in the docs.
- docs/architecture.md:92-93 — "(rewritten from …)" parentheticals are release-specific notes (also listed under history).

### Readability
- docs/architecture.md:185-195 (Served Domains) — six bullets, each 150-330 words of run-on prose with parentheses nested four deep (e.g. the "Rules, announcements, reports and features are per domain too" bullet packs the schema, audience rules, admin scope resolution, and four admin-UI boxes into one bullet). Deserves sub-bullets or splitting per topic.
- docs/architecture.md:211 (Inbound Forwarding & Verification, first bullet) — one ~280-word bullet mixing the RFC 9421 component rules, size caps, clock-skew policy, draft-cavage fallback and outbound-policy statements; a spec table or sub-bullets would be scannable.
- docs/architecture.md:261-266 (Background Jobs / Wahoo) — the Wahoo paragraph interleaves webhook routing, next.config.ts redirect rules, OAuth token binding, queue locking and history-scan locking in one paragraph; the locking details would read better as a list.

### Slice summary
Lines 1-285 are the architecture overview: client/application/infrastructure boundaries, request-flow diagrams, directory tables, and key design decisions (database abstraction, Mastodon compat, public identifiers, auth, served domains, federation, jobs). The front half (through Directory Structure, 1-118) is clean durable reference. The back half accretes feature notes: served-domain policy details, the full 9421 signature spec, Wahoo sync internals and bulk-import lease mechanics — all of which have feature-specific homes (mastodon-api-compatibility.md, fitness-file-storage.md, maintenance.md) that already partially duplicate them. Roughly 20-25% of the slice (the Wahoo paragraph, the 9421 spec detail, the migration-handover/backfill history, the "(step 5)" remnant) could move or go.
