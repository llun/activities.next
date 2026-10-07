# Architecture Overview

This document describes the high-level architecture of Activity.next, an ActivityPub server built on Next.js.

## System Architecture

```text
Client boundary
  ├─ Web browser (HTML/SSR)
  ├─ Mastodon-compatible apps (OAuth 2.0 + API)
  └─ Remote ActivityPub servers (HTTP Signatures)
        │
        ▼
Application boundary: Next.js App Router (app/)
  ├─ Presentation: pages, layouts, SSR, hydrated React components
  ├─ Mastodon API: /api/v1, /api/v2
  ├─ Auth/OAuth: /api/auth, /api/oauth
  └─ Federation endpoints: /api/users, /api/inbox, /.well-known
        │
        ▼
Domain and service boundary: Core library (lib/)
  ├─ Services: auth, guards, media, fitness, collections, email, queue, federation, translation
  ├─ ActivityPub: create, follow, like, announce, update, delete, undo
  ├─ Jobs: delivery, imports, fitness processing, map and heatmap generation
  └─ Shared UI: post box, posts, settings, profile, timeline, UI primitives
        │
        ▼
Infrastructure boundary
  ├─ Database layer: Knex with SQLite/PostgreSQL; MySQL-compatible config paths
  ├─ File storage: local filesystem, S3, or S3-compatible object storage
  └─ External services: QStash, SMTP/Resend/SES, OpenTelemetry
```

## Request Flow

### Web Browser Request

```
Browser ──→ Next.js Page (SSR) ──→ Service Layer ──→ Database
                 │
                 └──→ React Components (hydrated on client)
```

### Mastodon API Request

```
Mastodon App ──→ OAuth 2.0 Token Validation
                      │
                      └──→ /api/v1/* Route ──→ Guard ──→ Service ──→ Database
                                                             │
                                                             └──→ Storage (media)
```

### Incoming ActivityPub Message

```
Remote Server ──→ /api/inbox or /api/users/:username/inbox
                      │
                      └──→ HTTP Signature Verification
                                │
                                └──→ Activity Processing
                                        │
                                        ├──→ Database (store status/follow/like)
                                        └──→ Queue (async jobs)
```

### Outgoing ActivityPub Message

```
User Action ──→ Service Layer ──→ Queue Job
                                     │
                                     └──→ Build Activity Object
                                             │
                                             └──→ Sign with HTTP Signature
                                                      │
                                                      └──→ POST to Remote Inbox
```

## Directory Structure

### `app/` — Next.js App Router

The frontend and API layer, organized using Next.js route groups:

| Directory             | Purpose                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/(timeline)/`     | Main app pages with sidebar (home, profile, notifications, settings)                                                                                                     |
| `app/(nosidebar)/`    | Authentication pages without sidebar (login, signup, OAuth consent)                                                                                                      |
| `app/embed/`          | Public embed widgets (framable interactive heatmap embeds and static share images)                                                                                       |
| `app/health/`         | Unauthenticated `GET /health` liveness probe returning `{"status":"UP"}`                                                                                                 |
| `app/api/auth/`       | Authentication endpoints (better-auth)                                                                                                                                   |
| `app/api/inbox/`      | Shared ActivityPub inbox receiving federated activities (rewritten from `/inbox`)                                                                                        |
| `app/api/nodeinfo/`   | NodeInfo 2.0 and 2.1 documents and discovery (rewritten from `/.well-known/nodeinfo`)                                                                                    |
| `app/api/oauth/`      | OAuth 2.0 provider endpoints (authorize, userinfo, revoke) — the token endpoint lives at `app/(nosidebar)/oauth/token/`, serving `/oauth/token`                          |
| `app/api/oembed/`     | Public oEmbed provider (`GET /api/oembed`) returning rich embed metadata for this instance's public/unlisted status pages                                                |
| `app/api/users/`      | ActivityPub actor endpoints (inbox, outbox, followers, following)                                                                                                        |
| `app/api/v1/`         | Mastodon-compatible API v1 (statuses, timelines, accounts, notifications)                                                                                                |
| `app/api/v2/`         | Mastodon-compatible API v2 (instance info, media, search)                                                                                                                |
| `app/api/well-known/` | Federation discovery (WebFinger, host-meta, OAuth/OIDC metadata) — NodeInfo is served from `app/api/nodeinfo/` via a `next.config.ts` rewrite of `/.well-known/nodeinfo` |

### `lib/` — Core Business Logic

| Directory              | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `lib/activities/`      | ActivityPub protocol — building and processing Activity objects             |
| `lib/services/`        | Business logic services (auth, media, notifications, email, etc.)           |
| `lib/services/guards/` | Request authentication guards (session, OAuth token, ActivityPub signature) |
| `lib/database/`        | Database abstraction layer using Knex query builder                         |
| `lib/jobs/`            | Background job handlers (sending activities, processing uploads)            |
| `lib/components/`      | Shared React components (posts, post-box, settings, UI primitives)          |
| `lib/config/`          | Configuration loading and validation (Zod schemas)                          |
| `lib/types/`           | TypeScript type definitions (ActivityPub, Mastodon API, database, domain)   |
| `lib/utils/`           | Utility functions (logger, API response helpers, text processing)           |

### `migrations/` — Database Schema

Knex migration files that define the database schema. Migrations are designed to work with SQLite and PostgreSQL, while avoiding assumptions that break MySQL-compatible Knex clients where possible.

## Key Design Decisions

### Database Abstraction

All database operations go through the `lib/database/` layer using [Knex.js](https://knexjs.org/) as the query builder. This enables SQLite (development/small instances) and PostgreSQL (production) support without changing application code. The configuration loader also accepts MySQL-compatible Knex clients for deployments that provide the needed driver/runtime support.

### Mastodon API Compatibility

The `/api/v1/` and `/api/v2/` routes implement a subset of the [Mastodon API](https://docs.joinmastodon.org/api/), allowing users to connect with Mastodon-compatible client applications (Ivory, Ice Cubes, Tusky, etc.).

### Public Identifiers

Internally an actor or a status is addressed by its ActivityPub URI (`actors.id`,
`statuses.id`). That URI is the join key throughout `lib/` and the value that
federates, but it is not what clients are given as an id. Both tables also carry
a `publicId` — a UUIDv7 minted from the row's `createdAt`, so ids stay
time-ordered — and that is the identifier the server hands out:

- The Mastodon API serializes `Status.id` and `Account.id` (and every id that
  references one, including the `max_id` / `min_id` / `since_id` pagination
  cursors) as the `publicId`.
- Web status detail pages are `/@username@domain/<publicId>`.
- `uri` and `url` still carry the ActivityPub URI. An id is not a URL, and
  neither can be computed from the other.

Resolution is deliberately asymmetric: only the `publicId` is emitted, but every
form the instance has ever handed out is still accepted on input, permanently.
There are two resolution boundaries:

- `lib/services/mastodon/resolveClientId.ts` — the API. Accepts a `publicId`,
  the colon-encoded form (`domain:users:username`), the `apurl_` opaque form,
  and a raw ActivityPub URI.
- `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts` — the web status
  page. Accepts a `publicId`, the sha256 hash of a local status URL, a
  percent-encoded remote status URI, and a bare local status-id tail.

The accept side has to stay permanent because emission is not universal either:
a row written before the publicId backfill, and a remote actor this instance
does not store, have no `publicId` and fall back to emitting the legacy form.

Because every form is accepted, the first-party web client (`lib/client.ts`)
sends ids back exactly as it received them — re-encoding is not merely
redundant, it is destructive: `urlToId` reads a bare UUIDv7 as a URL host and
returns it with a trailing colon, which neither resolution boundary can decode.
The one transformation left is `toIdPathSegment` (`lib/utils/urlToId.ts`), used
for an id interpolated into a URL **path** segment; it encodes only a raw
ActivityPub URI, whose slashes would otherwise split the route.

`publicId` is only ever minted on insert — there is no lazy mint — so existing
rows are filled in by the `backfillPublicIds.ts` maintenance script; see
[Maintenance](./maintenance.md#public-id-backfill).

### Authentication

Authentication is handled by [better-auth](https://www.better-auth.com/), which provides:

- Local email/password authentication
- Passkey authentication
- Two-factor authentication
- Session management stored in the database, slid forward only inside better-auth's own `/api/auth/*` handler, where its `Set-Cookie` reaches the browser (see [Better-auth Session Refresh](#agents-better-auth-session-refresh))
- OAuth 2.0 access tokens (JWT and opaque) for API access

The application also acts as an **OAuth 2.0 provider** (using better-auth's OAuth provider plugin), allowing third-party applications to authenticate users and access the API.

### ActivityPub Federation

The server implements the [ActivityPub](https://www.w3.org/TR/activitypub/) protocol for federation:

- **Inbox** (`/api/inbox`, `/api/users/:username/inbox`) — Receives activities from remote servers
- **Outbox** (`/api/users/:username/outbox`) — Lists activities by a local actor
- **WebFinger** (`/.well-known/webfinger`) — Actor discovery, including the `http://ostatus.org/schema/1.0/subscribe` template that points remote-follow visitors at `/authorize_interaction`
- **Remote follow** (`/authorize_interaction?uri=…`) — Mastodon-compatible landing page where a signed-in local user confirms following an account another server sent them to; the outbound half (a logged-out visitor following a local account from their own server) resolves through `GET /api/v1/remote-follow`
- **NodeInfo** (`/.well-known/nodeinfo`) — Instance metadata, served as NodeInfo 2.0 and 2.1
- **HTTP Signatures** — All outgoing requests are signed with draft-cavage HTTP Signatures (`rsa-sha256`, with a signed `Digest` on requests that carry a body). Incoming requests are verified as either draft-cavage or [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421) HTTP Message Signatures (`rsa-v1_5-sha256` or `ed25519`); an [RFC 9530](https://www.rfc-editor.org/rfc/rfc9530) `Content-Digest` is checked whenever one is present

#### Inbound Forwarding & Verification

Incoming HTTP deliveries to `/api/inbox` and `/api/users/:username/inbox` are guarded by `ActivityPubVerifySenderGuard`:

- **Signature scheme**: a request carrying a `Signature-Input` header is verified as an RFC 9421 HTTP Message Signature (`lib/utils/httpMessageSignature.ts`); any other request takes the draft-cavage path unchanged. RFC 9421 uses the first label present in both `Signature-Input` and `Signature` (no fallback to a later one) and must cover `@method`, either `@target-uri` or `@authority` + `@path` (plus `@query` or `@request-target` when the URL has a query), and on `POST` the `content-digest` header, whose RFC 9530 value (`lib/utils/contentDigest.ts`, sha-256/sha-512) must match the body; a legacy `Digest` on the same request is ignored. Covered components with parameters (`;sf`, `;key`, `;bs`, `;req`, `;name`), `@query-param`, `@status`, duplicates, more than 32 components are rejected. `Signature-Input` and `Signature` are each capped at 8 KB, `Content-Digest` at 1 KB, and each dictionary item or inner list at 64 parameters; over-limit values are rejected. The target URI authority drops the default `:443` port, the same as `@authority`. Derived components are rebuilt from our own view of the request — `https://` + the trusted host from `headerHost` + path and query — never from what the sender says it signed. The `alg` parameter must agree with the key type (`rsa-v1_5-sha256` for RSA, `ed25519` for Ed25519) and is inferred from the key when absent. `created` is required and both schemes share one freshness window (`isWithinSignatureWindow`: 12 hours from creation or the signature's own `expires`, if sooner, with an hour of clock skew either side). From there both schemes share the same tail: `keyid` resolution through `getSenderPublicKeyDetails`, the domain policy check, the one throttled key-rotation refresh, owner binding and forwarding detection. Rejections reuse the draft-cavage reasons and add `inbox.signature_scheme = rfc9421`; the signature bytes are never put on a span. A draft-cavage request is still judged on its `Digest`, but a present `Content-Digest` that contradicts the body or cannot be parsed fails it with `digest_mismatch`. Outbound delivery stays draft-cavage: there is no RFC 9421 signing and no double-knocking (retrying a rejected delivery under the other scheme).
- **Direct deliveries** (HTTP signature signer === activity `actor`): verified payload enters the direct pipeline.
- **Forwarded deliveries** (ActivityPub §7.1.2 inbox forwarding, HTTP signature signer ≠ activity `actor`):
  - Pass the guard with `forwarded: true` rather than rejecting with a 403 `sender_actor_mismatch`.
  - Span attributes record `inbox.forwarded = true`, `inbox.verified_sender`, and `inbox.activity_actor`.
  - **`Create` / `Update` / `Delete`** activities carry unverified payloads: the embedded object is discarded and the activity is routed to `ProcessForwardedActivityJob` to verify the object against its origin server via re-fetch before applying any state changes.
  - **Non-status activities** (`Follow`, `Accept`, `Reject`, `Like`, `Undo`) lack an origin re-fetch verification path and are acknowledged with `202 Accepted` and dropped without side effects (Mastodon parity).

#### Outbound Inbox Forwarding (W3C ActivityPub §7.1.2)

When enabled via the `ACTIVITIES_ENABLE_INBOX_FORWARDING` environment variable (default: `false`), the instance fans out verified public replies and mentions targeting local users to those users' remote followers:

- **Forwarding Criteria**:
  - `isInboxForwardingEnabled()` is `true`.
  - **Direct Delivery Only**: Inbound activity arrived via direct HTTP signature delivery from the original author (`verifiedSenderActorId === author`). Inbound forwarded deliveries and relay announces are excluded to prevent forwarding loops.
  - **Public Audience**: Note/activity includes `as:Public` or the ActivityStreams public IRI in `to` or `cc`.
  - **Target Condition**: Inbound activity is in-reply-to a status authored by a local user, or explicitly mentions a local user in `tag`, `to`, or `cc`.
- **Follower Inbox Resolution & Deduplication**:
  - Queries active remote followers (`FollowStatus.Accepted`) for target local actors (`getFollowersInbox`), preferring `sharedInbox` where available.
  - Excludes local server inboxes, inboxes matching the original author's host, and inboxes of recipients explicitly addressed in `to`/`cc`.
  - Moderation check: Filters out inboxes belonging to blocked or non-federatable domains via `canFederateWithDomain`.
- **Asynchronous Delivery & Observability**:
  - Enqueues `ForwardActivityJob` on the job queue (`Create`, `Update`, `Delete` activities), split by `getForwardActivityJobMessages` into messages of at most `MAX_FORWARD_INBOXES_PER_JOB` (100) inboxes, so one remote activity aimed at a popular local account cannot outgrow a queue provider's message limit.
  - Each job delivers at most `FORWARD_ACTIVITY_CONCURRENCY` (8) requests at a time; per-request timeouts and response caps alone do not bound how many sockets one forwarded activity holds open.
  - Outbound HTTP POST requests are signed with the targeted local actor's key or the instance federation signing actor (`getFederationSigningActor`).
  - OpenTelemetry spans track `inbox.forward_targets_count`, `inbox.local_actor_id`, and `inbox.activity_id`.

On follow accept, `acceptFollowRequest` enqueues `FollowTimelineBackfillJob`. First discovery of a remote actor (zero stored statuses) fetches the outbox first page (cap 20, public/unlisted only, Announces skipped, each `Create` routed through `CreateNoteJob`/`CreatePollJob` with the followed actor pinned as verified sender), then the actor's stored statuses are merged into the follower's home timeline (also the whole behavior for already-known and local actors); best-effort — a failure never affects the follow.

### Background Jobs

Long-running operations (sending activities to remote servers, processing file uploads) are dispatched to a background queue. Supported backends:

- **Database Queue (Transactional Outbox)** — Built-in resilient queue stored in `queue_jobs` table (`ACTIVITIES_QUEUE_TYPE=database`). Executes jobs asynchronously with polynomial backoff retries and dead-letter queue persistence.
- **Upstash QStash** — Managed HTTP-based message queue (recommended for production)
- **Google Cloud Tasks** — Managed HTTP-based task queue with OIDC verification and dead-letter queue support
- **Synchronous** — Jobs execute inline (default, suitable for small instances and local development)

Wahoo cloud synchronization requires an asynchronous durable backend. The authenticated settings API is `/api/v1/fitness/wahoo`; the OAuth routes are `/api/v1/settings/fitness/wahoo/authorize` and `/api/v1/settings/fitness/wahoo/callback`. Wahoo posts workout-summary events to the exact trailing-slash URL `/api/v1/webhooks/wahoo/`. `next.config.ts` skips the framework's automatic trailing-slash redirect and restores the ordinary slash-removal redirects through explicit rules, except for this exact webhook path, so its POST reaches the handler without a redirect. The handler binds the configured token to the authorized Wahoo user; an active Wahoo user and webhook-token pair can bind to only one local connection. It records an idempotent `wahoo_imports` row before dispatching `ImportWahooActivityJob`. Date-range backfill uses `/api/v1/fitness/wahoo/history` and `ImportWahooHistoryJob`; failed individual workouts are listed and retried through `/api/v1/fitness/wahoo/imports`. The history and workout rows remain durable across queue retries, and the shared `fitness-import:<actorId>` lock coordinates Wahoo with Strava post creation and primary-file map processing. History polling, cancellation, and retry share the `wahoo-history-start:<actorId>` lock so a poll cannot finalize a scan between retrying failed items.

Wahoo OAuth callback and token-refresh writes are fenced by the saved credential revision. Changing application credentials invalidates outstanding authorization state, and disconnect clears credentials; an in-flight callback or refresh cannot restore tokens after either change.

External queue clients (`@upstash/qstash` and `@google-cloud/tasks`), the PostgreSQL driver (`pg`), and optional email providers (`nodemailer`, `resend`, `@aws-sdk/client-ses`) are isolated into dedicated Yarn workspaces under `packages/` (`@activities/qstash`, `@activities/cloudtasks`, `@activities/pg`, `@activities/nodemailer`, `@activities/resend`, `@activities/ses`). They are loaded on demand dynamically (via `dynamicImport` with type stubs for queue and email clients, or Knex dynamic driver loading for PostgreSQL), preventing optional SDKs from being unconditionally bundled into the minimal standalone application. The Dockerfile includes `@activities/nodemailer` by default; builds omitting email workspaces gracefully disable email delivery.

#### Queues & Dead Letter Queue (DLQ) Management

Instance administrators can inspect terminally failed tasks, view formatted payloads and error stack traces, re-dispatch jobs, drop all messages, or purge discarded records via the Admin UI at `/admin/queues`. Messages are sorted by failure time in descending order (most recent terminal failures first). The admin interface is queue-backend agnostic and seamlessly adapts to the active provider:

- **Database Queue (`ACTIVITIES_QUEUE_TYPE=database`)**:
  - Tasks are persisted directly into the `queue_jobs` table in the database.
  - Processed asynchronously by the in-process runner (bootstrapped via `instrumentation.ts` when configured) or by a standalone worker process (`scripts/maintenance/runQueueWorker.ts`).
  - The standalone worker handles `SIGINT` and `SIGTERM` through one idempotent shutdown operation: it drains the runner, then closes the database within a shared 30-second deadline. Repeated signals do not bypass the drain. A failed or expired shutdown exits unsuccessfully, leaving any unfinished processing claim reclaimable by the queue's stalled-job recovery.
  - Workers atomically claim batches of due jobs (`pending` -> `processing`) using unique UUID ownership tokens (`claim_token`). Completion, retry, and failure settlement require matching the active token.
  - Operational note: Old workers must be drained before a mixed-version rollout to ensure claims are settled with compatible token parameters. Claim tokens protect against concurrent or stale queue state transitions, but do not promise exactly-once external effects.
  - Unhandled job errors trigger polynomial backoff retry scheduling (`attempt^4 + 15` seconds, up to `ACTIVITIES_QUEUE_DATABASE_MAX_RETRIES` / default 16 attempts spanning ~7.5 days, matching Mastodon queue retry resilience).
  - Upon reaching maximum retries, failed tasks are stored in `dead_letter_jobs` and marked failed in `queue_jobs`, making them manageable via the Admin UI at `/admin/queues`.
  - `completed` rows keep their full payload, so the runner (in-process and standalone) sweeps them: every 10 minutes it deletes rows completed more than 7 days ago in batches of 500 (`purgeCompletedQueueJobs`, `startDatabaseQueueRunner` options `completedRetentionMs` / `retentionSweepIntervalMs`). The job id is the dedup key, so that retention window is also the window in which re-publishing an already-completed id is ignored. `failed` and `pending` rows are never swept.
- **Google Cloud Tasks (`ACTIVITIES_QUEUE_TYPE=cloudtasks`)**:
  - Webhook endpoint: `/api/v1/queue/cloudtasks` (returns 404 unless the configured queue is CloudTasks).
  - Tasks are authenticated via Google Cloud OIDC tokens or pre-shared webhook secrets (`Authorization: Bearer <secret>`, `x-cloudtasks-secret`, or `x-cloudtasks-token`). Plain service account headers (`x-service-account` / `x-cloudtasks-serviceaccount`) are not accepted.
  - OIDC verification requires a configured service account email and validates Google issuer, cryptographic signature, audience (`ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE` falling back to `ACTIVITIES_QUEUE_URL`), service account email match, and `email_verified === true`. An audience alone never authorizes arbitrary Google identities.
  - While retries are below `ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES` (default 5), the endpoint returns HTTP 500 so Cloud Tasks applies exponential backoff.
  - On terminal failure, the task is captured in the database `dead_letter_jobs` table and HTTP 200 is returned to acknowledge delivery. The Admin UI queries and manages these records in the database.
- **Upstash QStash (`ACTIVITIES_QUEUE_TYPE=qstash`)**:
  - Webhook endpoint: `/api/v1/queue/qstash`.
  - Deliveries are verified using QStash HMAC signing keys.
  - While retries are below `ACTIVITIES_QUEUE_QSTASH_MAX_RETRIES` (default 3), the endpoint returns HTTP 500 with error details so QStash retries with exponential backoff.
  - On terminal failure, QStash automatically retains the task in Upstash's hosted Dead Letter Queue. The Admin UI connects directly to QStash's native DLQ API (`client.dlq`) to list, retry (`client.dlq.retry`), or delete (`client.dlq.delete`) dead-lettered messages without duplicate database storage.

Note the difference where a job is delayed: Database queue, QStash, and Cloud Tasks honour `delaySeconds`, while
the synchronous backend has no scheduler and **drops** any delayed message. Code
that wants a delay must therefore check `getQueue().runsInline` and skip the
delay rather than losing the job (see `syncStatusLinkPreview`).

**Delayed actor deletion** (`POST /api/v1/actors/delete` with `delayDays`) records
`deletionStatus = 'scheduled'` and `deletionScheduledAt`, and nothing else would
ever move it on, so `lib/services/actors/actorDeletion.ts` carries it out two
ways. Under a real queue `publishActorDeletion` publishes a `DeleteActorJob`
with `delaySeconds` (and the `scheduledAt` it was queued for). Under the
in-process queue, which drops delayed messages, nothing is published; instead
`instrumentation.ts` starts `startActorDeletionSweep`, which every ten minutes
publishes a job for each actor whose `deletionScheduledAt` has passed. The
sweep also runs behind a real queue as the safety net for a lost job, skipping
deletions overdue by less than five minutes so an in-flight job is not doubled.
`deleteActorJob` is the guard that makes both safe: it does nothing for an actor
that is no longer `scheduled` (cancelled), does nothing before
`deletionScheduledAt` (re-queuing itself with the remaining delay when the queue
can), and discards a job whose `scheduledAt` no longer matches (cancelled, then
scheduled again). A process that never runs `instrumentation.ts` (a serverless
deployment on the in-process queue) has no sweep, so delayed deletions need a
real queue there.

#### Status Deletion & Transactional Outbox Semantics

Status deletion (`deleteStatusFromUserInput`) adapts its federation queue dispatching to the configured queue backend:

- **Database Queue (`ACTIVITIES_QUEUE_TYPE=database`)**:
  - Employs the transactional outbox pattern via `deleteStatusWithQueueJob`.
  - The status deletion (including cascading deletions of replies, tags, likes, and counter updates) and the insertion of `SendDeleteNoteJob` into `queue_jobs` occur atomically in the exact same database transaction.
  - Recipient addresses (`to` and `cc`), actor ID, and status ID are snapshotted before deleting the status record and embedded into the job payload.
  - Job configuration matches `DatabaseQueue` defaults (`attempts: 0`, `status: 'pending'`, `maxRetries` from `ACTIVITIES_QUEUE_DATABASE_MAX_RETRIES` or default 16, `nextRunAt` set to immediate).
  - No secondary publish step is executed after transaction commit.
  - If the database transaction fails, the entire operation rolls back (the status and dependent rows are preserved, and no queue job is persisted), propagating the transaction failure to the caller.
- **External & Synchronous Queues (QStash, CloudTasks, inline NoQueue)**:
  - Preserves a two-phase delete-then-publish workflow: `database.deleteStatus` commits the local deletion first so the status disappears immediately from author and local timelines.
  - The `SendDeleteNoteJob` is then published to the queue with the pre-deletion recipient snapshot.
  - If publishing to the external queue fails, the error is logged without masking the committed local deletion, ensuring the user is not falsely told their post remains when it has already been removed.

### Link Preview Cards

When a status contains a link, `FetchLinkPreviewJob` fetches that page once,
extracts its OpenGraph/Twitter-card metadata, and stores it as a preview card
that both the web UI and the Mastodon API's `Status.card` render.

- Cards are cached **per URL** in `link_previews`, keyed by a sha256 of the
  normalized URL, and `status_link_previews` maps a status to the card it shows.
  A link shared by many posts is fetched once, not once per post.
- Pages are fetched through `safeRemoteFetch` (HTTPS only, private-IP
  blocklists, DNS pinning, redirect and body caps) with a 2 MiB transfer cap
  (bodies over 2 MiB are truncated rather than rejected) and a
  5s-per-hop budget over at most one redirect,
  and must answer `text/html` in UTF-8 to be parsed at all. Up to 1 MiB of the
  document `<head>` is read, by htmlparser2's `Tokenizer` rather than a
  tree-building parse: the byte cap bounds transfer, not CPU, and both
  `htmlToDOM` and htmlparser2's `Parser` are quadratic in nesting depth (1 MiB
  of unclosed `<div>`s blocked the event loop for seconds). Do not swap it back
  for either.
- A completed card is re-read after 7 days. A failure is stored as a
  negative-cache row for an hour, so an unreachable host is not re-contacted for
  every post that mentions it.
- Fetches for **remote** statuses are delayed by a random 1–59s under a real
  queue, so a widely-shared link does not get hit by every receiving server at
  once.
- Admins can turn fetching off entirely under Admin → Network → Link previews
  (`network.linkPreviews`). Cards already stored keep rendering.

### Route Heatmap Tiles

A fitness route heatmap used to be one pre-simplified blob of geometry per
heatmap row. That blob is simplified once against a single global budget set by
the actor's whole history, so it can only ever be drawn at one fidelity: zooming
in revealed nothing the blob did not already contain. `fitness_route_heatmap_pyramids`
and `fitness_route_heatmap_tiles` replace it with a per-actor tile pyramid, and
every surface that draws a heatmap reads tiles when the row has them.

- The pyramid is built at a fixed **zoom ladder** — 4, 6, 8, 10, 12, 14, 16 —
  with a 256-unit tile extent, each rung simplified to about one pixel at its
  own zoom. A build folds each activity exactly **once**: visit counts
  accumulate, so a double fold is a permanently wrong number nothing downstream
  can detect. The fold gate is positional, against the build's own cursor.
- Only the **all-activities, all-time** row can be tile-backed. The filters that
  make a variant (one sport, one year) live on the heatmap row, and the tiles
  carry neither, so a scoped row is not something the pyramid can answer however
  complete it is. `buildHeatmapTileSource` is the single predicate for this, and
  it is what every surface that names a heatmap row gates on. The owner tile
  route needs no equivalent: its request names a region and nothing else, so
  there is no variant for it to contradict.
- Tiles are stored **unclipped**, and a share's region is applied when they are
  **served**. That makes clipping a security boundary rather than a view option:
  the region comes from the shared row, never from the caller.

Four surfaces read the pyramid:

- `GET /api/v1/accounts/:id/fitness-route-heatmap/tiles` — the owner's own map.
  Session-authed and owner-only, clipped to the caller's own region, at most
  `MAX_TILES_PER_REQUEST` (128) tiles per request.
- `GET /embed/heatmap/:token/tiles` — the public one. The capability is the
  share token; out-of-region tiles are settled before any geometry is read, the
  privacy flag is stripped exactly as the public flattening has always done, and
  only a `completed` pyramid serves tiles, only at its own version.
- The interactive maps (MapLibre GL and MapKit) fetch tiles for the current
  view, coarsening down the ladder rather than refusing when a view would need
  too many, and cache them across pans.
- `GET /embed/heatmap/:token/image` — the static share/embed image. It picks the
  rung from the image's own size, along whichever axis the renderer fits by. Where
  it falls through to the keyless SVG renderer it also shades each stroke by its
  visit count and colours it along the heat ramp the interactive map paints with
  (`HEAT_COUNT_COLOR_STOPS`, from its orange stop to its yellow one — never red);
  the Apple and Mapbox renderers draw at one flat opacity, and the Mapbox overlay
  in the ramp's orange. `?format=png`
  rasterizes that keyless fallback instead of serving SVG — which is what the
  public share page's `og:image` asks for, since no link-preview crawler renders
  SVG. It is opt-in, so an existing embed keeps the scalable image; any other
  value takes the default.

The stored blob has not gone away. It still renders every row the pyramid cannot
answer — any variant, and anything belonging to an actor whose pyramid has not
completed a build (which is decided when the row is read, not when it was built) — and it is
what the static image falls back to when a basemap renderer cannot draw tile
geometry: tile geometry is one run per way per tile where the blob is roughly
one polyline per activity, and both Apple (a hard overlay ceiling) and Mapbox (a
URL-length budget) are built for the latter shape. Each renderer is offered the
tiles first and the blob second and decides for itself.

Future work: adding an activity could extend the pyramid incrementally at
upload time instead of requiring a regenerate. The hook for it is reserved and
the design allows it, but it is deliberately not built.

### Media & File Storage

Media files (images and video) and fitness files (.fit, .gpx, .tcx) support multiple storage backends:

- **Local filesystem** — Files stored in a local directory
- **S3** — Amazon S3
- **Object storage** — Any S3-compatible service (MinIO, DigitalOcean Spaces, Cloudflare R2, etc.)

An image reaches storage by one of two routes, and only one of them processes
the bytes. Which route a given upload takes is a property of the mechanism, not
of the surface the user is on — the same picker can take either.

**Server-side write** (`saveMedia`, `saveMediaThumbnail` and
`saveMediaImageRendition` in `lib/services/medias/`) re-encodes the image — WebP
unless the caller asks for another format — and bounds the result by a 4000x4000
pixel box. That box is a **cap, not a target**: an image already inside it is
stored at its own dimensions and is never upscaled. This runs whenever the
server itself holds the bytes: the sync upload endpoint, the Mastodon-API
multipart avatar/header handler (`PATCH /api/v1/accounts/update_credentials`
and `PATCH /api/v1/profile`), custom emojis, thumbnail replacement
(`PUT /api/v1/media/:id`), the JPEG route-map copy the import email points at,
and the fitness import jobs — which cover both the route maps the server
generates and the arbitrary-sized activity photos it fetches from Strava.

The sync upload endpoint also accepts an optional `thumbnail` beside the file,
and both storage drivers treat it identically: it is re-encoded and stored the
same way, recorded on the media row from the **stored** file's size and
dimensions (so it is metered against the account's storage usage), and surfaced
as the attachment's `meta.small` and `preview_url`. For a video it replaces the
extracted frame — the frame is extracted either way, so it saves no work — while
without one a video keeps that frame and an image gets no thumbnail at all. A
supplied thumbnail is client input, so both drivers validate it the same way and
before anything is stored: unusable input is a 422 with nothing written, while a
storage fault keeps its own error and stays a logged 500. Whatever fails after
the first write reclaims what it stored, because a `medias` row is the only
handle anything has on a stored path and a file written without one is
unreachable.

**Presigned direct-to-S3** stores the bytes exactly as uploaded — original
format, no re-encode, no server-side dimension cap — because the browser PUTs
straight to the bucket. `uploadAttachment` (`lib/client.ts`) tries this first
and only falls back to the sync endpoint when the instance has no object
storage, so on an S3/object instance it is what the post composer _and_ the
Settings/Account avatar and header pickers actually use. The only cap there is
the browser-side canvas resize in `lib/utils/resizeImage.ts`, which a
non-browser API client never runs.

Images written by the server-side route before the cap became downscale-only
were enlarged on disk to fill the box. The `medias` row was not:
`original.metaData` and `original.bytes` are read from the uploaded file, so
they always described the source. An affected attachment therefore **serves a
file several times larger than the dimensions and byte count it advertises**,
and per-account storage usage under-counts it — a query for oversized rows will
not find these. Only thumbnails recorded the enlarged numbers
(`thumbnail.metaData`/`thumbnail.bytes`, surfaced as `meta.small`), so those
over-counted usage instead.

Nothing re-encodes existing media, so an instance's storage keeps both shapes
until the affected attachments are deleted.

**Multipart uploads bypass `proxy.ts`.** Next clones and buffers the body of
every non-GET/HEAD request the proxy runs on, so both the proxy and the route
handler can read it, and caps that buffer at
`experimental.proxyClientMaxBodySize` (10 MB by default). Past the cap Next only
logs a `Request body exceeded 10MB` warning (the number follows
`proxyClientMaxBodySize`) and hands the handler a **truncated** body, so a larger upload
fails to parse (each route reports that differently) or is stored incomplete.
The proxy's only work on an `/api/*` request is adding the CSP header, so its
`config.matcher` skips `/api/*` requests whose `Content-Type` is
`multipart/form-data` (case-insensitive), covering every multipart upload
without a per-route list. Raising `proxyClientMaxBodySize` was rejected: it
would have to track the runtime upload caps, which `next.config.ts` must not
read, and it buffers every in-flight upload in memory once more. Two paths are
always matched whatever `Content-Type` is sent: bare `/api` (the catch-all
excludes only `api/` followed by a segment), so it still gets the proxy's
404/405 instead of falling through to a page route, and `/api/v1/files/*`,
because the matcher ignores the method and a GET with a multipart header must
not produce a CSP-less, year-cacheable file response. `proxy.test.ts` checks
the matcher with Next's own config parser and runtime matcher. Do not fold the
`/api` entries back into the catch-all.

## Database Schema (Simplified)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   accounts   │────▶│    actors    │────▶│     statuses     │
│              │     │              │     │                  │
│ id           │     │ id           │     │ id               │
│ email        │     │ publicId     │     │ publicId         │
│ passwordHash │     │ accountId    │     │ actorId          │
│ createdAt    │     │ username     │     │ type (Note/Poll) │
└──────────────┘     │ domain       │     │ content          │
                     │ name         │     │ reply            │
                     │ settings     │     │ createdAt        │
                     │ publicKey    │     └────────┬─────────┘
                     │ privateKey   │              │
                     └──────────────┘              │
                            │                      │
                ┌───────────┼───────┐    ┌─────────┼────────┐
                ▼           ▼       ▼    ▼         ▼        ▼
         ┌──────────┐ ┌────────┐ ┌────────────┐ ┌───────┐ ┌──────────┐
         │ follows  │ │ likes  │ │attachments │ │ tags  │ │timelines │
         └──────────┘ └────────┘ └────────────┘ └───────┘ └──────────┘

Other tables: sessions, notifications, medias, fitness_files,
              fitness_settings, strava_archive_imports,
              wahoo_imports, wahoo_history_imports,
              fitness_route_heatmaps, fitness_route_heatmap_region_names,
              fitness_route_heatmap_pyramids, fitness_route_heatmap_tiles,
              fitness_file_routes, fitness_import_locks,
              fitness_gears, fitness_gear_components,
              fitness_gear_component_periods,
              collections, collection_members, collection_timeline,
              blocks, mutes, actor_domain_blocks, filters, reports,
              moderation_actions, server_filters, server_filter_keywords,
              markers, endorsements,
              lists, featured_tags, customEmojis, translation_cache,
              link_previews, status_link_previews, status_quotes,
              status_reactions, announcements, announcement_reads,
              announcement_reactions, instance_rules, suggestion_dismissals,
              domain federation rules, relays, federated_timeline,
              status_detected_languages, recipients, counters, poll_choices,
              server_settings, clients, tokens, auth_codes (Mastodon API OAuth),
              oauthClient, oauthAccessToken, oauthRefreshToken,
              oauthConsent (better-auth OAuth provider)
```

## Technology Stack

| Layer                | Technology                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime**          | Node.js 24                                                                                                                            |
| **Framework**        | Next.js 16 (App Router)                                                                                                               |
| **Language**         | TypeScript (strict mode)                                                                                                              |
| **UI Library**       | React 19                                                                                                                              |
| **Styling**          | Tailwind CSS                                                                                                                          |
| **UI Components**    | Radix UI primitives                                                                                                                   |
| **Database**         | Knex.js (SQLite / PostgreSQL; MySQL-compatible config paths)                                                                          |
| **Authentication**   | better-auth                                                                                                                           |
| **Logging**          | Pino                                                                                                                                  |
| **Testing**          | Vitest (native ESM)                                                                                                                   |
| **Code Quality**     | Oxlint + Prettier                                                                                                                     |
| **Package Manager**  | Yarn 4 Workspaces (exact version pinned via `packageManager` in `package.json`; optional dependencies modularized under `packages/*`) |
| **Containerization** | Docker (Alpine-based minimal base image; optional workspaces focused via build args)                                                  |
| **Observability**    | OpenTelemetry (optional)                                                                                                              |

---

## Contributor rules

Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Server/Client Module Boundary](#agents-server-client-module-boundary)
- [Instance Limits in Client Components](#agents-instance-limits-in-client-components)
- [Date Serialization in Server Components](#agents-date-serialization-in-server-components)
- [Client-Side API Calls](#agents-client-side-api-calls)
- [Outbound Server-Side HTTP Requests](#agents-outbound-server-side-http-requests)
- [Link prefetching in feeds](#agents-link-prefetching-in-feeds)
- [Navigation Customization](#agents-navigation-customization)
- [Page Header & Sub-Navigation](#agents-page-header-sub-navigation)
- [Fitness Overview Calendar](#agents-fitness-overview-calendar)
- [Settings Forms (Client Components)](#agents-settings-forms-client-components)
- [Transactional & Notification Emails](#agents-transactional-notification-emails)
- [Link Preview Cards](#agents-link-preview-cards)
- [Status Delete & Unboost Federation](#agents-status-delete-unboost-federation)
- [Actor Profile & Deletion Federation](#agents-actor-profile-deletion-federation)
- [Better-auth Plugin Guidelines](#agents-better-auth-plugin-guidelines)
- [Better-auth Database Joins](#agents-better-auth-database-joins)
- [Better-auth Session Refresh](#agents-better-auth-session-refresh)
- [OAuth Client Registrations](#agents-oauth-client-registrations)
- [OAuth Access Token Sliding Expiry](#agents-oauth-access-token-sliding-expiry)
- [Auth Error Page](#agents-auth-error-page)
- [OAuth Grants Must Resolve an Actor](#agents-oauth-grants-must-resolve-an-actor)
- [An Unconfirmed Account May Not Act](#agents-an-unconfirmed-account-may-not-act)
- [Review: Runtime vs. build-time configuration](#review-runtime-vs-build-time-configuration)
- [Review: Client components & data flow](#review-client-components-data-flow)
- [Review: Page chrome, layout & accessibility](#review-page-chrome-layout-accessibility)
- [Review: Logging](#review-logging)
- [Review: Auth error page](#review-auth-error-page)
- [Review: Better-auth session refresh](#review-better-auth-session-refresh)
- [Review: OAuth access token sliding expiry](#review-oauth-access-token-sliding-expiry)
- [Review: Unconfirmed accounts & app tokens](#review-unconfirmed-accounts-app-tokens)
- [Review: Emails](#review-emails)
- [Review: Post media layout](#review-post-media-layout)
- [Review: Status delete & unboost federation](#review-status-delete-unboost-federation)
- [Review: Link preview cards](#review-link-preview-cards)

<a id="agents-server-client-module-boundary"></a>

### Server/Client Module Boundary

- **Server-only code must never import a runtime value from a `'use client'` module.** Under the App Router such a module resolves to a _client reference_ on the server: components still render, but a plain value read out of it (a constant object, a lookup table) is empty. Types are erased, so `import type` is fine, and a Server Component rendering a Client Component is the normal composition pattern — this is specifically about reading values.
- The failure is invisible to the test suite: Vitest has no RSC boundary, so the import returns the real module there and tests pass while production silently gets nothing. It cost a complete outage of poll creation — `app/api/v1/accounts/outbox/types.ts` validated `durationInSeconds` against `SecondsToDurationText` exported from the `'use client'` poll editor, `Object.keys(...)` came back empty, and every poll was rejected with a 400 that no test could see.
- `lib/clientModuleBoundary.test.ts` enforces this across `app/api/`, `lib/services/`, `lib/actions/`, `lib/jobs/`, `lib/database/`, and `lib/config/`. When both sides need a constant, put it in a dependency-free module both can import — `lib/services/statuses/pollDurations.ts` and `lib/services/mastodon/constants.ts` are the existing examples — not in the component that happens to render it.

<a id="agents-instance-limits-in-client-components"></a>

### Instance Limits in Client Components

- **Client authoring UI must size itself to the admin-configured server settings, never to a hardcoded constant.** Read them from `useInstanceLimits()` (`@/lib/components/instance-limits`), which the `(timeline)` layout publishes once from `getResolvedServerSettings()`. Current consumers: the composer's character counter and the inline reply box (`posts.maxCharacters`), the poll editor (`polls.*`), the composer's media picker and the avatar/header picker (`media.maxFileSize`), and the media picker's attachment count — both the composer and the inline reply box — plus the `addAttachment` reducer guard behind it (`posts.maxMediaAttachments`).
- Add a field to `InstanceLimits` and publish it from the layout rather than threading a prop: the composer renders inline under posts across the whole route group, so prop-threading touches ~30 files. Keep the context to values the browser genuinely needs; it is not a mirror of `ResolvedServerSettings`.
- **Do not import `lib/config/serverSettings` into a Client Component** for its value exports — it carries `process.env`-reading closures. Defaults belong in a dependency-free module (see **Server/Client Module Boundary**).
- The context is UX only. Every limit is enforced server-side too (`validateStatusContentLimits` on the status create/edit routes, `exceedsMaxMediaUploadSize` on every upload path); a client that is out of date can only be optimistic, never permissive. `posts.maxMediaAttachments` is the exception: **no** route enforces the resolved value. All three create/edit paths — `POST`/`PUT /api/v1/statuses[/:id]` and `POST /api/v1/accounts/outbox`, the route both the composer and the inline reply box actually post through — fall back to the fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling instead, answering `422` above it, so on that field a stale or missing provider lets media through up to the ceiling rather than up to the configured number. See **Database-backed server settings** in `docs/environment-variables.md` for the full explanation. When a new surface can author or upload, put it under the provider and read the limit from it.

<a id="agents-date-serialization-in-server-components"></a>

### Date Serialization in Server Components

- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** `Date` objects are not safely serializable across the server/client boundary and can cause hydration mismatches.
- Always pass timestamps as `number` (e.g. `Date.now()`) from Server Components.
- Client Components should accept `currentTime: number` and construct `new Date(currentTime)` internally before use.
- This pattern is already used throughout the codebase (e.g. `HashtagTimeline` accepts `currentTime: number` and forwards the number unchanged to `<Posts>`, which also takes `currentTime: number`; only leaf components construct `Date` objects from it).

<a id="agents-client-side-api-calls"></a>

### Client-Side API Calls

- **Never call `fetch()` directly inside React components.** All API calls from client components must go through `lib/client.ts` (or domain modules in `lib/client/*`).
- Add a named, exported function in the appropriate domain module under `lib/client/<domain>.ts` (e.g. `lib/client/accounts.ts`, `lib/client/statuses.ts`, `lib/client/fitnessFiles.ts`) and re-export it from `lib/client.ts`. The function should encapsulate the `fetch` call, method, headers, body serialization, and return a typed result.
- Import those functions in components: `import { myApiCall } from '@/lib/client'`.
- `lib/client.ts` is an API facade that re-exports functions across all domain modules in `lib/client/`. This keeps domain logic cleanly partitioned while preserving a unified import boundary for components.

<a id="agents-outbound-server-side-http-requests"></a>

### Outbound Server-Side HTTP Requests

- **Server-side outbound JSON and text HTTP requests MUST go through `safeRemoteFetch` (`@/lib/utils/safeRemoteFetch`).** Binary downloads use the guarded helper below.
- Never call raw `fetch()` directly in server-side services or utilities.
- `safeRemoteFetch` is backed by `got` and applies standard SSRF protection (requiring HTTPS, blocking private IP ranges such as loopback and RFC 1918 subnets), streaming response-size limits, timeout bounds, DNS pinning, and redirect handling.
- A fetch whose response is trusted because of the host it came from — an ActivityPub object fetched to authenticate it (`getNote`, the forwarded-Delete confirmation, a `QuoteAuthorization` stamp) — passes `allowCrossHostRedirects: false`, so an open redirect on that host cannot hand the answer to another one. See [A Fetched Document's Own `id` Is Not Evidence](mastodon-api-compatibility.md#agents-a-fetched-document-s-own-id-is-not-evidence).
- Binary FIT and image downloads use `safeImageFetch` with `readResponseArrayBufferWithLimit` because the text response of `safeRemoteFetch` would corrupt those bytes. The binary helper checks each redirect and destination address; callers apply an overall timeout and byte cap and do not forward provider bearer tokens to file hosts.
- Web Push delivery (`web-push`) is the one outbound POST to a URL a client chose. The subscribe routes refuse any endpoint `isAllowedPushEndpoint` rejects (`lib/services/notifications/pushEndpoint.ts`: HTTPS, no credentials, no local names, public addresses only), delivery skips a stored endpoint `isDeliverablePushEndpoint` rejects and connects through `pushDeliveryAgent`, whose lookup refuses a restricted address at connect time (so a rebound record is caught), with a per-request timeout. `createPushSubscription` keeps at most `MAX_PUSH_SUBSCRIPTIONS_PER_ACTOR` per actor (oldest dropped), which bounds the per-notification fan-out.
- External cloud integrations (e.g. translation providers like DeepL, OpenAI, or Gemini, and alt-text vision generation) must target public HTTPS endpoints. Internal or self-hosted HTTP services running on private IP addresses are not supported.

#### Inbound request bodies on unauthenticated routes

- **An unauthenticated route (public webhook, client registration, anything that parses before the auth check) must not call `req.json()` / `req.text()` / `req.formData()` directly** — each buffers the whole body first. Read it through `@/lib/utils/boundedRequestBody` (`readRequestTextWithLimit`, `readRequestBodyWithLimit`, cap `SMALL_REQUEST_BODY_MAX_BYTES` = 64 KiB) or pass `{ maxBytes }` to `getRequestBody`. The cap is checked against a declared `content-length` before reading and again on the stream (the header can be absent or false), and an over-cap body answers 413 (`isRequestBodyTooLargeError`). Do not clone the request to peek at its body with these helpers: they `await` the stream's cancellation, and cancelling one `tee()` branch never settles until the other is read, so on a clone the over-cap read hangs instead of answering 413. The one deliberate exception is `ActivityPubVerifyGuard`'s `readBoundedBody`, which reads a clone (the handler still needs the original body) and stops at the cap WITHOUT awaiting `reader.cancel()` — stopping the reads is what bounds the work there.
- A body-parsing `addAttributes` callback on `traceApiRoute` runs **before** the handler and so before an auth guard; set span attributes inside the guarded handler (`trace.getActiveSpan()`) instead.
- Next's `proxy.ts` body clone (default 10 MB) is a backstop, not a limit to rely on.

<a id="agents-link-prefetching-in-feeds"></a>

### Link prefetching in feeds

- **A `<Link>` rendered once per row of a feed or list MUST pass `prefetch={false}`.** Next's App Router `<Link>` defaults to prefetching every link that enters the viewport, and this app's feeds are infinite-scroll, so a repeated link is not one request — it is one request per row, fired continuously as the user scrolls. This is the bug that flooded production: `Posts` renders two author links per post (the avatar and the display name), so scrolling the home timeline issued a stream of `GET /@user@domain?_rsc=…` prefetches.
- The cost is not just a page render. Every one of those targets is a fully dynamic route — `/@user@domain` runs a session lookup plus six actor queries — and for a remote actor this instance has not persisted yet, `getProfileData` additionally performs a **WebFinger lookup and a signed actor fetch against the remote server**. Viewport prefetching therefore turns idle scrolling into outbound federation traffic aimed at other people's instances.
- There is no global switch: Next 16's `prefetch` prop (`boolean | 'auto' | null`) is per-`Link` and has no `next.config.ts` counterpart, so the opt-out is written at each call site. `prefetch={false}` disables prefetching on **both** viewport entry and hover — accept the hover loss. Without a prefetch the router has nothing to show until the server answers, so a profile click used to leave the old page frozen for the whole round trip; `PendingProfileNavigationProvider` (`app/(timeline)/PendingProfileNavigation.tsx`, mounted by the `(timeline)` layout) covers that gap instead: it watches same-tab clicks on links to `/@user@domain` and paints the `[actor]` route's own `ProfileLoading` skeleton over the content column (`PendingProfileOverlay`, in the signed-in `<main>` and in `PublicShell`) until the pathname changes, when the route's `loading.tsx` takes over. It is an overlay, not a swap, so the page underneath keeps the height and scroll position the browser records for Back. New profile links get this for free; do not re-enable prefetching on them to make profiles feel instant.
- Current opt-outs: the shared post author links (`lib/components/posts/actor.tsx`), the booster link on the boosted-by line (`BoostStatus` in `lib/components/posts/post.tsx`), quote card links (`QuoteCard` in `lib/components/posts/quote-card.tsx`), notification rows (`NotificationItem`, `StatusNotification`, `ActivityImportNotification`), follower/following rows (`FollowList`), search account and hashtag rows, the likes list and chips (`StatusLikes`), collection member rows, and trending hashtag rows. Regression-tested in `lib/components/posts/actor.test.tsx`, `lib/components/posts/boost-status.test.tsx`, and `lib/components/posts/quote-card.test.tsx`, which mock `next/link` because the real one does not reflect `prefetch` into the DOM.
- Navigation **chrome** keeps prefetching and should: the sidebar, mobile navigation drawer, section sub-nav, pagination, and one-off page links render a bounded handful of links, so prefetch is a straight latency win there. The rule is about links whose count scales with the number of rows on screen. **The one exception inside chrome** is the user profile link in the sidebar and mobile drawer (`lib/components/layout/sidebar.tsx` and `ActorSwitcher`): unlike registry nav items, Profile's href is the viewer's own per-user `/@user@domain` — the same fully-dynamic `[actor]` route the post-author links above opt out of (a per-user session lookup plus six actor queries on every render) — so it carries `prefetch={false}` while the registry items and the overflow (More) menu links around it keep default prefetching. Regression-tested in `lib/components/actor-switcher/ActorSwitcher.test.tsx`, which mocks `next/link` the same way. The same holds for a `BackLink` whose target is a profile — the signed-in followers/following Back and the post page's direct-entry Back — which pass `prefetch={false}`.

<a id="agents-navigation-customization"></a>

### Navigation Customization

- **The nav item registry is the single source of truth, and adding an item is two lines.** Its id goes in `NAV_ITEM_IDS` (`lib/services/navigation/navPreferences.ts`) and its presentation — icon, label, `shortLabel`, `blurb` — goes in `NAV_ITEM_DEFINITIONS` (`lib/components/layout/nav-items.ts`). Every surface derives from those: the full sidebar, the collapsed rail, the mobile navigation drawer and its More group, and the Settings → Navigation manager. Never hardcode a nav list in a component.
- **`lib/services/navigation/navPreferences.ts` must stay dependency-free** — no React, no lucide, no env. Both sides import it: the `'use client'` surfaces render from it, and `app/api/v1/accounts/navigation-preferences/route.ts` validates writes against it. It owns which ids are pinned (`LOCKED_NAV_IDS`), which belong to an optional instance feature (`NAV_FEATURE_BY_ID`), and the order/split/move algebra. See **Server/Client Module Boundary**.
- **Every nav surface reads `useNavPreferences()`; none of them keeps its own copy.** `NavPreferencesProvider` is rendered once by the `(timeline)` layout, seeded from `getActorSettings`, and wraps the nav chrome **and** `{children}` — the settings manager edits the very sidebar rendered beside it on wide viewports, and a soft navigation never re-runs the layout to re-seed two separate stores.
- **Saves carry the whole preference, not a delta**, so concurrent edits resolve to last-write-wins; the store keeps one request in flight with a single trailing save, and a drag persists once on drop rather than once per row it crosses. Dedupe is keyed on the **payload** (what goes over the wire), not on what the navigation looks like: Reset deliberately stores empty lists — that is what keeps the account following the shipped navigation as it changes — and keying on the visible state made Reset a no-op whenever the visible order already matched the defaults.
- **Two reorder semantics, and the difference is deliberate.** The sidebar's `⋯` menu swaps with the nearest _visible_ neighbour (`moveNavItem`), because hidden items are not on screen there to move past. The settings manager lists hidden rows inline, so all three of its reorder paths — dragging a row, the grip's arrow keys, and the per-row Move up/down buttons — splice within the displayed list (`moveNavItemTo`). The keyboard and the buttons share `moveRow`, which is also what reports the move (and the ends of the list) to a screen reader; a drag calls `moveTo` per row crossed and `commit` on drop, because it is the pointer that reports it. Whatever a surface offers via drag it must also offer via the keyboard, and the buttons are what make it work on a touch device, where a pointer that cannot hover cannot drag and there is no keyboard either.
- **A hidden item is tucked away, never taken away**: it stays reachable under More on every surface, `LOCKED_NAV_IDS` can never be hidden (the server strips them from `navHidden` as well, so a hand-edited preference cannot strand someone), and an item that is unavailable — admin for a non-admin, or a feature the instance turned off — keeps its slot in the stored order so re-enabling restores the account's layout.
- **Instance feature switches (`features.*` server settings) only remove items from navigation.** They do not gate routes, APIs, or the composer: an existing link keeps working. If that ever changes, it is a separate, deliberate decision — do not add a `notFound()` guard as a side effect of a nav change.

<a id="agents-page-header-sub-navigation"></a>

### Page Header & Sub-Navigation

The **design system is the source of truth** for page chrome. There are two
section-navigation patterns; pick by section type.

- Use `PageHeader` from `@/lib/components/page-header` for every page title in the `(timeline)` route group. From `md` (768px) up it renders the sticky, full-width chrome (translucent background + backdrop blur + bottom border) and centers the title above the content column. Below `md`, under a mobile navigation provider, it renders the mobile compact bar instead and its own box becomes plain content (see **Mobile chrome** below). Pages always call `<PageHeader title="…" description="…" actions={…} />`; they don't need to know which sub-nav pattern (if any) wraps them. Five optional props exist for the mobile split:
  - `back={{ href, accessibleName, label?, prefetch? }}` — a parent-route Back. Never put a back arrow inside `title`: below `md` it is a row at the top of the content reading "Back" (or "Back to profile" — pass `...profileBack(name)` from `lib/components/navigation-history/backDestination.ts` when it returns to a profile), from `md` up it is the same icon beside the title it always was (rendered by `BackLink`, outside the `h1`). `accessibleName` names the destination ("Back to lists") — see **Mobile chrome**.
  - `compactTitle` — a short section title for the mobile bar when the content keeps a more specific heading (the list timeline's bar says "Lists" over the list's name; a collection's says "Collection"). Without it the bar's title is the page's `h1` below `md` and the box's `h1` is `max-md:hidden`, so exactly one `h1` is displayed at any width.
  - `banner` — content shown above the header on desktop and directly below the mobile bar (the home timeline's `AnnouncementBanner`), so DOM order equals visual order at every width.
  - `flushOnMobile` — below `md` the content directly below meets the header's bottom edge instead of the parent's `space-y-*` rhythm: signed in, the compact bar's hairline when the box has nothing to show there (the bar keeps `mb-0`), else the box; logged out, the sticky box (`max-md:mb-0`). For a full-bleed surface that must not show a band above it (the home timeline's composer, see **Home timeline boundaries** below). The geometry lives in `PageHeader`; callers never pull themselves up with a negative margin.
  - `actionsInMobileBar` — signed in, below `md` `actions` render at the end of the compact bar instead of in the content row, whose copy is `max-md:hidden` (the home timeline's Refresh, which sits beside the title as it did before the redesign). Every other page keeps its actions in the content, where they scroll away; do not opt a page in without a design decision.
  - None of the five is rendered in section mode (under `PageHeaderSectionProvider`): the section layout owns the bar, so a section detail page renders its own `BackLink` above its section-mode heading (the admin account, report and hashtag pages).
- **Unified desktop content width.** Every top-level page in the `(timeline)` group shares **one** content width on desktop so the column stays aligned as you switch tabs. The `(timeline)` layout wrapper centers content at `max-w-content` (a single `--container-content: 940px` token defined in `app/globals.css`'s `@theme`), and `PageHeader` centers its title row at the same `max-w-content`. There is **no** per-page width tier any more: do **not** reintroduce the old two-tier `max-w-2xl` (timeline) / `max-w-4xl` (sections) split, a `contentWidth` prop on `PageHeader`, or the `data-layout-width="wide"` opt-in CSS rule. Section layouts (settings, fitness, admin) and Messages all inherit the unified `max-w-content` from the wrapper — they don't set their own width.
- **Page skeleton alignment (`loading.tsx`).** Route loading skeletons for logged-in pages in `(timeline)` must align with the rendered page so that transition causes no visual jumping of either the header or the content box below it:
  - **Reuse `PageHeader` directly on top-level timeline pages.** Never hand-roll a sticky header div or breakout style. Rendering `<PageHeader>` from `@/lib/components/page-header` ensures sticky breakout styling, padding (`px-4 py-4`), bottom border, and total header height (79px from `md` up, also for a header with actions and no description: the title row then takes a `md:min-h-[46px]` floor, the 28px title plus the 2px and 16px description it would have had, as on the home timeline's Refresh; a title-only header keeps its own height; below `md` the 56px compact bar plus the content row) match the loaded page pixel-for-pixel.
  - **Mirror font and action metrics.** Pass `title={<span className="skeleton block h-7 w-… rounded-md" />}` to match `h1 text-xl` (28px line height = `h-7`), `description={<span className="skeleton block h-4 w-… rounded" />}` to match `mt-0.5 text-xs text-muted-foreground` (16px line height = `h-4`), and action button skeletons in `actions={…}` (e.g. `size-9` for standard icon buttons, `h-8 w-18` for small buttons). `PageHeader` centers actions vertically via `.shrink-0.self-center`; hand-rolled headers default to top-aligned (`items-start`), which makes action buttons jump down 7px when the page hydrates.
  - **Prevent layout shift below the header.** Layouts apply vertical spacing between the sticky header and page content (`space-y-6` on timeline/favorites, `gap-5 md:gap-6` on messages). Any discrepancy in header height (such as 75px vs 79px) causes the entire content box below the header to jump vertically when data loads.
  - **Home timeline boundaries.** On `(home)` below `md` (768px), the sticky compact bar (menu button, "Timeline", and Refresh at its end via `actionsInMobileBar`) carries the whole header — the page has no description, so the header's content box is empty and hidden there — and `PageHeader`'s `flushOnMobile` prop lets the composer meet the bar's hairline with no white band (an `AnnouncementBanner`, when shown, sits directly under the bar and keeps the stack's 24px above the composer). The composer meets the feed through one full-viewport-width, 1px `border`-token divider. Keep the outer timeline stack's spacing for announcement-to-composer and feed-to-pagination boundaries, and mirror the same geometry in `(home)/loading.tsx` so loading, empty, refresh, and populated states do not jump. At `md` and above, keep the separate rounded, shadowed composer and feed cards with their 24px gaps in the centered `max-w-content` column. Do not wrap the header in a narrower containing block or change the shared `MOBILE_FEED_SURFACE_CLASS`; this is home-boundary spacing only.
  - **Mobile timeline pagination spacing (`LoadMoreButton`) and Scroll to top button (`ScrollToTopButton`).** On the mobile home timeline below `md`, pagination renders as a visual overlay pill centered over the lower area of the final rendered timeline card (`presentation="overlay"`), removing the large blank pagination band beneath the feed. The `IntersectionObserver` target is separated into a compact, non-zero-sized sentinel (`h-px`) in normal document flow at the feed end, avoiding large wrapper spacing while keeping auto-pagination and post actions fully interactive. For other timeline and list pages, `LoadMoreButton` retains standard in-flow pagination with container safe-area spacing (`max-md:pt-6 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]` and `py-4` on desktop). In parallel, `ScrollToTopButton` uses fixed positioning with `bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]` to preserve safe-area clearance above the home indicator while maintaining approximately 12–16 CSS pixels of visible clearance above Safari's collapsed bottom address bar without floating excessively high over post content. Additionally, `PageHeader` supports an optional overlay slot (`bottomSlot`) positioned below its sticky container at `top: 100%` plus ~8 CSS pixels clearance (with `pointer-events-none` container) for sticky controls such as the new-post count pill without causing layout shift in the feed below. Below `md` the slot hangs under the sticky mobile compact bar instead (the desktop overlay is `max-md:hidden`), so the pill stays reachable while the feed scrolls.
  - **Mirror panel item layout in content skeletons.** Skeletons should match the vertical rhythm of the real components: e.g. in direct messages, mirror the 3-line conversation card (title, preview, timestamp) without combining `divide-y` on containers with per-item `border-b` (which creates double borders), and use `size-9` for `Button size="icon"` and `h-9` for default buttons.
  - **Page inventory & skeleton rules across routes:**
    - **Top-level standalone timeline routes (MUST use sticky `PageHeader` in skeleton):**
      - `(home)` (`app/(timeline)/(home)/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7` and action `size-9`, and no description (the home header has none; see **Home timeline boundaries**).
      - `favorites` (`app/(timeline)/favorites/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `messages` (`app/(timeline)/messages/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`, and action `h-8 w-18`.
      - `search` (`app/(timeline)/search/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `[actor]/followers` & `[actor]/following` (`app/(timeline)/[actor]/FollowListLoadingSkeleton.tsx`): Both routes render `PageHeader` when signed in. Hand-rolled sticky headers here (e.g. 75px with `h-6` title and `space-y-1`) violate the rule and cause a 4px jump; they must reuse `PageHeader` directly. Signed in, below `md` the skeleton mirrors the loaded page: `compactTitle` gives the bar the plain "Followers"/"Following" title (a skeleton there renders as an arrow and a bar), the `PageHeader` box is `max-md:hidden` and a `md:hidden` block stands in for it (`pt-2`, the 44px "Back to profile" row, then a 20px `h-5` count flush under it, matching the loaded description's `text-sm` line). The logged-out header (`group-data-[shell=public]/shell:` variants) is the icon Back beside the title and count at every width, as `FollowListPage` renders it there.
      - `bookmarks` (`app/(timeline)/bookmarks/page.tsx`), `explore` (`app/(timeline)/explore/page.tsx`), `lists` & `lists/[id]` (`app/(timeline)/lists/page.tsx`), `collections/[id]` (`app/(timeline)/collections/[id]/page.tsx`, signed in; logged out it is plain text, see **Logged-out pages**): All render top-level `PageHeader`s (some with action buttons like `Button size="sm"` -> `h-8`). Note that `/lists` serves as the unified index for both lists and collections. When adding `loading.tsx` skeletons for these routes, always reuse `PageHeader` with matching `h-7` title, `h-4` description, and `actions` skeletons.
      - `notifications` (`app/(timeline)/notifications/page.tsx`): Renders `PageHeader` with `PageSubnavProvider` for sticky filter tabs (`All`, `Mentions`). Skeletons must include both the `PageHeader` and subnav tab placeholder inside the sticky header container to prevent tab strip jumps.
    - **Section-mode routes (`settings`, `fitness`, `admin`, `account`):**
      - The outer layout (`app/(timeline)/<section>/layout.tsx`) renders the sticky `PageHeader` _outside_ `PageHeaderSectionProvider`, while `SectionNavDropdown` and children render _inside_ it.
      - Child pages inside these sections render their own `PageHeader` in **section mode** (plain in-panel title block `mb-6 text-xl`, not sticky, not breakout).
      - Child route skeletons inside these sections must **NEVER** render a sticky breakout `PageHeader`, as that duplicates the sticky header already rendered by `layout.tsx`. If a child route skeleton has a header, it must render an in-panel section title skeleton.
    - **Non-header pages (`[actor]/[status]`, `[actor]` profile):**
      - Detail pages (`[actor]/[status]/loading.tsx`) and profile pages (`[actor]/loading.tsx`) do not render a top-level `PageHeader` and have bespoke layout structures (post permalink card with back navigation, or profile banner/avatar grid). Skeletons for these pages mirror their respective card or profile geometry instead of `PageHeader`. Below `md` the status page renders `MobileCompactHeader` itself ("Post"/"Activity"), and the profile renders the floating menu button with its cover flush to the top; their skeletons mirror that. The status skeleton is the full-bleed surface signed in and, logged out below `md`, an inset card one `py-6` gap under the top bar (see **Logged-out pages**).
    - **Hashtag page (`tags/[tag]`, `HashtagTimeline`):** signed in, it renders `PageHeader` (title `#tag`, description the post count) so from `md` up it has the standard sticky 79px chrome, the title at 16px from the top and the content 24px below, like Bookmarks or Favorites; it has no `loading.tsx`. Below `md` the page must keep its phone layout (compact bar "#tag", then the plain count 24px under it), so the box takes `className="max-md:hidden"` and the count is a separate `md:hidden` line; `PageHeader`'s own mobile box (16px padding, in the 24px stack) would move it. Logged out there is no mobile navigation provider, so `PageHeader` would be sticky chrome at every width inside `PublicShell`'s narrow column: that branch keeps the inline icon-and-title block, one `py-6` gap under the public top bar at every width.

#### Dropdown sub-nav (settings-style sections — the design-system default)

- Settings-style sections (settings, fitness, admin) use a **dropdown sub-navigation on every breakpoint, including desktop** — there is **no vertical nav rail**. The earlier desktop "vertical icon rail" is gone: do **not** reintroduce a `lg:block` rail beside the content. The same dropdown that tablet/mobile used now drives desktop too, so the content always gets the full width.
- **Reuse the shared `SectionNavDropdown` component** from `@/lib/components/section-nav-dropdown` — do **not** re-inline the dropdown markup in each layout. Pass it a `label` (the `<nav>` accessible name) and a `tabs: SectionNavTab[]` array (`{ name, url, icon }`). It owns the active-tab resolution and renders the trigger + menu described below; `app/(timeline)/settings/layout.tsx`, `app/(timeline)/fitness/layout.tsx`, and `app/(timeline)/admin/layout.tsx` all consume it.
- Under the hood, `SectionNavDropdown` renders a single `<nav aria-label="…">` wrapping a Radix `DropdownMenu`. The trigger is an outline `Button` showing the active tab's Lucide icon (`text-primary`) + **sentence-case** label ("Blocked accounts", not "Blocked Accounts") + a `ChevronDown`; it is `w-full` on mobile and a contained `sm:w-64` from `sm` up. Each menu item is a `<Link>` (with `aria-current="page"` on the active one) inside a `DropdownMenuItem`, and `DropdownMenuContent` uses `align="start"` + `w-(--radix-dropdown-menu-trigger-width)` so the menu lines up with and matches the trigger width.
- The section layout renders **two tiers of header**, matching the design system:
  1. A **shared section header** at the very top (e.g. `Settings` / "Manage your account and preferences") that uses the same full-width sticky chrome as the other top-level routes, so the section reads like every other page. Render a `PageHeader` **outside** `PageHeaderSectionProvider` so it keeps the sticky breakout chrome; like every other route its centered title row aligns to the unified `max-w-content` column.
  2. The **per-page title** ("General", "Account Settings", …) below it, rendered by each page's own `<PageHeader>` in **section mode**.
- Wrap the dropdown + content in `PageHeaderSectionProvider` from `@/lib/components/page-header`. That switches every descendant `PageHeader` into **section mode**: a plain, non-sticky, non-breakout in-panel title block that sits at the top of the content column. Render the dropdown directly in the layout (do **not** use `PageSubnavProvider` here). The wrapper is a plain `w-full` div — it inherits the unified `max-w-content` from the `(timeline)` layout, so it needs no width class of its own.

  ```tsx
  // app/(timeline)/<section>/layout.tsx
  'use client'
  import {
    PageHeader,
    PageHeaderSectionProvider
  } from '@/lib/components/page-header'
  import {
    SectionNavDropdown,
    type SectionNavTab
  } from '@/lib/components/section-nav-dropdown'

  const tabs: SectionNavTab[] = [
    { name: 'General', url: '/settings', icon: SettingsIcon }
    // …
  ]

  export default function Layout({ children }) {
    return (
      <>
        {/* Shared section header — sticky chrome, outside the section provider. */}
        <PageHeader
          title="Settings"
          description="Manage your account and preferences"
        />
        <PageHeaderSectionProvider>
          {/* Plain wrapper — inherits the unified max-w-content from the
              (timeline) layout, so no width class of its own. */}
          <div className="w-full pt-4">
            {/* Dropdown sub-nav on every breakpoint — no vertical rail. */}
            <SectionNavDropdown label="Settings" tabs={tabs} />
            <div className="min-w-0">{children}</div>
          </div>
        </PageHeaderSectionProvider>
      </>
    )
  }
  ```

- A **nested sub-nav that navigates** — one whose entries are other routes inside the section — renders as a small **in-content segmented control**, not a second dropdown or rail. Hand it to the closest section-mode `PageHeader` via `PageSubnavProvider` so it sits directly **below the per-page title** (header-first, like the non-nested pages) rather than above it. (The settings, fitness, and admin layouts themselves use the dropdown sub-nav above, not this nested pattern.)
- A nested sub-nav that switches a **view of the page you are already on** is a dropdown instead — the shared `SectionNavSelect` (`@/lib/components/section-nav-select`), described below. That is the design system's own call rather than a carve-out invented here: `ui_kits/web/GearKit.jsx` puts a `GKViewDropdown` on a gear's page below the stat tiles it re-renders, with the section's own "Gear ▾" dropdown still above it, and the fitness activity detail switches its Overview / Analysis / Comments sections the same way. The distinction is what the control does, not where it sits: a segmented control reads as "more of this page", which is wrong for something that replaces the page's whole body, and it carries no per-entry icon, which both of these designs do.

#### Section sub-nav in local state (`SectionNavSelect`)

- **`SectionNavSelect` is the state-driven twin of `SectionNavDropdown`**, and there is one implementation of each — do not re-inline either. Both render the same chrome: an outline trigger carrying the active tab's Lucide icon in `text-primary`, a sentence-case label and a muted `ChevronDown`, over a `rounded-xl` menu sized with `w-(--radix-dropdown-menu-trigger-width)`. They differ only in what a row does. `SectionNavDropdown`'s rows are `<Link>`s, its active row is resolved from `usePathname()` and marked `aria-current="page"`; `SectionNavSelect` takes `{ tabs, active, onChange }`, its rows are `DropdownMenuItem`s calling `onChange`, and the current one is marked with the **boolean** `aria-current` — nothing here is a page.
- Its two consumers are the fitness activity detail (Overview / Analysis / Heart rate zones / …) and a bike's gear page (Components / Activities). A third copy of that markup is exactly what extracting it removed.
- **Both** active rows take `text-primary-text`, not `text-primary` — see the orange-text rule under **Fitness Gear**. That is the one place the pairing is load-bearing rather than cosmetic: the two dropdowns now appear on one screen (a bike's page carries the fitness section's nav above its own view switcher), so a mismatch reads as a mistake, and `--primary` as a foreground is under the AA floor either way. Each keeps its wash on `focus:` and therefore also carries `focus:ring-2`, or a keyboard user watching the highlight move down the list would see it vanish on precisely the current row.

#### Sticky-header sub-nav (`PageSubnavProvider`)

- `PageSubnavProvider` remains available for sections that need horizontal tabs **inside** the sticky header: wrap the layout's `{children}` in it and pass the rendered tabs as `subnav`. The closest `PageHeader` renders the tabs directly under the title row, inside the sticky chrome. Do **not** render the sub-nav directly in the layout JSX above the header. No settings-style section layout uses this any more (admin moved to the dropdown sub-nav above to match the design system), but the top-level Notifications page (`app/(timeline)/notifications/page.tsx`) uses it for its sticky-header filter tabs (sticky from `md` up; below `md` they sit in the content row under the compact bar and scroll with the page), and the primitive also backs the nested in-content segmented-control pattern.

  ```tsx
  import { PageSubnavProvider } from '@/lib/components/page-header'

  // const subnav = (/* tabs strip — desktop tabs + mobile dropdown */)
  // return <PageSubnavProvider subnav={subnav}>{children}</PageSubnavProvider>
  ```

#### Mobile chrome (below `md`)

- **One drawer, one trigger component.** `MobileNavigationProvider` owns the drawer's open state and wraps its children in the Radix Dialog root; `MobileNavigationTrigger` is the only button that opens it, in two looks: `bar` (start of the compact bar) and `floating` (the profile's round button). Both are `DialogTrigger`s under the same provider, so they open the same drawer and focus returns to whichever opened it. Render exactly one trigger per screen. The drawer shell (`MobileNavigationDrawer`: overlay, `min(320px, 100vw - 48px)` panel, close button, Escape/outside-tap close, no focus return after a navigation or a resize to `md`) belongs to the signed-in `MobileNav`, which renders `Sidebar variant="drawer"`, so registry order, More, account switching and gating stay in one place. The provider is mounted only by the signed-in `(timeline)` layout; every piece of this chrome renders nothing without it (see **Logged-out pages** below).
- **Counts live in the drawer, never on the menu button.** The trigger's accessible name is always "Open navigation"; the unread count shows on the drawer's Notifications row.
- **Compact bar (`MobileCompactHeader`).** A 56px sticky row (a 55px content box plus its 1px bottom border, so the top safe-area inset is added on top), `bg-surface-chrome`, bottom border: the menu button and one truncating title (the full string stays in `title`). The bar's `pl-2` and the trigger's own 44px hit area, with no negative margin, put the 20px icon at x=20 and the title (`text-lg font-semibold`; this repo's `text-lg` is the design's 18/24, see `--text-lg--line-height` in `app/globals.css`) at x=60. No logo, subtitle, breadcrumb, badge or Back. The one exception is the `actions` slot after the title, used only by the home timeline's Refresh (`PageHeader`'s `actionsInMobileBar`); the bar's `pr-4` puts that 36px button on the 16px content gutter. `PageHeader` renders it for every top-level page; pages without a `PageHeader` render it themselves (status, the redirect card). Section layouts' bars carry the section name ("Settings", "Fitness", "Admin", "Account"); the section's description, `SectionNavDropdown` and the child page's section-mode heading stay in the content.
- **Profile.** No bar at any scroll position: the cover is full-bleed and flush to the top, and the `floating` trigger is fixed at a 16px (+ safe-area) inset with a solid `bg-popover` surface, border, shadow and a two-part focus indicator: the `ring-2 ring-ring ring-offset-2` ring plus a 1px `outline-foreground` outline at offset 4, which keeps the indicator visible where the orange ring vanishes against an orange cover. Do not put `focus-visible:outline-hidden` on that button; it sets the outline style to none and cancels the outline. The button fades to `opacity-40` while the window is actively scrolling (a passive `scroll` listener; it returns `FLOATING_TRIGGER_SCROLL_IDLE_MS`, 200ms, after the last scroll event) so it does not sit over the text being read. It is never faded while the drawer is open, `focus-visible:opacity-100` keeps it opaque under keyboard focus, `motion-reduce:transition-none` drops the fade animation, and opacity never blocks the click.
- **Back goes in the content.** A parent-route Back is a `BackLink` (or `PageHeader`'s `back`) — a 44px row (`gap-2`, a 16px arrow on the 16px content gutter with no negative margin or padding, then a `text-sm font-medium text-muted-foreground` label at x=40); from `md` up it collapses to the 20px icon it always was. The post page's history Back is the same row (`MOBILE_BACK_ROW_CLASS`), and its container carries `max-md:px-4` so the arrow lines up with the card's avatar. The post/activity page's Back is history-based: `router.back()` only when `InAppHistoryTracker` (root layout) has recorded an earlier, different page in this tab, otherwise a real link to the author's profile built from the handle parsed out of the URL — never from the raw path segment, which can decode to an off-site `//host` (`useInAppBack`; its server snapshot is `null`, so a direct entry renders the link on both sides of hydration and the history Back takes over after). The record is a pathname heuristic, not a guarantee: a new pathname is a push (so a link back to a page already visited still names the page just left), a `popstate` is a pop to the nearest earlier entry, and `lib/components/navigation-history/inAppHistory.ts` documents where it errs in each direction (a multi-step `history.go(-n)` over a repeated pathname, for one). In-pane Backs (message conversation, filter editor, gear detail, heatmap region) are unchanged, and gallery arrows and pagination are not navigation headers.
- **Back labels.** The visible text is "Back" everywhere — list, collection and admin detail Backs, and the post page's history Back — except a Back whose destination is a profile, which reads "Back to profile": the signed-in followers/following Back, the post page's direct-entry fallback, and a history Back whose previous page was a profile. The accessible name always names the destination and contains the visible text (WCAG 2.5.3): "Back to lists", "Back to lists and collections", "Back to accounts list", and for a profile "Back to profile, <display name>" (the visible words come first, as written; `profileBack`/`profileName` in `lib/components/navigation-history/backDestination.ts`; the full `@user@domain` when there is no display name, and custom-emoji `:shortcodes:` are dropped from the name because it is spoken). The history Back names the page it returns to from that page's recorded pathname (`resolveBackDestination`), with registry labels from `nav-items.ts` where one exists:

  | Previous pathname                                                                                                                       | Accessible name                                                                                           | Visible         |
  | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
  | `/`                                                                                                                                     | Back to Timeline                                                                                          | Back            |
  | `/notifications`, `/search`, `/explore`, `/messages`, `/favorites`, `/bookmarks`, `/fitness/*`, `/settings/*`, `/account/*`, `/admin/*` | Back to Notifications, Search, Explore, Messages, Favorites, Bookmarks, Fitness, Settings, Account, Admin | Back            |
  | `/lists`, `/lists/new`, `/collections/new`                                                                                              | Back to Lists                                                                                             | Back            |
  | `/lists/<id>/*` · `/collections/<id>/*`                                                                                                 | Back to list · Back to collection                                                                         | Back            |
  | `/tags/<tag>`                                                                                                                           | Back to #tag                                                                                              | Back            |
  | `/@user@domain`                                                                                                                         | Back to profile, @user@domain (only the handle is known from a pathname)                                  | Back to profile |
  | `/@user@domain/followers` · `/following` · `/fitness/*`                                                                                 | Back to @user@domain's followers · following · fitness                                                    | Back            |
  | `/@user@domain/<status>`                                                                                                                | Back to post                                                                                              | Back            |
  | anything else                                                                                                                           | Back to previous page                                                                                     | Back            |

  The desktop icon Back on the post page carries the same name when there is an in-app page to return to, and "Go back" otherwise (it calls `router.back()` either way, as it always has). The name is only ever text: the history Back is a `router.back()` button, never a link built from the recorded pathname.

- **Logged-out pages keep the branded top bar.** The redesign is for signed-in viewers only. Logged-out profiles, posts, followers/following, hashtags, shared collections, the remote-actor redirect card, the shared heatmap (`/u/heatmaps/[token]`) and their loading skeletons render exactly as before it, apart from the deliberate visual exceptions below (the shared heatmap's logo also now loads from the canonical-origin URL, which looks the same): `PublicTopBar` (logo, Sign in, and Create account only while registration is open) at every width, no compact bar, menu button or drawer. `PublicShell` mounts no `MobileNavigationProvider`, so `MobileCompactHeader`, `MobileNavigationTrigger` and `PageHeader`'s mobile split render nothing there; a page or skeleton shared by both viewers keeps its logged-out geometry by gating mobile-only classes on the provider (`ProfileCardSection`, `PageHeader`'s mobile split), on the session (the status page's inset cards, the collection heading), or on `group-data-[shell=public]/shell:` variants (skeletons). Embeds and the centred auth pages get no chrome.
- **Exception: the logged-out status page is inset cards below `md`.** A logged-out post or activity (`/@actor/<status>`) is the one logged-out page that no longer looks like `main` on a phone, at the owner's request. Its media rows bleed to the card's inner edge, since the card is their owning frame there. `main` pulled the thread flush under `PublicTopBar` (`max-md:-mt-6`) as one full-bleed surface (`MOBILE_FEED_SURFACE_CLASS`), while "Join the conversation" and `PublicFooter` were framed blocks, so the post read as bleeding out of the page. Below `md` the page's outer frame takes `MOBILE_INSET_STACK_CLASS` instead (`lib/components/posts/feedLayout.ts`): it stops painting its own frame and stacks two cards 24px apart, the thread (the post and its replies, or the activity, each `rounded-2xl border shadow-sm`) and the `SignInCallout`, both at `PublicShell`'s 16px gutter, the footer's inset. The 24px is also the gap under the top bar, which is `PublicShell`'s own `py-6` (the negative margin is gone), so the thread starts one gap below the bar and the gap to the callout matches it. The first row of the thread keeps `rounded-t-2xl` at every width (`StatusThread` resets its rows with `max-md:rounded-none` only for a signed-in viewer, since a logged-out thread is a card, not the surface), and the fitness comment list inside the activity (`FitnessStatusDetail`) drops `MOBILE_FEED_SURFACE_CLASS` for a logged-out viewer, because a viewport-wide list would run out past the inset card. Every class is `max-md:`-scoped: from `md` up a logged-out page is still one rounded card with the callout inside it, and a signed-in page (below or above `md`) is unchanged. The loading skeleton (`[status]/loading.tsx`) matches with `group-data-[shell=public]/shell:max-md:` variants that undo the feed surface on its single placeholder card (gutter back, radius, border, shadow) and no `-mt-6`; it has no callout placeholder, as before.
- **Intro row and section spacing.** Below `md` a `PageHeader` whose bar already holds the title shows its description as `text-sm` text on a 20px line, flush with the box's 16px top padding. A section layout's description is followed by its `SectionNavDropdown` 16px below (the layout's `pt-4` is `max-md:pt-0`, so only the box's bottom padding separates them) and the child page's heading 20px below the dropdown (`max-md:mb-5`). The margin belongs to `SectionNavDropdown`, so the nested Fitness › Connections dropdown also sits 20px above its content below `md`. Each of these is `max-md:`-scoped; from `md` up the description stays `text-xs` and the 32px / 16px spacing is unchanged.
- **Exception: the logged-out shared collection has no header band and its cards are inset below `md`.** A logged-out `/collections/<id>` (`CollectionDetail`, `isLoggedOutVisitor`: not the owner and no `currentActor`) is the third logged-out page that no longer looks like `main`, at the owner's request. `main` rendered `PageHeader` there, which with no mobile navigation provider is a full-width sticky band (its own background and divider) between the top bar and the first card, and whose title row is centred in `max-w-content`, wider than `PublicShell`'s 680px column, so on desktop the title started left of the cards. The title and the "by <owner>" line are now plain text (the `h1` keeps its semantics, `truncate text-xl font-semibold tracking-tight`) in the same column as the cards: 24px under the top bar (`PublicShell`'s `py-6`) and 16px above the first card (`mb-4` in place of the stack's 24px). Below `md` the empty state ("No one in this collection yet") drops `MOBILE_FEED_SURFACE_CLASS` and stays an inset `rounded-xl` bordered card in the same 16px column and 24px apart from the meta card above it, and the "Curated by" line loses its `px-1` (`max-md:px-0`) so it is level with the cards' edge. The posts feed (`Posts`) is one more inset card there: the page passes `MOBILE_INSET_FEED_CLASS` (`lib/components/posts/feedLayout.ts`) as its `className`, which `cn` merges after the feed surface `Posts` frames itself with, so `max-md:mx-0` takes back the viewport-wide margin (`max-md:w-auto` stays and fills the column) and `MOBILE_INSET_CARD_FRAME_CLASS` (`rounded-2xl border shadow-sm`) takes back the rounding, border and shadow. It sits in the same 16px column as the meta card and the roster, 24px from each (the stack's `space-y-6`), and its media rows bleed only to the card's inner edge, because the card is their owning frame (the scroller spans the card's content box, inside its 1px border, with no horizontal page overflow). Its rows keep `divide-y` and `Posts`' own `first:rounded-t-xl last:rounded-b-xl`, which sit inside the card's `rounded-2xl` and paint nothing of their own, so the card's corners and the dividers need no per-row handling (unlike the status thread, whose rows carry a background). From `md` up the feed is the single desktop frame. A signed-in page (owner or not, either width) is unchanged, and the page has no `loading.tsx`.
- **Z-order.** Desktop sticky `PageHeader` 20; mobile compact bar, `PublicTopBar`, the floating profile button, scroll-to-top and the reaction-picker backdrop 30 (the floating button renders first in the DOM, so a later same-z backdrop paints over it); in-content popovers 40; the drawer, dialogs, dropdowns, tooltips and `MediasModal` 50. `app/globals.css` pads the scroll snapport under the mobile chrome so focus is never hidden beneath it.
- **Server-rendered components read chrome values from `lib/components/layout/chromeLayout.ts`** (`breakoutStyle`, the bar and back-row class strings) — `BackLink` when a server page renders it, the followers/following loading skeleton — never from the client components that use them — see **Server/Client Module Boundary**.

<a id="agents-fitness-overview-calendar"></a>

### Fitness Overview Calendar

The fitness overview (`app/(timeline)/fitness/`, with its calendar components in `lib/components/fitness/calendar/`) brings the patterns below. Reuse them rather than adding a second variant.

- **Header slots.** The Server Component page passes `OverviewHeaderSlot` elements (empty `contents` spans) as `PageHeader`'s `description` and `actions`; on a container of 600px or more the client dashboard portals the applied dates and the range picker, with a `RefreshButton` (`lib/components/refresh-button.tsx`, the home timeline's Refresh) at its end that re-reads the range and spins while loading, into them with `InOverviewHeaderSlot`, and on a compact one it keeps its own heading and leaves them empty. The slots are empty in the server's HTML on purpose: the dates are the viewer's local days, and only the client knows the zone. `PageHeader` cannot tell an empty slot from a filled one, so it still renders their wrappers.
- **Scoped heat and motion tokens.** Heat colours are the `--heat-0`…`--heat-4` fills, their `--heat-N-fg` numeral colours, `--heat-upcoming` and `--heat-out-of-range`, defined in `app/globals.css` under the `fitness-heat` class (light and `.dark`) that each calendar root carries. Never hard-code a heat colour, and do not move them to `:root`: green means intensity only inside the calendar. Durations are the `--fitness-t-*` tokens beside them. `--fitness-fade-start` and `--fitness-fade-end` are registered with `@property` so the annual scroller's edge-fade mask can transition; an unregistered custom property inside a gradient cannot.
- **Reload control.** A surface that can be reloaded in place puts the shared `RefreshButton` at the end of its header or section row (the home timeline and the fitness overview do), rather than a hand-rolled Refresh button; pass a `size-*` class to match the row's other controls.
- **One CSS module.** `lib/components/fitness/calendar/calendar.module.css` is the only `*.module.css` in `app/` and `lib/`. It holds only what Tailwind utilities cannot express: pseudo-element, mask, gradient and hit-band work such as the cell state marks and focus brackets, the slashed out-of-range cell, the skeleton cell, the edge-fade mask, the today marks, the legend swatch and the month-label hit band. Layout, spacing and type stay in Tailwind at the use site. State is read from data attributes (`data-level`, `data-state`, `data-loading`, `aria-pressed` and the like), never from extra classes, so tests assert a cell's state without knowing a hashed class name, and `calendar.module.css.test.ts` guards the selectors and tokens it relies on. Extend this module for calendar visuals rather than starting another.
- **Section primitives.** Every fitness page builds on the overview's own pieces in `lib/components/fitness/`: `FitnessSection` (a plain `text-base font-semibold` heading on the page with its count and controls on the same row, led by the subject's `text-primary` icon when it has one, as Gear's Bikes, Shoes and Devices and a bike's Components do, and the content in a flat `rounded-lg border` surface below — no `Card` around a section), `FITNESS_TABLE_HEAD_ROW_CLASS` (the faint `bg-muted/40` header band of the Activity types table), `FitnessStatCell` on `FitnessStatGrid`'s `summary` variant inside `FITNESS_STAT_STRIP_CLASS` (the hairline totals strip; pass `columns` for a strip of two or three values so no empty cell is left at the end), `FitnessAlert` (the destructive-ruled error card with an optional Retry) and `FitnessEmptyState` (the muted panel with an icon tile). Loading is the app's shared shimmering `.skeleton` bars (still `--skeleton` blocks under `prefers-reduced-motion`), never a centred "Loading..." line; the calendar's cells, which cannot carry `.skeleton`, sweep one viewport-attached band in `calendar.module.css` instead. The overview, Gear, a gear's page, Files, Heatmaps and Privacy use them; the Strava and Wahoo connection forms keep their own headings in flat `rounded-lg border` panels rather than `Card`s. A new fitness surface reuses them rather than a `Card` with `CardHeader`.
- **Popover.** `lib/components/ui/popover.tsx` wraps `@radix-ui/react-popover` like the other `ui/*` primitives. The range picker uses it when the whole panel fits beside its trigger and falls back to a bottom sheet otherwise (`rangePickerPresentation.ts`); it renders in a portal at the dropdowns' layer (50). The calendar's own cell tooltip is not `ui/tooltip` but one shared `CalendarTooltip` per calendar; its header comment says why.

<a id="agents-settings-forms-client-components"></a>

### Settings Forms (Client Components)

- Settings forms that update user data (name, email, password, etc.) **must be client components** that submit JSON to the API — not plain HTML `<form method="post">` with server-side redirects.
- Client component forms should:
  - Call a named function exported from `lib/client.ts` (which encapsulates the `fetch` call, method, headers, and body serialization), per the Client-Side API Calls section — do **not** call `fetch()` directly in the component
  - Show inline success and error messages (not raw error pages)
  - Manage loading state with `useState`
- A dozen legacy components still call `fetch()` directly (the `Change*Form`s under `app/(timeline)/account/`, `StravaSettingsForm`, the OAuth/password-reset forms, and several `lib/components` settings/actor-switcher dialogs). They are frozen in the `allowFiles` list of `agents/no-component-fetch` in `.oxlintrc.json`; the lint rule blocks any new offender. Migrate them to `lib/client.ts` when touched and remove them from the list — never add to it.
- The corresponding API route should return JSON via `apiResponse()`, not `Response.redirect()`.

<a id="agents-transactional-notification-emails"></a>

### Transactional & Notification Emails

Every email the server sends goes through one shared skeleton, so a design or
copy change lands in one place. All active templates are on it; there is no
legacy shape left to copy.

- **One module per email** in `lib/services/email/templates/`, exporting a single
  `build<Name>Email(params): RenderedEmail` (`{ subject, text, html }`). **Never
  inline a subject or an HTML/text body at a call site** — three of the four
  account emails used to, which is exactly why they could not be restyled
  together. (`actorDeleted` was already a module; its problem was hand-written
  raw markup.) The caller supplies `from`/`to` and spreads the result into
  `sendMail`.
- **Templates never write markup.** They compose blocks from
  `@/lib/services/email/layout/blocks` and hand them to `renderEmail`
  (`@/lib/services/email/layout/renderEmail`), which owns the 600px table
  skeleton, the `<head>`, the header, and both footer variants. Colours and sizes
  come from `@/lib/services/email/layout/theme` — email has no stylesheet, so
  nothing may reference a CSS variable or a Tailwind class.
- **Escaping lives in the block builders, not the templates.** A builder takes
  plain strings and escapes them itself, so a template cannot forget one. Nothing
  in the layout emits an unescaped value today. When the notification templates
  land they will need to pass an already-sanitized post body through; that must
  go through the existing `convertMarkdownText`/`sanitizeText` pipeline and be
  the single, explicitly-typed exception — never markup assembled by hand.
- **Every `href`/`src` is absolute and built from `getBaseURL()`, except the quoted-actor avatar (see below).** A
  root-relative URL is unresolvable in a mail client (note `convertMarkdownText`
  emits `/tags/x` for hashtags), and a hardcoded `https://${config.host}` is
  wrong under `ACTIVITIES_INSECURE_AUTH=true`. URLs are protocol-checked to
  http/https/mailto; anything else degrades to plain text rather than shipping a
  dead or dangerous link, since remote actors control `status.url`.
- **The plain-text alternative is derived from the same block list**, never
  hand-written beside the HTML. Both used to be maintained by hand and had
  already drifted apart.
- **A local `vi.mock('@/lib/config', …)` in a test MUST include `getBaseURL`.**
  It shadows the global mock from `vitest.setup.ts`, and because most email call
  sites deliberately catch delivery errors, omitting it does **not** fail loudly:
  the template throws, the catch swallows it, and the test keeps passing while
  the email silently stops sending. This has already happened twice
  (`deleteActorJob.test.ts` and the password-reset route test), in both cases
  hiding that `sendMail` was never reached at all.
- **Verify a template change by rendering it**:
  `./scripts/mock/renderEmailPreviews.ts` writes every template to HTML with
  fixture data, plus an index showing each one beside its plain-text twin (see
  `docs/maintenance.md`). Emails are not pages, so this is the real-browser check
  Definition of Done item 6 asks for. **A new template must be added to
  `buildPreviews()` in the same PR**, or the change ships unpreviewable. Keep the
  fixture values production-shaped — the codes are 43-char base64url, and a short
  placeholder hides the link-wrapping problems a real one exposes — and leave out
  a fixture the preview cannot represent honestly: the fitness card passes no map
  URL because the generated maps are 4:3 and any stand-in image renders the card
  a third taller than it ever will be.
- **An email must never point an `<img src>` at a stored image path directly.**
  The media storages write WebP unless the caller asks for another format
  (`_saveImageBuffer` / `_uploadImageBufferToS3`), and Outlook desktop (Word
  rendering engine) and Windows Mail have no WebP decoder — those recipients get
  the `alt` text. So an email image needs a stored JPEG copy
  (`saveMediaImageRendition(database, actor, file, 'jpeg')`) plus a column to
  remember it; the route map's lives in `fitness_files.mapImageEmailPath`. Keep
  the WebP as a **live** fallback for whenever the copy is missing — no media
  storage configured, over quota, a failed encode — not merely for rows written
  before the column existed. A stored file with no `medias` row is invisible to
  every generic media path, so whoever writes one owns its whole lifecycle:
  delete it wherever the reference is dropped — `deleteEmailMapImage` is the one
  helper for that, and every site that drops a reference must call it (activity
  delete, `delete_media` status delete, reprocess, re-import, map regeneration,
  the Strava repair script) — teach
  `scripts/maintenance/cleanupMediaStorage.ts` that it is referenced, and add it
  to `scripts/backup/productionArchive.ts`. An on-demand transcode off
  `/api/v1/files/:path` is **not** an option: with object storage behind a public
  hostname that route answers `Response.redirect(url, 308)`, so there are no
  bytes to convert.
- **The quoted-actor avatar is a fixed-size table nested in the row's cell, and
  it shows the actor's image.** `toQuoteAuthor` carries `actor.iconUrl` into
  `QuoteAuthor`, and `quote()` renders it as a 24px `<img>` with `width`/`height`
  attributes and a 50% radius; only an actor with no usable icon gets the
  monogram. "Usable" means `http:`/`https:` — `quote()` checks it with its own
  image-only helper, not the link check, so `mailto:` and `data:` sources are
  dropped. The cell carries the monogram colour as `bgcolor`, a readable 10px
  white font, and the image carries the initials as its `alt`, so a blocked or
  undecodable image leaves a coloured disc rather than nothing, and clients that
  render `alt` show the initials on it. (Checked only in Chromium, which shows
  its broken-image glyph on the disc at this size; Apple Mail, Gmail and Outlook
  were not checked.) Never make the avatar the row's own
  `<td>`: a cell stretches to the row height when the handle wraps and shrinks to
  its text when the card is wider than the screen, which rendered the circle as a
  narrow tall pill in Apple Mail. Keep flexbox out of it and keep `min-width`
  beside the explicit width and height.
- **The avatar is the one email image that is not on `getBaseURL()` and not a
  JPEG copy, and that is an accepted trade-off.** `iconUrl` is used as stored: a
  remote actor's own host, or this instance's media storage for a local actor
  (WebP by default). Two consequences follow. (1) Opening the email makes the
  recipient's client fetch from a host the actor controls, which can see the
  open time, IP and user agent — the same exposure as a remote avatar in the web
  UI, which also loads `iconUrl` directly; there is no image proxy in this repo
  to route it through. (2) A client that cannot decode the format (Outlook
  desktop and Windows Mail have no WebP decoder) or blocks images shows the
  monogram-coloured disc, not the picture. The alternative — a
  stored JPEG rendition per actor — needs a column, a backfill and the lifecycle
  the route-map bullet above spells out, and a remote actor's avatar is not
  stored here at all, so it was not built for a 24px badge. If that changes,
  carry the rendition on the actor and make `iconUrl` the live fallback.
- A browser is a lower bar than a mail client. For a change to the shared layout,
  also send one to a real inbox and check Gmail, Apple Mail and Outlook —
  Outlook's Word engine is the one that needs `mso-` properties and the ghost
  table, and none of that is observable in a browser.

<a id="agents-link-preview-cards"></a>

### Link Preview Cards

- **A card is cached per URL, never per status.** `link_previews` is keyed by
  `urlHash` (sha256 of the normalized URL) and `status_link_previews` maps a
  status to the card it shows. That split is the whole point: a link doing the
  rounds is fetched once per refresh window rather than once per post that
  mentions it. Do not "simplify" this into a column on `statuses`.
- **A failed fetch is stored, not just logged.** `fetchStatus: 'failed'` with an
  `error` code IS the negative cache — it is what stops an unreachable or
  hostile host from being re-contacted for every post that links it, the same
  trap the remote-actor refresh path avoids by stamping its failures. A failed
  row is never linked to a status, so it can only ever suppress a fetch, never
  render an empty card. Completed cards refresh after 7 days, failures after 1
  hour.
- **A failure goes through `recordLinkPreviewFailure`, NEVER through
  `upsertLinkPreview`.** The row is shared by every status linking that URL, and
  `upsertLinkPreview` writes the whole row — so recording a failure through it
  nulled `title`/`description`/`imageUrl`, and because `getStatusLinkPreviews`
  filters on `completed`, one transient 502 on a weekly refresh blanked the card
  for **every** post linking that page. There was no repair path either: the
  negative cache then suppressed the retry, and nothing sweeps existing rows, so
  an older link lost its card permanently. A row that is already `completed`
  therefore keeps its content AND its status and records only the error; the
  refresh is deferred to the next window rather than retried against a host that
  just failed.
- **The job re-resolves the URL before attaching a card.** An edit enqueues a
  job for the new URL under a different id, so the pre-edit job is still queued —
  and a remote fetch is delayed, which makes "old job lands last" the likely
  ordering rather than the unlucky one. Without the re-check it re-attaches the
  pre-edit card permanently, and it also resurrects a card an edit had just
  removed. `resolveStatusPreviewUrl` is the single implementation both the
  scheduler and the job use, precisely so the two cannot disagree about what a
  status's URL is.
- **A card is only ever for a link the reader can SEE — on both paths.** A card
  is a full-width clickable block carrying an attacker-chosen title, description
  and thumbnail, so a link that renders as nothing is a ready-made phishing
  surface. Remote text is stored raw and sanitized only at render, so extraction
  sanitizes first — parsing the stored HTML directly sees markup the reader
  never will. Then, on BOTH the remote and the local path, a link whose text
  renders to nothing is skipped: no visible text, or hidden by the
  `hidden`/`invisible` classes this app's own renderer uses. Visibility is
  measured on the RENDERED output, never the source string — a markdown link's
  text can itself be HTML (`[<!-- hi -->](url)`) that renders to an empty
  anchor. Hidden-ness is inherited, so an anchor inside a hidden ancestor counts
  as hidden too; without that it came first in document order and BEAT the
  genuinely visible link below it. `<template>` is NOT such a case: the
  sanitizer unwraps it, so that anchor really is on screen and really should get
  the card.
  The extractor's short hidden-class list (`hidden`, `invisible`, and the
  `quote-inline` quote-fallback marker, which every quote-aware renderer hides)
  only works because `sanitizeText` runs first — see the sanitizer rule below.
  As a denylist it would be hopeless.
- **`sanitizeText` allowlists the CLASS attribute, and everything above depends
  on it.** `SANITIZED_OPTION.allowedClasses` reduces `class` on `a` and `span`
  to `ALLOWED_CONTENT_CLASSES` — `h-card`, `p-author`, `u-url`, `mention`,
  `hashtag`, `invisible`, `ellipsis`, `quote-inline` — and `p`, which keeps a
  `class` attribute solely so Mastodon's `<p class="quote-inline">RE: …</p>`
  quote fallback survives to render time, is filtered to `quote-inline` alone.
  That attribute reaches the real DOM:
  `cleanClassName` hands an anchor's class straight to `className` and leaves
  any span class it does not itself rewrite alone. This app compiles Tailwind,
  so without the allowlist every utility in the bundle is a class a remote
  server can spend on our page — `sr-only` is
  `position:absolute;width:1px;height:1px;clip-path:inset(50%)`, enough to
  publish a link into a post that no reader can see, which then wins the
  preview card on document order.
  `cleanClassName` rewrites in-text profile links (`extractProfileHref`) to local
  `/@handle` routes only when there is evidence of an actor mention: matching status
  mention tags, explicit `mention` class token on the anchor, or a profile URL pointing
  to this instance's own host. A bare `/@handle` URL shape on an external domain is NOT
  treated as a Fediverse actor profile (services like YouTube, TikTok, and Medium share
  that path shape) and remains an external `target="_blank"` link.
  Three things to keep right when touching it. It is an explicit list, **not**
  Mastodon's `h-*`/`p-*`/`u-*` prefix globs — those are unsafe here because
  `h-*` would admit `h-screen` and `p-*` would admit `p-0`. `hidden` is
  deliberately absent: no fediverse server sends Tailwind's `display:none`, and
  `invisible` is the marker that actually arrives. And
  `SANITIZED_TRUSTED_STATUS_OPTION` must SPREAD this map rather than replace it
  — a tag with no `allowedClasses` entry keeps its class untouched, so
  declaring only `img` there quietly hands `span` and `a` back an unrestricted
  class attribute. `extractUrl.test.ts` pins the allowlist against the
  extractor's hidden-class list, so adding a class fails the suite until it is
  classified as hiding or benign.
- **`convertEmojisToImages` runs BETWEEN the two sanitize passes, so both halves
  of an emoji tag are an injection point.** On the remote path `createNoteJob`
  persists an inbound `Emoji` tag's `name` and `icon.url` verbatim — the AP
  schema asks only for `z.string()` — and this step splices them into HTML that
  the first pass has already approved and the second will keep if the allowlist
  permits it. (The local path is safe by construction: `getEmojiTags` resolves
  `:shortcode:` tokens against this instance's own emoji table.)
  **Four separate things went wrong here, and the shape of the function is the
  fix for all four.** Do not simplify it back toward
  `tags.reduce((t, tag) => t.replaceAll(tag.name, '<img …>'), text)`.
  1. It searches for a shortcode-shaped TOKEN and then looks the name up, rather
     than using the stored name as the search string. A name shaped like
     `<a href="…">` matched the post's own anchor and consumed it; escaping the
     output can never fix a bad search term.
  2. It is a SINGLE pass over the original text. Every replacement writes an
     `alt=":shortcode:"` of its own, so feeding each result into the next let
     one tag match another's output and nest markup inside an attribute.
  3. It substitutes only in TEXT pieces, never inside tags. A `:` survives
     sanitization in an href, so blind substitution rewrote the very link a
     preview card was for — the reader got a corrupted url while the card named
     the original. This one needed no hostile input: an ordinary custom emoji
     plus any link with a `:word:` path segment did it.
  4. The replacement is a FUNCTION, which is what makes `$` literal. A string
     replacement re-reads `$&` and `` $` `` AFTER escaping, so a url carrying
     those spliced raw `<`, `>` and `"` from elsewhere in the post into the src
     attribute — characters `escapeHtml` never saw, because they were never in
     the url.
     `escapeHtml` on the url is still required on top of all four. Raw, a `"` in it
     closed the `src` attribute and made the remainder live markup, enough to wrap
     a link in `<span class="invisible">` that `cleanClassName` renders as
     `display: none` — a preview card for a link no reader could see.
     Keep this at RENDER, not at ingest: it is the one choke point that also
     protects rows already in the database. A rejected tag renders as nothing
     and the literal `:shortcode:` stays in the text.
     **The accepted shortcode shape is deliberately NOT Mastodon's**
     `[a-zA-Z0-9_]{2,}`. That describes what Mastodon mints, not what arrives:
     applying it to inbound tags deleted real emoji from ~2% of a live Pleroma
     and a live Akkoma instance's packs — `:poi-love:` (hyphens, which Sharkey
     allows on purpose), `:c:` and `:3:` (one character, which GoToSocial and
     Misskey permit), `:afiŝo_miaŭ:` (non-ASCII). Pleroma and Akkoma derive
     shortcodes from pack filenames and never validate what they send.
     `toEmojiShortcodeToken` therefore accepts anything up to 64 characters
     that is not a colon, whitespace, or a control/format character, and makes
     the colons optional because Friendica sends the name bare (`"like"`) while
     its body still says `:like:`. `EMOJI_SHORTCODE_REGEX`, used to mint LOCAL
     tags, stays on Mastodon's narrow shape — the two are different jobs.
- **`syncStatusLinkPreview` never throws.** It is called from local create, local
  edit, and the inbound `CreateNoteJob`/`UpdateNoteJob`, and every one of those
  has already written the status by the time it runs. A preview card is
  decoration; losing one must never fail posting or the ingest of someone
  else's post. The whole body is inside one try/catch for that reason.
- **The delay is conditional on the queue, because NoQueue drops delayed
  messages.** Remote fetches carry a random 1–59s `delaySeconds` so this
  instance is not part of a thundering herd on a widely-shared link (the
  "link preview stampede" Mastodon has repeatedly been blamed for). But the
  in-process queue has no scheduler and silently DROPS any message with a
  positive delay, so the delay is only attached when `getQueue().runsInline` is
  false. Attaching it unconditionally does not delay the fetch — it loses it.
- **Extraction runs the WHOLE `processStatusTextContent` and walks its output.**
  Not a rearrangement of its parts — the same function the rendered post, the
  notifications and (with emoji replacement disabled per the client spec) the
  Mastodon API all use, for local and remote statuses alike. That is the only way
  to know what the reader sees, and every time this ran a subset of the pipeline
  something got through:
  walking marked's tokens missed hidden ancestors and entity-only link text;
  sanitizing but skipping the emoji step MEASURED TEXT THE RENDERER THEN
  DELETED (`sanitizeTrustedStatusText` serves emoji images over https only and
  drops an img left without a `src`, so a remote `Emoji` tag pointing at
  `http://` emptied an anchor whose `:blob:` had just been counted as its
  visible text — and the card went to that anchor). This is also why
  `extractPreviewUrl` takes `tags` and `resolveStatusPreviewUrl` passes
  `status.tags`; dropping that argument is a one-line edit that silently hands
  back a phishing card, so it has its own test.
  A consequence worth knowing: an anchor whose only content is an emoji image
  gets NO card, because it has no visible text and an emoji image is whatever
  the remote server serves — a transparent PNG included. Erring toward no card
  is the intended direction.
  **Same string, different PARSERS — this is the one gap the shared pipeline
  does not close.** The extractor runs server-side, so `htmlToDOM` resolves to
  `html-dom-parser`'s Node build (htmlparser2, no HTML5 tree construction). The
  reader's `cleanClassName` runs in the browser bundle, where it resolves to
  `template.innerHTML` — full tree construction, adoption agency and all. So a
  nested `<a>`, which htmlparser2 keeps verbatim and a browser hoists out of
  its ancestor, made the OUTER anchor look like it owned text it does not;
  first in document order, it took the card while rendering as an empty clone.
  The precise rule is that an anchor owns only the text BEFORE a descendant
  anchor: the algorithm pops the outer one at the inner one's START TAG, so the
  inner anchor AND everything after it — inline or block — is reparented
  outside. `getVisibleText` therefore stops at the first descendant anchor, in
  document order. Three separate phishing cards came out of getting this wrong:
  counting the inner anchor's text; counting a trailing `" — worth a read."`
  that the reader sees as prose beside an empty anchor; and checking
  hidden-ness BEFORE the nested-anchor stop, so a nest that was itself
  `invisible` (or sat inside an `invisible` span) never tripped it. That last
  one is the rule to hold on to: **hiding is CSS and a parser never reads it**,
  so the restructuring happens whatever the nest wears. `getVisibleText`
  therefore tests for a nested anchor first, and descends into hidden subtrees
  while suppressing their TEXT rather than returning at them — the suppression
  is what keeps Mastodon's `invisible`/`ellipsis` split link working. What it is NOT is "an
  anchor containing an anchor is invisible" — text before the nest survives and
  stays eligible. `sanitize-html` splits a DIRECT `<a><a>` itself, so it takes
  one allowed tag in between to reach this, and all fourteen work.
  If a construction rule other than nested anchors ever matters here, prefer
  giving the extractor a spec-compliant parser over adding a second special
  case.
  Anchors that are mentions or hashtags are rejected by the markers the
  renderer itself emits (`rel="tag"` and the `mention`/`hashtag`/`u-url`
  classes).
  Do not "simplify" the local path back to walking marked's token tree. It was
  written that way and the tokens are the wrong shape for this job three times
  over: marked flattens raw inline HTML into flat SIBLING tokens, so a link
  inside `<span class="hidden">…</span>` has no ancestor to inherit hidden-ness
  from and beat the visible link below it; link text written as an entity
  (`[&#8203;](url)`) reads as non-empty in source while rendering to nothing;
  and a table cell carries its own `header` BOOLEAN, which crashed the walker
  and silently turned every post containing a table into "no links". Rendering
  first removes all three, because the HTML walker inherits hidden-ness and the
  parser decodes entities.
- **Every optional field of the Mastodon `PreviewCard` gets an `''`/`0`
  default.** That schema declares every string field non-nullable and
  `Mastodon.Status.parse` runs once per status inside a handler that catches and
  SKIPS a status it cannot serialize — so a card missing one key does not lose
  the card, it drops the whole status out of the timeline. `getMastodonPreviewCard`
  owns those defaults and `getMastodonPreviewCard.test.ts` pins them.
- **`html` and `embed_url` are always empty.** This server does not consume
  oEmbed, and emitting remote-authored markup for clients to inject is a hazard
  with no upside. If oEmbed is ever added, that is a deliberate decision with its
  own sanitization story — not a side effect.
- **Card text is remote, author-controlled input.** It is stripped of control,
  C1 and bidi characters and truncated at parse time (`siteName`/`authorName`
  are `varchar(255)`, so that cap is a PostgreSQL insert requirement, not a
  preference), rendered as React text nodes and never as markup, its href goes
  through `safeExternalHref`, and its thumbnail is `https`-only and loaded with
  `referrerPolicy="no-referrer"`. The displayed domain is always derived from
  the URL, never from the page's own `og:site_name`, which the page controls.
- **A YouTube link renders a click-to-play player, and the branch reads the URL
  — never the metadata.** `getYouTubeVideoFromUrl` (`lib/utils/youtube.ts`)
  parses `linkPreview.url`, which is the **redirect-resolved final URL this
  server fetched** (`fetchLinkPreview` stores `normalizePreviewUrl(response.url)`),
  so a page can only be treated as YouTube by actually being served from a
  YouTube host. Neither `og:type` nor the stored `type` column is consulted,
  even though `mapCardType` already writes `'video'` for these pages: that
  column is page-claimed, and gating on it would make one URL render two ways
  depending on what a cache entry happened to capture. Hosts are matched
  **exactly** (`youtube.com.evil.example` ends with nothing that matters) and
  the id must be 11 base64url characters — which rejects a percent-encoded PATH
  segment outright, since the pathname is never decoded, while a `?v=` value is
  decoded by `URLSearchParams` first and then has to satisfy the same shape.
  `/embed/videoseries` is refused by name because it is eleven lowercase
  letters that embed a whole playlist; nothing else needs that carve-out,
  because `list` is never carried into the embed URL, so no playlist can be
  framed however it is spelled.
  The feature's entire third-party surface is two fixed hosts, both in
  `csp.ts`: the player is framed from `https://www.youtube-nocookie.com`, the
  only origin in `frame-src` (there was no `frame-src` at all before this —
  `default-src 'none'` blocks every iframe), and the poster comes from
  `https://i.ytimg.com`, which is an **unconditional** `img-src` source rather
  than one of `remoteMediaSources`, so narrowing (or emptying)
  `ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS` cannot blank the thumbnail of every
  video card. `next.config.test.ts` pins that against the emptied allowlist.
  **Nothing loads from the player until the reader presses play** — a live
  iframe per row is a megabyte of player code and a Google request for every
  video that merely scrolled past — and **the card is mounted under a React
  `key` on the video id**, so a card replaced in place is REMOUNTED and cannot
  inherit the previous video's consent and autoplay something nobody clicked.
  Do not delete that key as redundant: the component also remembers which video
  was played, but that alone was the original guard and it was insufficient —
  the remembered id was only ever compared against, never cleared, so it
  defended a change A→B and not a change back A→B→A, which re-entered the
  playing branch with no gesture. A remount clears it in both directions, and
  happens in the same commit, so there is still no painted frame of autoplay.
  `autoplay` is set only on a player the reader mounted, and must be in the
  iframe's `allow` list to reach the frame at all.
  **The facade's focus indicator lives on a child OVERLAY, not on the button**,
  and that is not a style preference — it is the only place it survives. The
  button is flush with the edges of a wrapper that must clip
  (`overflow-hidden`, to round the video's corners), so anything painted
  outward (a plain `ring`, a zero-offset outline) is clipped on the three sides
  that are flush with it and survives only along the bottom, whose edge is
  interior to the wrapper — a full-width 2px line between the video and the
  caption, measured at 1416 pixels against the shipped overlay's 4412. Unusable
  as an indicator, not invisible; do not repeat the earlier claim that it
  measured zero, which was an artefact of the measurement method below.
  Anything painted inward (`ring-inset`, a negative-offset outline) IS
  effectively invisible — 14 pixels — because it paints BELOW the button's own
  descendants, where the full-bleed poster covers its box exactly. The
  indicator is therefore a `pointer-events-none absolute inset-0` span rendered
  as the button's LAST child, which has no descendants of its own to hide it,
  and carries `rounded-t-[11px]` so the wrapper's inner radius does not nip its
  top corners. On that overlay it is an **outline, not a ring**: forced-colors
  mode (Windows High Contrast) drops box-shadows, which left the card's only
  control with no focus indicator at all while the caption link beside it kept
  one. The caption may keep its outline on the element itself, because its
  children are in-flow text that never reaches its padding edge.
  Verify any focus change by COUNTING INDICATOR PIXELS on an element
  screenshot, **with a poster loaded and with `forced-colors: active` as
  well**, never by reading `getComputedStyle` — a box-shadow that is computed
  is not a box-shadow that is painted, and that mistake cost this feature two
  review rounds. Screenshot the WRAPPER, not the focused element, whenever the
  candidate paints outward: an element screenshot cannot see anything outside
  that element's own box, so it reports zero for every outward indicator and
  will walk you into calling one invisible when it is merely clipped. Two more
  traps in the harness:
  Playwright's `page.screenshot({clip})` is page-relative while
  `getBoundingClientRect()` is viewport-relative (use element screenshots), and
  `:focus-visible` will not match a programmatic `.focus()` unless keyboard
  modality was established first. The two anatomies are **separate components** behind
  one exported `LinkPreviewCard`, so React swaps component type rather than
  reordering hooks. The Mastodon `card.html`/`embed_url` stay empty regardless:
  the embed URL is built in the browser, so this is not oEmbed consumption.
- **The card yields to media, a quote or a fitness activity in the UI** — but it
  is still fetched and still served over the API in all three cases, so a client
  is free to decide otherwise. Display policy lives in `post.tsx`, not in the
  fetcher.
- **The kill switch is `network.linkPreviews`, not a `features.*` flag.** The
  `features.*` namespace is navigation-only (its switches are keyed off the nav
  registry and only remove items from navigation); this one gates outbound
  requests to third-party sites, which is what an operator turning it off
  actually cares about. It lives on Admin → Network with the other
  outbound-request settings and has no env var, so the kill switch can never be
  locked shut by the environment. It gates FETCHING only: the cleanup that drops
  a card when an edit removes its link runs either way, so turning previews off
  cannot strand a card on a post that no longer links anything.
- **Known gaps, all deliberate — none of them is an oversight to "fix" by
  bolting on a sweep.** `FetchLinkPreviewJob` is enqueued from exactly one place
  (`syncStatusLinkPreview`, on create and edit), which has three consequences.
  A status whose first fetch failed never acquires a card, because nothing
  re-runs for it — the hour-long negative cache only helps a _later_ status
  linking the same URL. An attached card is never re-read on its own, so the
  7-day refresh only happens when someone posts that link again. And nothing
  ever deletes a `link_previews` row, so the per-URL cache grows without bound.
  These are the shape of a server with no recurring-job infrastructure (the
  queue can delay a message but not repeat one — the same constraint that makes
  fitness service reminders evaluate on write). `link_previews_status_updated_idx`
  exists for the staleness sweep that would close them; until such a sweep is
  written, expect it to be unused.
- **Polls get no card, but only because nothing asks for one.** Neither
  `createPoll`, `updatePoll` nor `createPollJob` calls `syncStatusLinkPreview`;
  everything below that call is already type-agnostic. `StatusPoll` extends
  `StatusNote` so it carries `linkPreview`, and the hydration and `post.tsx`
  both handle any status.
  There IS a storage asymmetry — `createPoll` stores `convertMarkdownText(...)`'s
  rendered HTML where `createNote` stores raw markdown, and `extractPreviewUrl`
  still picks its branch from `isLocalActor` — but it stopped mattering when
  extraction moved to rendering the text and walking the result: marked leaves
  already-rendered HTML untouched, so a poll body run through the local branch
  renders to itself and yields the same URL the remote branch would. Verified
  both ways round. So this is now a one-line change, and the thing to check
  before making it is not the parser but the ordering rule the note actions
  follow — schedule the sync AFTER the poll has published, or on the default
  in-process queue the author waits on a third-party fetch before their poll
  goes anywhere.

<a id="agents-status-delete-unboost-federation"></a>

### Status Delete & Unboost Federation

- **The local delete commits FIRST and the `Delete` fans out from
  `SendDeleteNoteJob` afterwards — and that job must never load the status it is
  announcing the death of — and the same holds for `SendUndoAnnounceJob` and the
  Announce it undoes.** `database.deleteStatus` is a cascading hard delete,
  so by the time the job runs the row (and its whole same-actor reply subtree) is
  gone. `deleteStatusFromUserInput` (`lib/actions/deleteStatus.ts`) therefore
  captures the audience before deleting and publishes it in the payload
  (`{ actorId, statusId, to, cc }`), and `getFederatedStatusDeliveryInboxes`
  takes `Pick<Status, 'to' | 'cc'>` rather than a whole `Status` so a caller
  holding only that payload can still resolve inboxes. **Do not "unify" either job
  onto `loadStatusAndActor`**: that is exactly the bug `sendUndoAnnounceJob`
  shipped with — `undoAnnounce` hard-deletes then enqueues, the job bailed on
  `!status`, and no unboost ever federated. Every delivery test in
  `lib/jobs/sendDeleteNoteJob.test.ts` and `lib/jobs/sendUndoAnnounceJob.test.ts`
  uses a statusId that is deliberately NOT in the database for that reason.
- **The dedup id is `getHashFromString(`${statusId}#delete`)`, and the suffix is
  correctness.** The queue deduplicates globally on `message.id` across job
  names, with a window that outlives consumption (`SendNoteJob` publishes under
  bare `getHashFromString(statusId)` and `SendUpdateNoteJob` under
  `getHashFromString(`${statusId}#update/${updatedStatus.updatedAt}`)`) — without
  the suffix, deleting a status posted or edited inside that window is silently
  dropped and never federates.
- **Ids derived from REMOTE input live in their own namespace.** An inbound
  activity's `id` is chosen by the sender, so hashing it bare let a sender pick
  the preimage of an internal key — an activity with `id: "<statusId>#delete"`
  reserved this very fan-out key, and the later delete was swallowed as a
  duplicate. Every inbox-derived job id goes through `getInboxJobId`
  (`app/api/inbox/getInboxJobId.ts`, an `inbox:` prefix), and the database
  queue's `createQueueJob` throws when a conflicting id already belongs to a job
  of a different `name` instead of returning that row as success.
- **Unboost carries more than the audience, because its activity embeds the
  Announce.** `undoAnnounce` (`lib/activities/index.ts`) builds its object from
  `id`, `actorId`, `createdAt`, `to`, `cc` and `originalStatus.id`, so the job
  payload carries all six and the sender's `announce` parameter is narrowed to
  exactly that shape (`UndoAnnounceTarget`) rather than a whole `StatusAnnounce`
  — the same narrowing trick `getFederatedStatusDeliveryInboxes` uses, and safe
  because the job is the sender's only consumer. Its dedup id is
  `getHashFromString(`${statusId}#undo`)`, matching the emitted `<id>#undo`;
  `SendAnnounceJob` publishes under the bare status id, so without the suffix a
  boost followed by an unboost inside the dedup window drops the `Undo`. It
  keeps `getFollowersInbox` + `filterFederatedUrls` rather than the shared
  delivery helper, because `sendAnnounceJob` resolves inboxes the same way and
  the two must stay symmetric.
- **Fan-out failure handling follows the queue backend.** The database queue uses
  `deleteStatusWithQueueJob`: deletion and queue insertion share one transaction,
  so a transaction failure propagates and rolls the local delete back. External
  and synchronous queues commit through `database.deleteStatus` first and publish
  afterwards; a post-commit publish failure is logged without reporting the
  committed deletion as a failed request, which would tell the author their post
  is still present when it is gone. Unboost keeps delete-then-publish and the same isolation for every queue backend.
  A post-commit delete publication failure must not skip the route's media cleanup.
  Log the failure with its stack. Remote copies can reconcile on their next fetch,
  which returns 404; this is not a guarantee that every remote copy will fetch again.
  With the default in-process queue, follower-inbox lookup and fan-out happen
  inside `publish`, so those operations can throw after the local unboost commits.
- Delivery errors never reach that catch: `postActivityToInbox` swallows every
  network failure and returns `undefined`, so the activities `deleteStatus`
  sender does not reject. A test that fails the _socket_ therefore proves nothing
  about the job's per-inbox guard — mock the **sender** to reject, which is the
  only seam that can.
- Known gap, unchanged by the move to a job: a cascaded reply subtree is deleted
  locally but only the top status's `Delete` federates.

<a id="agents-actor-profile-deletion-federation"></a>

### Actor Profile & Deletion Federation

- **A local profile edit federates as `Update(Person)` from `SendUpdateActorJob`,
  queued by `publishActorUpdate` (`lib/services/actors/actorUpdate.ts`) after
  every route that writes a published profile field:
  `PATCH /api/v1/accounts/update_credentials`, `PATCH /api/v1/profile`, the web
  settings form `POST /api/v1/accounts/profile`, and
  `DELETE /api/v1/profile/{avatar,header}`.** A new route that writes `name`,
  `summary`, `iconUrl`, `headerImageUrl` or `manuallyApprovesFollowers` must
  call it too, or remote servers keep the old profile until their own periodic
  re-fetch. Queueing is best effort and never fails the request: the profile is
  already saved. The object is `getPersonFromActor`, the same document the actor
  URL serves, and the audience is follower inboxes plus accepted relays, as in
  Mastodon. The activity id is `<actor>#updates/<updatedAt>`, with `updatedAt`
  carried in the job so a retried job resends the same Update.
- **Account deletion sends `Delete(actor)` from `deleteActorJob` itself, inline,
  while the row is still `scheduled`: after the due-time checks and BEFORE
  `startActorDeletion`.** The Delete must be signed with the actor's key, and
  `deleteActorData` removes the row that holds it, so a queued
  `DeliverActivityJob` would find no actor on retry and discard itself. Do not
  move the sends after the data delete or onto the queue. Do not move them after
  `startActorDeletion` either: a worker that dies mid-fan-out is retried, and a
  retry of a row already marked `deleting` stops at the status check, which
  would leave the account in `deleting` with its data never removed. The job
  re-reads the status after the sends so a cancel that landed meanwhile still
  keeps the account locally; the Deletes already sent cannot be recalled, so
  remote servers that processed one have dropped the account's copy and its
  follows there. The sends share a wall-clock budget
  (`ACTOR_DELETION_FEDERATION_BUDGET_MS`, under QStash's 30s job limit) and
  each uses a short timeout (the request layer never retries a POST): a
  hosted queue cuts the job off at its deadline and retries from the top, so a
  fan-out that never fits would
  keep the account from ever being deleted. Inboxes not reached in time are
  skipped. Inboxes
  of LOCAL followers (`getLocalFollowersForActorId`) are left out: delivering
  there would run the inbound actor delete (`deleteObjectJob` →
  `database.deleteActor`) on the row the job is still emptying. Sending is best
  effort and never stops the local deletion.
- **An inbound `Update` whose object is an actor (an actor type, or a bare id
  equal to the activity's actor) goes to `UpdateActorJob`, which re-fetches the
  profile from its origin through `recordActorIfNeeded({ forceRefresh: true })`
  and never reads the activity body.** `getJobMessage` accepts it only when the
  signer, the activity's `actor` and the object id are the same actor. The job
  refreshes only a stored remote row: an actor never stored has nothing to
  refresh, and a local row is never rewritten from the network.
- **`sensitive` federates both ways.** Outbound notes always carry it as a
  boolean (both `getNoteFromStatus` and `toActivityPubObject`), as Mastodon does.
  Omitting `false` would leave an un-marked post sensitive on any receiver that
  keeps the stored flag when an edit omits the key, which is what this server's
  own `updateNoteJob` does. Inbound `createNoteJob` and the on-demand fetches in
  `fetchRemoteStatusJob` store the flag (the collection-member outbox backfill
  does not carry it yet), and
  `updateNoteJob` applies it only when the edit carries a boolean. A
  non-boolean value parses as absent (`.catch(undefined)` on the schema) rather
  than rejecting the note.

<a id="agents-better-auth-plugin-guidelines"></a>

### Better-auth Plugin Guidelines

- **Do not register a better-auth plugin unless its required database tables exist** in the Knex migrations. The custom `knexAdapter` does not auto-create tables; missing tables will cause runtime errors.
- **On any better-auth upgrade, diff the schema better-auth declares against ours — do not reason about which new fields are "reachable".** `knexAdapter.create` does a bare `insert(record)` with whatever a plugin put in the record: it creates no tables and filters no columns, so a field a plugin writes and the schema lacks is a failed INSERT, not a degraded feature — and better-auth swallows the driver error into a 500. The better-auth 1.7 upgrade shipped a green suite while **every OAuth sign-in 500'd**, because the oauth-provider plugin had started writing `oauthConsent.requestedUserInfoClaims` (`[]`, not `undefined`, so the factory's `transformInput` does not drop it) and only the core `account`/`jwks` changes had been noticed. `lib/services/auth/schemaCompleteness.test.ts` now asks `getAuthTables(auth.options)` — the real plugin set, with our `modelName`/`fieldName` overrides applied — and diffs it against `migrations/schema.sqlite.sql`, so the next upgrade fails a test instead of an OAuth login. Take that list as the migration's contents. **The CI "Schema Dump Sync" job cannot catch this**: it regenerates the dumps FROM the migrations, so a migration that omits a column still produces a perfectly matching dump.
- **`lib/services/auth/oauthProviderFlow.test.ts` is the only thing that drives better-auth's real OAuth endpoints** (sign-in → authorize → consent → token exchange, against a database built from the committed dump). `app/(nosidebar)/oauth/token/route.test.ts` mocks `getAuth`, so it asserts our proxying and nothing about better-auth. Keep the flow test running all the way to an access token — each step is there for the rows it writes, and stopping at the first 200 skips exactly the INSERTs that break.
- When adding a new plugin (e.g. `sso()`, `dash()`), first create the necessary migration with `yarn migrate:make <name>`, then register the plugin.
- Plugins that expose admin or dashboard endpoints must be configured with explicit access control (e.g. `adminCredentials` or `adminRole`). Never register `dash()` without authentication gating.
- **Account identity is the mapped provider key `(provider, providerId)`, not `issuer`.** better-auth 1.7.3 restores the 1.6 lookup semantics: in `lib/services/auth/auth.ts`, better-auth's `providerId` maps to this table's `provider`, and its `accountId` maps to `providerId`; the adapter and `lib/database/sql/account.ts` resolve and link rows by that pair. Direct writes therefore omit `issuer`, and `createCredentialProvider` ignores an existing credential row so it cannot overwrite its password. `account_providers.issuer` remains a nullable historical compatibility column; retain it and the 1.7.0–1.7.2 migrations/backfills, but do not make new code depend on or populate it. OAuth, JWT, and two-factor issuer settings are separate and remain active.
- **Preflight the real database before a 1.7.3 rollout.** The committed schema already has a nullable `issuer` and no issuer-based unique index, but a deployment that was manually migrated through 1.7.0–1.7.2 may still carry the old constraint or index. Drain and remove every 1.7.2 auth-serving instance before 1.7.3 accepts writes or authentication traffic: 1.7.3 can write `NULL` `issuer`, which 1.7.2 sign-in cannot read, so route this as a coordinated cutover with no overlapping auth traffic. Inspect the actual constraints and indexes, and check for duplicate mapped provider keys `(provider, providerId)` before new pods serve traffic; resolve ambiguous rows before deployment because better-auth rejects lookups with more than one match. If the preflight finds a constraint or duplicate, stop the rollout and keep the current release serving until the data and schema change is complete and reversible. Keep operational SQL in the deployment runbook, not this guide.
- **Plan rollback separately.** A package-only rollback to 1.7.2 after 1.7.3 has written rows with `NULL` `issuer` can leave those rows unreadable by 1.7.2 sign-in. Preserve the nullable column for compatibility, and if rollback is required, restore issuer values for rows written while 1.7.3 served before handing traffic back; keep duplicate-key checks and constraint state aligned with the target release. Dropping the column is optional cleanup and should wait until rollback no longer matters.
- **`knexAdapter` must implement `consumeOne` and `incrementOne` natively, even though better-auth 1.7.3 supplies guarded fallbacks.** Both are race-safe primitives better-auth relies on for correctness, not speed: `consumeOne` backs single-use credentials (verification tokens, OAuth authorization codes, device codes) and `incrementOne` backs guarded counters (2FA failed attempts, rate limits, an authorization code's remaining uses). The factory fallback relies on conditional `deleteMany` or `updateMany` mutations guarded by the selected row's identity and snapshot values, plus an accurate affected-row count. That fallback is safe only when those adapter methods preserve those guards atomically. Keep the native methods so the caller's predicate is enforced in the mutating statement; they also return `null` for an empty predicate rather than consuming or mutating an arbitrary row.
- **`experimental.instrumentation` was introduced in better-auth 1.7.4 for OpenTelemetry distributed tracing and defaults to enabled.** This app disables it by default (`experimental: { instrumentation: { enabled: config.auth?.enableInstrumentation ?? false } }`) to prevent unexpected span creation and tracing overhead on authentication requests unless explicitly opted into via `ACTIVITIES_AUTH`.

<a id="agents-better-auth-database-joins"></a>

### Better-auth Database Joins

- **`advanced.database.joins` is ON (`lib/services/auth/auth.ts`), and answering every join is `knexAdapter`'s job — the fallback is a slower path, not a free one.** The flag lived at `experimental.joins` until better-auth 1.7 moved it here. On 1.6.x it was an assertion rather than a request: the adapter factory forwarded `join` to `findOne`/`findMany` and read the related rows straight off what the adapter returned (`data[tableName]`), with no capability check and no fallback, so an adapter that ignored a join shape handed back a session with no user, `findSession` turned that into `null`, and **every signed-in user was silently logged out** while sign-in still appeared to succeed. 1.7 checks whether the adapter included the key and falls back to separate queries, which turns that outage into a per-request extra statement. Nothing in the adapter's own unit tests catches either — they call the adapter directly, so they never see the factory's transform. `lib/services/auth/sessionJoins.test.ts` drives the real better-auth instance against a real database and asserts the single statement; keep it passing.
- **A join key is the joined TABLE name, and the returned row must nest under exactly that key.** For this instance's model mapping, `join: { user: true }` on a session arrives as `{ accounts: { on: { from: 'accountId', to: 'id' }, limit: 1, relation: 'one-to-one' } }` — the columns are already resolved, so the adapter uses them as given.
- **Joined columns must be aliased before they are selected.** `sessions` and `accounts` both have `id`, `createdAt` and `updatedAt`; selecting both tables unaliased overwrites the session's own id with the account's, which is a worse bug than the missing join. The adapter selects each joined column as `__j<n>_<column>` and re-nests it — the prefix is short on purpose, because PostgreSQL truncates identifiers at 63 bytes and a truncated alias merges two columns into one.
- **Only `one-to-one` is folded into the base statement; anything else gets a follow-up query.** A `one-to-many` join carries a per-parent `limit` that plain SQL cannot express without window functions, and on `findMany` it would multiply the base rows and break `limit`/`offset`. The follow-up path is also the fallback for a table better-auth's schema does not describe — that path is always correct, so prefer it over a half-working join.
- The joined table's column list comes from better-auth's own schema, which is lossless: the factory's output transform reads only the model's schema fields plus `id` and drops everything else, so selecting exactly those matches what a `SELECT *` would have produced while keeping app-only columns out.
- **Session lookups run `WHERE token = ?` on every authenticated request** — `sessions.token` is indexed (`sessions_token_idx`) for exactly that reason. The older `(accountId, token)` composite cannot serve it: a B-tree led by `accountId` leaves a bare-`token` predicate to a sequential scan. Don't drop the single-column index on the grounds that the composite already mentions `token`.
- **`experimental.joins` was removed in 1.7 in favor of `advanced.database.joins` — it is not a compatible alias for the new key.** better-auth's options type accepts unknown keys, so a stale `experimental: { joins: true }` neither fails to compile nor warns; it just stops requesting joins, and every authenticated request quietly costs a second statement again. Check the option's location against the installed version's `advanced.database` on any better-auth upgrade.

<a id="agents-better-auth-session-refresh"></a>

### Better-auth Session Refresh

- **A session may only slide forward where its cookie can be written.** A better-auth refresh does two writes together: it extends the `sessions.expireAt` row and re-issues the session cookie with a fresh `Max-Age` (`session.expiresIn`, 7 days by default). Server Components cannot set cookies, and route handlers that call `auth.api.*` directly drop the `Set-Cookie` the call produced, so a refresh in either place lands only the database write.
- **That is why `getServerAuthSession` passes `query: { disableRefresh: true }`.** Before it did, every page render could refresh the row behind the cookie's back: the database kept extending, the browser cookie kept the `Max-Age` it got at sign-in, and every user was signed out seven days after signing in however active they were — and because the row had just been refreshed, nothing re-issued the cookie before it lapsed. With releases going out several times a day, it looked as though each deploy logged people out.
- **Refreshes happen only inside better-auth's own `/api/auth/*` handler** (`app/api/auth/[...all]/route.ts`), which returns the cookie with the refreshed row so the two stay in step. Any endpoint there that resolves a session can do it (`/get-session`, authorize/consent, passkey, two-factor, …); the one the app relies on is `/get-session`, called by `SessionKeepAlive` (`lib/components/session-keep-alive.tsx`, via `refreshAuthSession` in `lib/client/session.ts`). It is mounted in the signed-in branch of `app/(timeline)/layout.tsx` and refreshes on mount, then at most once per `SESSION_REFRESH_INTERVAL_MS` while the tab is visible — on a timer, because the layout stays mounted across client-side navigation and a window that is never hidden fires no `visibilitychange`, and when the tab becomes visible again.
- Don't add a server-side session read that refreshes. That covers every `auth.api.*` call that resolves a session — not only `getSession`, but any endpoint behind better-auth's `sessionMiddleware` / `getSessionFromCtx` (e.g. `auth.api.getOAuthConsent`, `auth.api.listPasskeys`), which refreshes a due session the same way. Called outside better-auth's handler, such a call passes `disableRefresh: true` where the endpoint accepts it, or runs in a route handler that returns better-auth's `Set-Cookie` to the browser (`asResponse` / `returnHeaders`); a Server Component can do neither, so it must use `getServerAuthSession`. `lib/services/auth/sessionRefresh.test.ts` drives the real instance and checks both halves: a server-render read leaves a due session untouched, and `/get-session` extends it and re-issues the cookie.

<a id="agents-oauth-client-registrations"></a>

### OAuth Client Registrations

- **Never delete or expire rows in `oauthClient`.** Registrations created through `POST /api/v1/apps` are durable. Mastodon-API clients (Phanpy, Elk, Tusky, …) persist the `client_id`/`client_secret` they get from that endpoint indefinitely and only re-register when their stored copy is **missing** — so deleting a registration permanently wedges every client still holding it: it keeps presenting a `client_id` this server no longer knows and has no way to learn it must register again. A time-based cleanup does not help, because any finite TTL eventually deletes a live cached client. Mastodon hit exactly this and **removed its own application "vacuuming" in 4.3**. (A 24h "stale registration" collector used to live in `createApplication.ts` and broke Phanpy sign-in for this reason — the failure surfaced as `invalid_client` / `client_id is required`.) The trade-off is that abandoned registrations accumulate: `createApplication`'s per-source throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so a default deployment does not bound them. Accept that, or add a guard that **rejects writes** — never one that deletes registrations.
- **A registration must write `oauthClient.clientCredentialsScopes`, and that is not the same column as `scopes`.** better-auth 1.6 validated a `client_credentials` request against the client's registered `scopes`; 1.7 moved the decision to this separate, server-owned column and denies the grant outright when it is missing or empty — `400 unauthorized_client` / `client has no authorized client_credentials scopes`. The column arrived with the 1.7 schema migration and nothing ever wrote it, so every application on the instance was refused an app token — and a native Mastodon client asks for one **before** it offers to sign a user in (Ivory does, with the credentials `POST /api/v1/apps` just handed it), so the login never started and the only sign of it was that 400 in the token proxy's log. `createApplication` writes the column through `toClientCredentialsScopes` (`lib/services/oauth/clientCredentialsScopes.ts`); that module documents the derivation rule, why its reserved-scope filter is the only thing enforcing it on this path, and how it differs from 1.6 — read it there rather than re-deriving it, and do not simplify the filter away. Fixing the write path is **not sufficient on its own**: registrations are never deleted and clients cache their credentials indefinitely (see the bullet above), so every client already installed would stay wedged — `20260828000000_backfill_oauth_client_credentials_scopes` repairs the existing rows, carrying a second copy of the reserved list because a migration runs through the plain `knex` CLI with no TypeScript loader and no path aliases (`lib/database/sql/oauthClientCredentialsScopesMigration.test.ts` pins the two against each other), plus two gates of its own that refuse public clients and clients not registered for the grant. This grants no new authority: an app token has no user, so only `OAuthAppGuard` accepts one — `apps/verify_credentials` and Mastodon's API account registration, itself gated on `registrations.open` — and every other guard requires an actor that an actor-less token never resolves.
- **An app token lives one hour, not the 7-day sliding window `accessTokenExpiresIn` configures.** It does not slide either (see [OAuth Access Token Sliding Expiry](#agents-oauth-access-token-sliding-expiry)). `createUserTokens` reads `m2mAccessTokenExpiresIn` for a grant with no user and this server does not set it, so better-auth's 3600s default applies. Unrelated to the scope ceiling above; it is the other thing about app tokens that reads wrongly from `auth.ts`.
- **An unknown `client_id` must fail at `/oauth/authorize`, not be forwarded to Better Auth.** Better Auth's authorize endpoint answers an unregistered client with `invalid_client` / **`client_id is required`** — the same message it uses for a genuinely absent `client_id`, which makes the failure very hard to read — and then redirects to the error page, so a failed login used to look like it silently did nothing (before `onAPIError.errorURL`, better-auth's own `/api/auth/error` 302'd straight on to the home timeline in production — see **Auth Error Page** below). `app/(nosidebar)/oauth/authorize/page.tsx` validates the client (and its `redirect_uri`) up front and returns `notFound()`; keep that check ahead of the Better Auth delegation. Per RFC 6749 §4.1.2.1 an invalid `client_id`/`redirect_uri` must be reported to the user rather than redirected to the requested `redirect_uri`.

<a id="agents-oauth-access-token-sliding-expiry"></a>

### OAuth Access Token Sliding Expiry

- **A user's opaque access token lasts as long as its client keeps using it.** better-auth issues it with `accessTokenExpiresIn` = `OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS` (7 days, `lib/services/auth/constants.ts`), and every bearer guard — `OAuthGuard`, `OAuthGuardAnyScope`, `OptionalOAuthGuard` and `OAuthAppGuard` — slides `expiresAt` to now + that window when it accepts a request (`extendAccessTokenIfDue` in `lib/services/guards/OAuthGuard.ts`). The token lapses a full window after its last slide — so between 6 and 7 days after its last accepted request, because a request inside the once-a-day slide interval below does not write.
- **The slide is the only thing keeping any OAuth client signed in.** This server cannot issue refresh tokens: better-auth mints one only for the `offline_access` scope, which is not in this server's scope vocabulary. Mastodon clients would not use one anyway — Mastodon's own tokens never expire, so Ivory, Ice Cubes, Tusky, Phanpy, Elk and the rest store the token once. A fixed lifetime therefore signs every client out on schedule: the first request after `expiresAt` is a `401` (`token_expired`), which a client reads as "this account is gone". The pre-better-auth OAuth server's `tokens` table had a sliding session; the move to better-auth's `oauthAccessToken` dropped it, and from then on every client was signed out seven days after authorizing, however active it was. With releases going out several times a day that looked like each deploy logging the apps out — no deploy-time code path touches these rows. Don't remove the slide.
- **The `refresh_token` grant is neither advertised nor served.** `OAUTH_GRANT_TYPES` (`lib/services/auth/constants.ts`) is the single list behind better-auth's `grantTypes` (so `POST /oauth/token` answers `grant_type=refresh_token` with `unsupported_grant_type`), the `grantTypes` a new `POST /api/v1/apps` registration records, and `grant_types_supported` in both `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`. Advertising a grant no client can ever be issued sends discovery-driven clients after a token that never comes. Registrations written before the change still list `refresh_token` in `oauthClient.grantTypes`; leave them (see [OAuth Client Registrations](#agents-oauth-client-registrations)) — better-auth checks a client's `authorization_code`/`client_credentials` grant per request, which those rows still list, and the only path that re-validates a stored registration against the server list (its update-client endpoints) is unreachable for them. Supporting refresh tokens means adding `offline_access` end to end — scope vocabulary, consent, the reserved-scope filter in `clientCredentialsScopes.ts` — and adding the grant back here, not just re-advertising it.
- **Only a request the guard accepts slides the token.** `resolveTokenContext` checks the row, expiry and scope and hands back what the slide needs; each guard applies it only after its actor, moderation and confirmation checks pass. A token refused for scope or expiry, one whose actor no longer exists, and a suspended account's client polling into `403`s are never extended — otherwise the token would outlive the suspension.
- **Only user tokens on the opaque path slide.** App (`client_credentials`) tokens have no `userId` and keep better-auth's one-hour `m2mAccessTokenExpiresIn`; a JWT access token's `exp` is signed into the token and cannot be moved.
- **It writes at most once a day per token.** The guard only updates a row that has been in use for `OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS` since it was issued or last extended, through `database.extendOAuthAccessToken` (keyed on the token hash). A failed write is logged and the request still succeeds; the row is still due, so the next request retries.
- **Deleting a token is what ends it.** Signing an app out in Settings → Connected apps and `POST /oauth/revoke` delete its rows, so a slide racing a revoke matches nothing. better-auth's soft revocation — the `revoked` column its session-delete hook stamps on tokens minted from a web session that is signed out or expires — is deliberately not honoured, by the guard or by the slide: as on Mastodon, signing out of the web does not sign apps out (see `detachOAuthTokensFromSessions`). Honouring it would bring the weekly sign-out back for most clients.
- **Every path that mints a user token uses the same window.** better-auth's grants read it through `auth.ts`; `issueAccessToken` (the token `POST /api/v1/accounts` hands back) reads it directly.

<a id="agents-auth-error-page"></a>

### Auth Error Page

- **Failed auth/OAuth requests land on our own `/auth/error`, never better-auth's `/api/auth/error`.** `lib/services/auth/auth.ts` sets `onAPIError.errorURL` to `AUTH_ERROR_PATH` (`lib/services/auth/constants.ts`), and `app/(nosidebar)/auth/error/page.tsx` renders it. Better-auth's built-in page is a development affordance: in production it does not render at all — it 302s to `/?error=...&error_description=...`, so a client presenting a `client_id` this server no longer knows just landed on the home timeline and its sign-in appeared to do nothing.
- **`AUTH_ERROR_PATH` is root-relative on purpose.** Better-auth copies the value straight into the `Location` header (`ctx.redirect` and `formatErrorURL` do no resolution), so a relative path keeps the visitor on the host the request arrived on. An absolute URL built from `getBaseURL()` would bounce a login started on a trusted alias domain over to `ACTIVITIES_HOST` mid-flow, the same trap `/oauth/authorize` avoids by building its sign-in redirects from the request host.
- **Never render `error_description`, and render the `error` code only when it is allow-listed.** Both are free text better-auth puts in the query string, and anyone can hand-craft a link to `/auth/error` with any value in either — prose we did not write, shown on our own auth card, is a ready-made phishing surface. Token-shaped is **not** sufficient: `?error=Account-locked-please-call-1-800-555-0100` clears `sanitizeAuthErrorCode`'s character class and 64-char cap while reading as ordinary prose, so the technical-detail line is gated on `isKnownAuthErrorCode` (`lib/services/auth/errorPage.ts`), never on `sanitizeAuthErrorCode` alone. Copy comes from `resolveAuthErrorContent`, with generic fallback copy for anything unmapped. **The allow-list gates rendering only — never logging.** Both the code and the description are logged whatever the code is. Allow-listing bounds nothing in the log (a caller can pair any description with a mapped code; the 200-character description cap and 64-character code cap are the real bounds), and an unmapped code is the case the description matters _most_ for: better-auth's own `/error` endpoint rewrites any code it cannot classify to `UNKNOWN` while forwarding the real description verbatim, and an upgrade can add a rejection we have no copy for. Gating there would blank the description for exactly those, and blunt the tell a description carries: every oauth-provider rejection passes one, so a missing description on an authorize-time code suggests a hand-crafted link — a tell that holds for that class only, since core's `INVALID_TOKEN` redirect legitimately carries none. Codes are looked up with `Object.hasOwn` — a bare lookup answers `constructor`/`toString` with an inherited function, which is truthy and would render an empty card.
- **The redirect behaviour is pinned end-to-end by `lib/services/auth/errorURL.test.ts`**, which drives the real better-auth handler against in-memory SQLite and asserts the `Location` header — not the shape of `auth.options`. Assert with `startsWith`, never `toContain`: the untouched default `/api/auth/error?…` _contains_ `/auth/error?…` as a substring and would pass with the option removed.
- **Do not add `onAPIError.onError` expecting it to see these failures.** Better-auth's router short-circuits `onError` for anything it redirects (`if (isAPIError(e) && e.status === 'FOUND') return`), which is exactly this class of error, and setting `onError` at all suppresses better-auth's own built-in logging. The error page logs what it renders instead.
- **`access_denied` and `invalid_scope` do not come here.** Both are reported to the client's `redirect_uri` (`formatErrorURL(query.redirect_uri, …)`, with no `getErrorURL` call site for either) per RFC 6749 §4.1.2.1; they are mapped on the page only for a client that forwards the code back by hand. Keep `auth.ts`'s comment and `errorPage.ts`'s map agreeing on which codes are actually reachable.
- **If `socialProviders`, `sso()` or `genericOAuth()` are ever added, also pass `errorCallbackURL` per flow** (`authClient.signIn.social({ provider, errorCallbackURL: '/auth/error' })`). `onAPIError.errorURL` is only the default for provider-callback failures; the per-call value is persisted in the OAuth state and wins over it. This instance configures no social providers today, so that path is currently unreachable.

<a id="agents-oauth-grants-must-resolve-an-actor"></a>

### OAuth Grants Must Resolve an Actor

- **Every OAuth grant issued for a user must record an actor, and every code path that resolves "which actor is this account?" must use `selectAccountActor` (`lib/utils/selectAccountActor.ts`).** Better Auth stores the value `postLogin.consentReferenceId` returns as `oauthAccessToken.referenceId`, and `OAuthGuard` reads that column back as the acting actor — so a grant that resolves to nothing mints a token that **401s on every bearer-authenticated route**, `/oauth/userinfo` included, which fails an OIDC login outright (the relying party 500s on the userinfo call, and the user just bounces through the login loop).
- `accounts.defaultActorId` is **not** a reliable answer on its own: it is only written when a user explicitly picks a default actor, so most accounts have `NULL` there while still owning actors. `resolveConsentReferenceId` (`lib/services/auth/consentReferenceId.ts`) therefore falls back the same way the browser session does — session `actorId`, then default actor, then the first actor not pending deletion.
- This failure is **invisible on a first login and permanent afterwards**: approving the consent screen persists the session actor first (via `/api/v1/actors/switch`), so the initial grant works. Once consent is stored, Better Auth stops showing the consent screen, and every later login on a fresh session issues an actor-less token. Any change here must be exercised with a **second** login, not just the first.
- `OAuthGuard` keeps a matching fallback: a token with a `userId` but no `referenceId` resolves that account's actor rather than failing closed, so tokens issued while a grant was broken recover without the client re-authorizing. Genuine app (`client_credentials`) tokens have neither a user nor an actor and stay actor-less.
- Guard rejections log a `reason` through `oauthLogger` at **debug** level (`token_expired`, `insufficient_scope`, `no_actor_for_token`, …). Bearer failures are otherwise indistinguishable in production — every one is a bare 401. Set `LOG_LEVEL=debug` to tell them apart, and keep new rejection branches logging a reason. Never log the token.
- **A handler asks whether a token is an APP token by reading `userId`, never `currentActor`.** `OAuthAppGuard` leaves `currentActor` null in two unrelated cases: a genuine `client_credentials` token that has no user, and a user-delegated token whose actor it merely FAILED to resolve — the grant recorded no `referenceId` (see the fallback above) and `resolveAccountActorId` found no selectable actor, which happens when every actor the account owns is pending deletion (`selectAccountActor` skips those). `registerViaApi` gated on `currentActor || !client` and so accepted that user as an app, letting them mint accounts and tokens. The guard therefore forwards `userId` on the handler context, and the route requires `userId === null`; a genuine app token has neither a user nor an actor. Do not re-derive "is this an app token" from the actor.

<a id="agents-an-unconfirmed-account-may-not-act"></a>

### An Unconfirmed Account May Not Act

- **An account whose confirmation e-mail has not been clicked is refused with 403 on every surface behind the OAuth guard family, `AuthenticatedGuard`, and `AdminApiGuard` — bearer and cookie alike — and `isActorConfirmationPending` (`lib/services/guards/OAuthGuard.ts`) is the check.** This is Mastodon's `require_user!` rule ("Your login is missing a confirmed e-mail address"), and it matters because `POST /api/v1/accounts` hands out a real 7-day user access token the moment an account is registered. `POST /api/v1/apps` is unauthenticated and its throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so without this an anonymous party could script fully usable accounts — posting, uploading, following, federating — for addresses nobody has proven they control. **The gate exists only where `config.email` does:** with no e-mail configured `registerAccount` mints no `verificationCode` and `createAccount` writes the account pre-verified, so registration still hands out a working token exactly as before. That is inherent — an instance that cannot send mail cannot demand confirmation — but it means this mitigation is conditional on an optional setting. The token is still issued, exactly as Mastodon issues it; what changes is that it is not a working credential until the address is confirmed. `OAuthGuard`, `AuthenticatedGuard`, and `AdminApiGuard` enforce `isActorModerationBlocked` and `isActorConfirmationPending`, answering 403 when an actor is suspended or its account is disabled or unconfirmed.
- **Confirmation is read from `verificationCode` AND `emailVerified`, never from `verifiedAt`, and none of that is a style choice.** `verificationCode` says a code is outstanding; `emailVerified` is better-auth's own column, which `requireEmailVerification` has gated credential sign-in on since 2026-03-20. An account better-auth already treats as verified is not held pending here either — that grants nothing new and is what grandfathers the cohort the buggy backfill created (below). `accounts.verifiedAt` originally carried `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`, dropped in `drop_accounts_verifiedat_default`), so `createAccount` could not leave it unset by omitting it: the database stamped `now()` on every pending registration, and `canCreateSessionForAccount`'s `verifiedAt` test has consequently **never fired**. A check keyed on `verifiedAt` is a no-op that reads as a working gate. `createAccount` now writes an explicit `verifiedAt: null` for a pending registration, so that column is accurate for anything created from here on — but rows written before that still carry the default, so `verifiedAt` covers nothing on its own and the other two columns carry the whole answer. `verificationCode` is set once at registration, cleared to `''` by `verifyAccount`, and never set at all on an instance with no e-mail configured.
- **The credential sign-in path was never open FOR AN ACCOUNT REGISTERED AFTER 2026-03-20, which is why this is mostly a token-path fix.** better-auth's own `emailAndPassword.requireEmailVerification` reads `accounts.emailVerified` — a different column, which `createAccount` correctly leaves false — and answers `403 EMAIL_NOT_VERIFIED`. **Older accounts are the exception, and it is not a small one:** `20260320072514_better_auth_columns` populated that column with `whereNotNull('verifiedAt')`, and `verifiedAt` was non-null for every row because of the same default, so the backfill declared EVERY account of that era verified — pending ones included. Those accounts have been signing in with a password ever since. That cohort is grandfathered by the predicate itself, which reads `emailVerified`, so the guard never refuses an account that has worked for months. `20260828140000_clear_stale_verification_codes` then brings the two columns into agreement so a reader of the row is not misled — it is a TIDY-UP, not the mechanism, and its bound decides only whether a stale row is tidied, never whether anyone keeps access. Two earlier attempts to make that bound the mechanism were wrong in opposite directions (a filename timestamp no deployment coincides with; then a batch comparison that is also true whenever the migration is merely first in a new pass), which is why the predicate carries it instead. Do not read the sentence above as covering the whole account table. Both columns are on the domain `Account`, and the guard reads both — that pairing IS the mechanism, not an accident to be simplified away. Removing `emailVerified` from either the schema or the predicate re-locks out the cohort with no way back, which is why this is written as an instruction rather than a description.
- **`unconfirmedAccount: 'allow'` is the one carve-out that lets an unconfirmed account act AS ITSELF, and it exists for exactly one endpoint.** `POST /api/v1/emails/confirmations` resends an account's own confirmation e-mail, so refusing it for being unconfirmed makes the state unrecoverable for a client that lost the message — Mastodon carves out the same controller (`Api::V1::Emails::ConfirmationsController` never calls `require_user!`). It relaxes the confirmation test and **nothing else**: `isActorModerationBlocked` still runs, so a suspended actor or a disabled account is refused there too, and the handler applies `isAccountConfirmationPending` itself. That handler check must be the PREDICATE, never the raw `verificationCode` column: the two disagree for the backfilled cohort, and because this route is bearer-reachable with `write` while the flow that proves an address is cookie-only, reading the raw column let a client token re-point a confirmed account's address and take the account over. The guard admits any account here; the handler alone decides, on the signal every other surface uses. Do not add a second consumer without the same argument.
- **`allowModerationBlocked` is the carve-out on `AuthenticatedGuard` for restrictive session and connected-app revocations.** `DELETE /api/v1/accounts/sessions`, `DELETE /api/v1/accounts/sessions/[id]` (keyed by `sessions.id`, never the session token, which is the cookie credential and must not reach a URL, a trace or the browser), and `DELETE /api/v1/accounts/connected-apps/[clientId]` pass `allowModerationBlocked: true` so a legitimate account owner can terminate attacker sessions and revoke authorized OAuth apps during compromise containment even if the account is disabled or an actor is suspended. Revocation only ever _reduces_ capability (destroying sessions and tokens) and cannot post, follow, or federate on the platform. It relaxes `isActorModerationBlocked` only; CSRF same-origin proof and `isActorConfirmationPending` remain strictly enforced (unconfirmed accounts are still refused with 403).
- **Account-level actor endpoints (`actors/switch`, `actors/cancel-deletion`) authenticate the session's account directly rather than fronting an arbitrary `currentActor`.** `POST /api/v1/actors/cancel-deletion` operates on the target `actorId`, so gating on the session's selected actor would 403 whenever another actor on the same account is suspended (and fail if the only active actor is pending deletion). Like `switch`, it validates same-origin CSRF proof, resolves the account via `getAccountFromSession`, enforces `isAccountConfirmationPending`, and checks that the account owns `actorId`. It also refuses (403) when the **target** actor is suspended: the admin hard delete (`DELETE /api/v1/admin/accounts/:id`) requires suspension, marks the actor `scheduled` and only then enqueues the job, which exits if the status is no longer `scheduled` — so a suspended owner cancelling would win that race and undo the moderator's decision. A disabled account, or a different suspended actor on the same account, does not block it.
- **`OptionalOAuthGuard` neither refuses nor accepts such a token — it DOWNGRADES it to the anonymous path** (`unconfirmedAccount: 'anonymous'`), which is a third answer and not a second use of the carve-out. Both alternatives are wrong there. Refusing made presenting a valid token FAIL a public read — `timelines/public`, `statuses/:id`, search — that succeeds with no `Authorization` header at all; a token must never make a request worse than sending none. Accepting the actor hands an unverified account real capability rather than "just public reads": `canActorReadSingleStatus`'s `isDirectRecipient` lets it read direct messages addressed to it, and `search`/`accounts/lookup` gate `resolve=true` on a non-null actor, so it can drive outbound WebFinger and signed remote fetches from this instance. **Mastodon is not a precedent for granting those** — its search controller applies `require_user!`, so an unconfirmed account never reaches `resolve` there, even though `authorize_if_got_token!` is otherwise the model for this guard. Suspension stays global on the same guard, so `isActorModerationBlocked` still refuses.
- **The check costs no query.** `verificationCode` is already on `actor.account` in both resolution paths — `getActorFromId` loads the account row for the bearer path and `getActorsForAccount` does for the cookie path — which is the same reason `isActorModerationBlocked` can read `account.disabledAt`. An actor with **no** account is left alone, the direction `isActorModerationBlocked` also fails in; the only accountless local actor is the federation signing actor, which never authenticates.
- **`Account.verifiedAt` is `.nullish()`, not `.optional()`, and `SQLAccount.verifiedAt` is nullable to match.** Both row-to-domain mappers hand the column through as a literal `null` (`getActor` writes one explicitly; `toDomainAccount` spreads the raw row, whose conditional override is a no-op for null), so under `z.number().optional()` `Actor.parse` threw the moment the column really was null — the first request by an unconfirmed actor would have 500'd rather than loading. The column default is what had been hiding that.
- **Existing accounts are grandfathered by the PREDICATE — `isAccountConfirmationPending` reading `emailVerified` — not by the migration and not by leaving `verifiedAt` alone.** Nothing backfills `verifiedAt` — so on its own the `verificationCode` half of the check still reaches every legacy pending account, and for the pre-2026-03-20 cohort described above that meant losing a working password login with no way back (the resend endpoint needs a credential, which is what is being refused). `isAccountConfirmationPending`'s `emailVerified` half is what actually grandfathers them; the migration only tidies the row. For an account registered after that date, the only tokens the gate withdraws are ones minted through the hole being closed — `registerViaApi` is the sole path that mints a user token for an unconfirmed account, since credential sign-in is refused and the authorize flow needs a session.
- **The `verifiedAt` column default is dropped (`drop_accounts_verifiedat_default`).** The migration uses knex `.alter()`, which rebuilds the table on SQLite. All **seven** tables carrying a foreign key to `accounts` on both backends (`actors`, `oauthClient`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `passkey`, `twoFactor`) and all four indexes on `accounts` are preserved across the rebuild (`dropAccountsVerifiedAtDefaultMigration.test.ts` pins column definitions, FK preservation, cascade rules, and index preservation). Count these referencing tables by matching case-insensitively and on both quoting styles: `actors` is emitted as `CREATE TABLE IF NOT EXISTS "actors"` with uppercase `REFERENCES`, so a grep written for backticks and lowercase silently reports six. Existing rows were deliberately NOT backfilled: accounts created before the explicit-null fix keep their defaulted value so confirmed status is not altered retroactively.

- **A re-point clears every proof about the old address, in the same write.** `repointUnconfirmedAccountEmail` writes the rotated code, `emailVerified: false`, `verifiedAt: null` and `emailVerifiedAt: null` together, because each proves control of the address it was set for and none may outlive it. The state change is a predicate on the UPDATE statement (`verificationCode` non-empty, `emailVerified` false/null) rather than a decision taken from a read in front of it, and the method re-reads the row to return `Account | null` so the caller distinguishes "no such account of yours" (404) from "no longer pending" (403). Clearing the code alone is not enough for the backfilled cohort: those rows are not pending (the predicate reads `emailVerified`), so a re-point moved their address to an arbitrary one while they stayed verified, and BOTH OIDC surfaces then asserted a verified address to any relying party that links accounts on the claim. They did so by different routes, and the difference is the whole reason clearing the flag works: the id_token (`lib/services/auth/auth.ts`) reads `emailVerified` and asserted it directly, while `/oauth/userinfo` read `verifiedAt` until round 6 moved it — so it was never the flag that made that route answer, it was that such a row is NOT pending (`Boolean(code) && !emailVerified` is false while the flag stands), so the guard admitted the request at all. Clearing the flag closes both: it makes the account pending, and `isActorConfirmationPending` then 403s before the serializer runs. Do not read "userinfo did not read the flag" as "userinfo was unaffected" — that inversion was written here once and is what this sentence replaces. Two costs are named rather than hidden. The confirmations route writes before it sends and answers 500 on a send failure, so a genuinely pending account whose mail fails at that moment must resend to recover. (A backfilled-cohort account cannot reach that write at all — the handler 403s it — so this cost is not theirs.) And `verifyAccount` restores `verifiedAt`, `emailVerified` and `emailVerifiedAt` when the new address is confirmed, so an account that re-points an unconfirmed address recovers every verification proof — including the `/account` "Verified" badge — upon confirmation.

<a id="review-runtime-vs-build-time-configuration"></a>

### Review: Runtime vs. build-time configuration

- No `ACTIVITIES_*` or `OTEL_EXPORTER_*` reads outside `lib/config/`, and no env
  var name constants defined elsewhere — callers import a config utility instead.
- `next.config.ts` stays a thin entrypoint and must not _read_ runtime deployment
  config — directly or via `images.remotePatterns`, `headers()`,
  `allowedDevOrigins`, webpack config, or `generateBuildId`. Those constructs are
  fine as long as they consume only build-safe values (delegate to `lib/config/`
  helpers, as the committed config does); the build must still succeed with
  `ACTIVITIES_*` missing. Don't define reusable helpers/parsers/constants here —
  move them to `lib/`. Build-only flags (`NODE_ENV`, `BUILD_STANDALONE`,
  `NEXT_TELEMETRY_DISABLED`) are fine to read.
- Runtime config that affects browser-visible behavior (CSP, security headers,
  host redirects, upload origins) lives in request-time server code, not static
  Next config.
- A build must succeed with `ACTIVITIES_*` missing or set to placeholder values.
  Changes to runtime-config handling should ship a regression test asserting the
  build config does not consume those values.
- Optional external SDKs, email providers, and database drivers
  (`@google-cloud/tasks`, `@upstash/qstash`, `nodemailer`, `resend`,
  `@aws-sdk/client-ses`, `pg`) must reside in dedicated workspace packages under
  `packages/*` and be imported dynamically (via `dynamicImport` with type stubs
  in `lib/types/optional-modules.d.ts` for queue and email SDKs, or Knex dynamic
  driver loading for database clients), never through static top-level imports in
  core `app/` or `lib/` modules, so minimal standalone builds run without them.

<a id="review-client-components-data-flow"></a>

### Review: Client components & data flow

- React components never call `fetch()` directly — every client→server call is a
  named, typed, exported function in `lib/client/<domain>.ts` re-exported from `lib/client.ts`,
  imported from there.
  (Lint-enforced; the frozen legacy exception list in `.oxlintrc.json` must
  only ever shrink.)
- Server Components never pass `new Date()` to a Client Component. Pass
  `Date.now()` (a `number`); the client takes `currentTime: number` and builds
  `new Date(currentTime)` itself.
- A `<Link>` rendered once per feed/list row passes `prefetch={false}`. `<Link>`
  prefetches on viewport entry, so in an infinite-scroll feed that is one RSC
  request per row — against dynamic routes that also federate out for
  unpersisted remote actors. Navigation chrome (sidebar, sub-nav, pagination)
  keeps prefetching. See **Link prefetching in feeds** in `AGENTS.md`.
- Client Components that render relative timestamps (or fan out to `Posts`/`Post`)
  never call `Date.now()` / `new Date()` during render — they receive and forward
  `currentTime` from the server to avoid hydration mismatches.
  A post header shows the compact form from `formatCompactRelativeTime`
  (`lib/components/posts/compactRelativeTime.ts`: `now`, `35m`, `2h`, `3d`, `2w`,
  `4mo`, `1y`) — a pure difference, so no time zone or locale can make the server
  and the browser disagree — while the timestamp button's accessible name keeps
  the spelled-out `posted 5 minutes ago`. Notifications, sessions, the
  edit-history panel and quote cards print date-fns' `formatDistance`, and the
  fitness heatmap chrome prints `formatRelativeTime`
  (`lib/fitness/relativeTime.ts`).
- A Client Component that prints a clock time or date in the viewer's own time
  zone renders a zone-fixed value (UTC) until `useHasHydrated`
  (`lib/hooks/useHasHydrated.ts`) turns true, then the local one. The server
  cannot know the viewer's zone, and `suppressHydrationWarning` only silences
  the mismatch — React keeps the server's text, so the reader never sees their
  local time. The fitness activity detail page's `ActivityStartTime` is the
  reference; its test hydrates server HTML under `withTimeZone`. A formatter
  that follows the viewer's locale as well (`Intl.DateTimeFormat(undefined, …)`,
  `toLocaleString(undefined, …)`) pins the locale too until then, because the
  server's default locale is no more the reader's than its zone is. That
  pre-hydration value must come from a formatter that is identical in every
  engine — date-fns `format` on a `UTCDate`, as `useMessageTimeFormat`
  (`app/(timeline)/messages/useMessageTimeFormat.ts`) does for the
  direct-message list and bubbles — not from `Intl` with a fixed locale, whose
  output varies with the engine's ICU (Safari renders `Oct 4 at 3:05 PM` where
  Node renders `Oct 4, 3:05 PM`) and would mismatch on hydration. Build the
  reader-locale `Intl.DateTimeFormat` once per component (`useMemo`), not per
  render. A date that only appears after a client-side fetch (the announcement
  banner and the admin announcements list) is never in the server HTML, so it
  needs neither.
- Status posts render through the shared `Posts`/`Post` components with the same
  action set on every surface. A page turns actions on with `currentActor` +
  `showActions`; it must not pass per-status action callbacks (`onReply`/`onQuote`/
  `onEdit`), hide individual actions, or build a bespoke post/action row.
  Reply/quote/edit use the shared `InlineStatusComposer`; pages pass only
  data-sync callbacks (`onStatusCreated`/`onPostUpdated`/`onPostDeleted`/
  `onLikeChanged`/`onBookmarkChanged`/`onReactionsChanged`) and
  `isMediaUploadEnabled`. See **Status Posts & Actions** in `AGENTS.md`.
  The edit-history panel lists prior revisions newest-first and labels each
  transition to the following version, including text, image or attachment,
  content-warning, sensitivity and poll-option changes. Its relative time is
  the transition time. Blank prior text is shown as **No text in this version**;
  missing or malformed prior text is shown as **Previous text is unavailable**.
  Incomplete legacy snapshots are called out as unavailable rather than guessed.
  - Two **detail** surfaces are the standing exception, and they are not feeds:
    `StatusBox` and `FitnessStatusDetail` each render a single post and drive the
    shared `useInlineComposer`/`InlineStatusComposer` themselves, so they do pass
    `editable` + `onEdit` + `onQuote`. That is the shared layer doing the wiring,
    not a page opting into per-status callbacks — a _feed_ passing them is still
    the defect this rule is about.
  - A surface may **add** a `⋯` item for something only it knows about the post,
    via `Actions`' `extraMenuItems` (today: the fitness detail's "Change gear"
    submenu). An extra item is either one action or a submenu of pick-one
    choices, it renders after any items a compact row displaced into the menu,
    and there is deliberately no prop for removing or replacing one of the
    menu's own items — flag any attempt to add one.
- **Timeline grouping and nested status threads.**
  - `TimelineFeed` (`lib/components/posts/timeline-feed.tsx`) renders grouped home timelines, connecting related posts into visual threads and multi-author conversations with accessible badges, compact collapsed middle runs for long chains, and an optional boost carousel (`BoostCarousel`).
  - Reply context follows the displayed original post for boosts, including nested boosts. `getTimelineContext` resolves stored parents through the same readability, block, mute, and content-warning rules as ordinary replies. A readable parent gets an author/snippet preview; when no permitted parent preview is available, the feed shows "In reply to a post". This fallback alone does not identify whether the parent is missing or restricted.
  - `StatusThread` (`lib/components/posts/status-thread.tsx`) renders post detail conversation trees, structuring ancestors root-to-parent and nesting descendants by direct reply edges with author-continuation promotion and branch collapse controls.
  - Replying from any feed row or nested thread status targets the selected post's ID, preserving mentions and recipient audience without flattening threads or redirecting replies to the root.
- **Composer vertical sizing & auto-growth.** Both the main composer (`PostBox`,
  used standalone on timelines and for quotes/edits) and the reply composer
  (`StatusReplyBox`, used for inline replies and fitness activity comments)
  automatically grow vertically with typing, wrapped lines, newlines, and pasted
  text while preserving caret positioning, focus, and existing controls:
  - Sizing classes on the message textareas: `field-sizing-content min-h-[72px]`
    (or `min-h-[60px]` for replies) `max-h-[min(320px,40dvh)] overflow-y-auto`.
  - Browsers supporting CSS `field-sizing: content` (Chrome 123+) size the
    textareas natively without JavaScript intervention.
  - For browsers lacking native `field-sizing: content` support (such as Safari and
    Firefox), the shared `useAutoResizeTextarea` hook
    (`@/lib/hooks/useAutoResizeTextarea`) provides a measured-height fallback that
    updates `element.style.height` based on `scrollHeight` on mount, input, value
    changes, and container width changes, while preserving `scrollTop` so internal
    scrolling does not jump. It adds the element's own border
    (`offsetHeight - clientHeight`, 0 for the borderless composers) to the
    measured `scrollHeight`, because a `border-box` textarea's `height` includes
    its border and `scrollHeight` does not: a bordered box fitted without it is
    2px short and scrolls its last line away. The share dialog's read-only
    snippet box on the heatmap page (`HeatmapShareEmbed`) is the bordered caller;
    it uses this hook with the shared `Textarea`'s own `field-sizing-content`
    rather than a hook of its own.
  - Height is capped at `min(320px, 40dvh)`. On extremely short viewports, CSS
    `min-height` takes precedence over `max-height`. Textareas scroll internally
    after reaching the cap and shrink smoothly back to the minimum height when text
    is deleted or draft-reset clears the content.
- The reaction chips and the action row are both full-bleed (`-ml-13`), and the
  action row packs every action into one `gap-1` cluster at the post's left edge
  with only the `⋯` menu pushed right by an `ml-auto` on its wrapper. That auto
  margin is what does the work — flexbox feeds free space to auto margins before
  `justify-content` sees it, so it beats any `justify-content` the row might
  carry — and the row therefore keeps none of its own. Dropping the margin
  collapses `⋯` into the cluster; a `justify-between` without it spreads all
  five actions across the full width. Each row carries its own
  `fullBleed` prop and they default differently — `Actions` pulls unless told
  not to, `ReactionRow` only when asked — so a surface with no avatar column to
  pull back over (the fitness activity detail's card) correctly has neither.
  The row still gets the full width of its container — the spacing between
  actions is a width-independent `gap-1`, but `⋯` needs the post's right edge
  to sit on. The edit-history
  panel is anchored to the row (its trigger's wrapper is deliberately not
  `relative`) and sits `right-0`, flush with the post's right edge — anchored to
  the trigger, its 25rem width starts wherever the counts push that trigger and
  the post's card clips the overhang. The picker trigger lives
  in the action row (`ReactionButton`), not beside the chips, and both halves
  share one `useReactionState`; `useBookmarkState` is held by `Actions` for the
  same reason. A row narrower than 400px — measured by `ResizeObserver` on the
  row itself, never a viewport breakpoint — hands bookmark and react to the `⋯`
  menu, and a menu item opening a focus-taking surface uses `deferUntilClosed`
  (which also suppresses Radix's focus restore). A control that moves into the
  menu keeps a `disabled` state while its write is in flight and still surfaces
  its error from the row, absolutely positioned so it adds no flex item.
- Settings/account forms are client components that POST JSON and show inline
  success/error, not HTML `<form method="post">` with server redirects; the route
  returns JSON via `apiResponse()`.
- Server-only code (`app/api/`, `lib/services|actions|jobs|database|config`)
  never imports a **runtime value** from a `'use client'` module — on the server
  it resolves to a client reference, so a constant read out of it is empty and no
  test can see it (`lib/clientModuleBoundary.test.ts` enforces this).
  Type-only imports are fine; `export … from` re-exports are not. Shared
  constants live in a dependency-free module both sides import. See
  **Server/Client Module Boundary** in `AGENTS.md`.
- Client authoring UI reads admin-configured limits from `useInstanceLimits()`
  rather than hardcoding a constant, and new authoring/upload surfaces render
  under `InstanceLimitsProvider`. The limits are still enforced server-side. See
  **Instance Limits in Client Components** in `AGENTS.md`.
- Validate any user-controlled URL before using it as an `href`: parse with
  `new URL()` and allow only the `http:` or `https:` protocols — not a `startsWith`
  or regex check — so a `javascript:` (or other) scheme can't become a DOM-XSS
  sink (see `lib/utils/fitness.ts`).
- Fitness gear distance stays **derived**, never cached in a column, and every
  rollup reuses the same completed/primary/not-deleted predicate as
  `getFitnessActivitySummary` so the numbers reconcile across surfaces. Sport
  matching goes through `normalizeActivityTypeToSportKey`, never the raw
  `activityType`, and import jobs assign with `assignFitnessFileGearIfUnset` so a
  re-run can't clobber a manual assignment. No importer reads gear from Strava or
  creates a gear row — attribution comes only from the owner's `defaultSports`
  mapping. See **Fitness Gear** in `AGENTS.md`.
- A `kind: 'device'` gear is a recording device and follows different rules from
  a bike or shoes. `deviceKey` is create-only — it is the identity an upload
  matches against, while `name`/`brand`/`model`/`productUrl` are display fields
  the owner edits — and `resolveDeviceGear` is the only thing that may create
  one (the create route answers 422). Deleting a device must **release** its
  `deviceKey` in the same transaction, because the unique index covers
  soft-deleted rows. Devices are filtered out of the activity gear picker
  **before** its kind narrowing, and `setFitnessFileGear` rejects one outright:
  `gearId` means "what was this ride done on", and an activity pointed at a
  device falls out of every rollup. The device rollups **replace** `isPrimary`
  with a per-ride-per-device rule — of the countable files sharing a
  `(statusId, deviceGearId)`, exactly one survives, the primary if that device
  owns it and otherwise the lowest id — because the merge groups by time overlap
  and never looks at the device columns. That counts the watch half of a
  two-device ride while counting a `.fit`+`.gpx` pair from one device once, and
  it must never defer to a sibling that is itself uncountable (a merge writes
  the primary `pending`). The rollup and the activity list must apply the
  identical predicate, so the only thing that may separate a device's count from
  its page is an activity whose post was deleted. The device page link
  is owner-only; everyone else gets the branded manufacturer link.
- React state updater functions stay pure — no side effects, and don't fire another
  variable's state update from inside an updater. Do the separate `setState` calls
  in the event handler instead, so Strict Mode's double-invoke can't misfire them.
- Optimistic UI (e.g. optimistic delete with rollback on failure) disables the
  create/edit actions while the operation is in flight, so a rollback can't discard
  items added in the meantime.
- Don't wrap a callback in `useCallback` when its dependencies change on every
  render, or when the consuming child isn't memoized — it adds cost without
  preventing re-renders.

<a id="review-page-chrome-layout-accessibility"></a>

### Review: Page chrome, layout & accessibility

- `(timeline)` pages use `PageHeader` from `@/lib/components/page-header` and share
  the single `max-w-content` (940px) width. No reintroduced `max-w-2xl`/`max-w-4xl`
  split, `contentWidth` prop, or `data-layout-width="wide"`.
- Below `md` each screen shows one mobile compact bar (the profile: one floating
  menu button, no bar) holding only the menu button and a short title — no logo,
  badge, subtitle or back arrow in it. Back, descriptions, actions, counts and
  filters stay in the content (the home timeline's Refresh is the one action
  in the bar, via `actionsInMobileBar`); a Back is a `BackLink` row reading "Back" (or
  "Back to profile" when it returns to a profile) with an accessible name that
  names the destination, and the post page's history Back falls back to a
  real link to the author's profile. All of it is signed-in only: logged-out
  pages keep `PublicTopBar` at every width (see **Mobile chrome**). The
  desktop rendering (≥768px) is visually unchanged: mobile-only nodes (the bar,
  floating trigger, Back rows) stay in the markup but are `md:hidden`, mobile
  styles are `max-md:`, and desktop chrome classes are `md:`-prefixed. See
  **Mobile chrome**.
- Route loading skeletons (`loading.tsx`) in `(timeline)` reuse `PageHeader` from
  `@/lib/components/page-header` directly with `.skeleton` placeholders (title
  `h-7`, description `h-4`, action button vertically centered via
  `.shrink-0.self-center` in `actions`) so the header height (79px from `md` up) and action
  placement match the hydrated page with 0px shift. Look at Timeline, Favorites,
  Messages, and Search skeletons as reference.
  - Top-level timeline routes (`(home)`, `favorites`, `messages`, `search`,
    `bookmarks`, `notifications`, `explore`, `lists`, `collections`,
    `followers`/`following`) must use `PageHeader` in skeletons. Never hand-roll
    sticky breakout headers (e.g. 75px hand-rolled headers cause 4px layout shifts).
  - Notifications skeleton must preserve the sticky subnav tab container.
  - Child routes in section layouts (`settings`, `fitness`, `admin`, `account`)
    must not render sticky breakout headers in skeletons since the layout owns
    the sticky section header; use in-panel section title skeletons instead.
  - Non-header routes (status permalinks, profile pages) mirror their bespoke
    card or banner geometry.
  - Content panel skeletons must mirror real component metrics (no double borders
    from `divide-y`, correct card heights and button sizes).
- On the mobile home timeline, pagination renders as a visual overlay pill centered over the lower area of the final rendered timeline card without a blank band beneath the feed, with a dedicated in-flow observer sentinel (`h-px`) at the feed end. Other timeline and list pages on mobile render through `LoadMoreButton` with container safe-area spacing (`max-md:pt-6 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]`), and `ScrollToTopButton` uses fixed `bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]` so that neither the sentinel button nor the scroll-to-top pill sit flush against or float excessively high above the Safari address bar and home indicator.
- Settings-style sections (settings, fitness, admin) use the shared
  `SectionNavDropdown` on every breakpoint — no re-inlined dropdown markup and no
  desktop vertical icon rail. Sentence-case labels ("Blocked accounts").
- Fitness stat strips (the activity detail's header strip, the strip under its
  map, the inline chip in a post, the overview's totals) render through
  `FitnessStatGrid` and size themselves with **container** queries — no
  hand-rolled `grid-cols-*` strip and no `sm:`/viewport breakpoint, which cannot
  see a narrow column on a wide window. `@container` belongs on a wrapper, never on the grid it sizes. One
  older strip (gear detail) is not migrated yet — see **Fitness Stat Strips** in
  `AGENTS.md`.
- A gear's activities render through the shared `GearActivitiesFeed` → `Posts`,
  never a bespoke row list, and the endpoint's `nextOffset` counts activity rows
  rather than the statuses in the page (an activity whose post was deleted still
  occupies an offset). Both the initial load and "Load more" walk past a page
  that is postless, and the empty state is gated on `!hasMore` — "no activities"
  above an enabled "Load more" is the bug that gate exists for.
- A nested sub-nav that switches a **view** uses the shared `SectionNavSelect`
  (state-driven); one that navigates to another route uses the in-content
  segmented control via `PageSubnavProvider`. Neither is ever re-inlined. A bike
  gets the Components/Activities switcher; shoes and devices render none,
  because a menu with one entry is dead UI.
- Gear tables (the gear list's bikes/shoes/devices, the components table on a
  gear's page) pin their first column through `STICKY_COLUMN` /
  `STICKY_CLICKABLE_COLUMN` in `app/(timeline)/fitness/gear/gearUi.ts` — never a
  hand-rolled sticky cell. The pinned cell is painted in the surface the table
  sits on — `bg-background`, since the tables sit on the page in the overview's
  layout rather than in a `Card` — and its header cell in the header band's
  opaque tint (`STICKY_HEAD_CELL`); the design paints the lane the colour of
  what is behind it and sets a colour there only to keep the sticky cell
  opaque, so any other colour reads as a stripe in light mode and a sunk well
  in dark. It must
  stay **opaque**, its hover must be the opaque `bg-muted` on both the row and
  the cell (never `bg-muted/50`, which replaces the background rather than
  layering over it), and a dimmed row dims its **cells**, never the `<tr>` or the
  pinned `<td>` — `opacity` fades a background along with its text. Use
  `STICKY_CLICKABLE_COLUMN` only on a row carrying `group` and its own `hover:`.
  See **Fitness Gear** in `AGENTS.md`.
- Orange **text** uses `text-primary-text`, not `text-primary`. `--primary` is
  the accent orange for icons and fills and is only 3.37:1 on the card, below the
  WCAG AA floor for body text; `--primary-text` is tuned per theme to clear 4.5:1
  on every surface, including the `--muted` row hover. Applies to links, link-ish
  buttons and any orange text node — icons keep `text-primary`. This holds
  everywhere in `app/` and `lib/`: the `link` Button variant, the `primary`
  Badge tone, active nav labels, chips, "Hide replies"-style toggles, the
  highlighted stat value and text-bearing tiles (a rule number, a count) all use
  `text-primary-text` (and its `hover:`, `focus:` and `data-[state=…]:`
  variants). Icons, fills, borders and rings keep `primary`, so when one element
  colours both an icon and a label, put `text-primary-text` on the element and
  `text-primary` on the icon (the sidebar's active rows do this). Two things stay
  `text-primary` on purpose: icon-only controls (a toggle button holding just an
  icon or glyph, the collapsed rail) and the large display numeral on the 404/500
  card, which the design draws in the brand orange. `app/globals.contrast.test.ts`
  guards the tokens.
- Destructive **text** and link labels use `text-destructive-text`
  (or `text-destructive`, which maps to it in `@layer utilities`; note that
  variant modifiers such as `hover:text-destructive-text` and
  `focus:text-destructive-text` must use the `-text` suffix explicitly, as
  Tailwind v4 variant compilation targets theme tokens), not raw `--destructive`.
  Light `--destructive-text` is `hsl(357.5 64.1% 43.7%)` (#B7282E, the design's
  Destructive Text, 6.26:1 on white); light `--destructive` stays #EF4444 for
  fills and is only 3.76:1 as a foreground, so never use it as a text colour.
  Dark `--destructive` is `hsl(0 62.8% 30.6%)` (#7F1D1D) to
  preserve 9:1 white-on-destructive contrast for button and badge backgrounds
  (`bg-destructive`), but only reaches ~1.8:1 on dark surfaces. `--destructive-text`
  is lightened to `hsl(0 91% 71%)` (#F87171, Tailwind `red-400`) in dark mode
  to meet WCAG 2.1 AA (4.5:1) on every dark surface (6.44:1 on card/popover,
  7.3:1 on background). Fills and button backgrounds keep `bg-destructive`.
  `app/globals.contrast.test.ts` guards the token.
- The count beside a **liked** heart uses `text-like-text` (`--like-text`:
  #B7282E light, #F87171 dark — the design's "Like Text", equal to the
  destructive text values but named separately so the like button never reads as
  a destructive action). The heart icon itself stays `text-red-500` (#FB2C36).
- Translucent chrome — the sticky page header, the sidebar, the icon rail, the
  mobile compact bar, and the sticky bars of the public shell (`PublicTopBar`), the
  logged-out landing page's public-feed header, the shared heatmap page and the
  status page header — uses `bg-surface-chrome`
  (`--surface-chrome`: white at 72 % light, #141414 at 80 % dark) with
  `backdrop-blur`, not `bg-background/NN`. `lib/components/surfaceChromeUsage.test.ts`
  lists the bars.
- The shared `Badge` carries the design's per-theme tones. `primary` and
  `destructive` use the text tokens for the label and a lighter hue at 16 % for
  the dark fill (`#FA802E` / `#DF3A3A`); `success` is `#163B24` / `#69D390` in
  dark; `blue` (the "Sign-in" badge) is `#00BCFF` at 16 % with foreground text in
  dark; `gray` is `#383838` with a `#C2C2C2` label in dark (the connected-app
  scope chips use the same `#383838` fill). Do not hand-roll badge colours with
  fixed `hsl()` values — a pill that has no `dark:` variant renders as a light
  chip on the dark surface. A status or label pill whose meaning fits a tone is
  `<Badge tone="…">` rather than a hand-copied `rounded-full bg-… px-2 py-0.5`
  span: the Admin pill on the accounts list and detail, the report's Open /
  Resolved, the moderation panel's state labels, a collection's visibility and
  topic, the passkey domain pill, the account's Verified mark and a filter's
  Expired pill are all the shared `Badge` (its `px-2.5` is 4 px wider across
  than the hand-rolled `px-2`, and it carries the design's dark tints). A pill
  that is not a tone — the relay state chips with their own border colours, the
  10–11 px file-type and position tags, the filter context chips — stays its
  own element.
- A native `<select>` is the shared `Select` (`@/lib/components/ui/select`):
  36 px, the design's 3 px focus ring, `shadow-xs`, the OS arrow hidden and the
  muted chevron painted in its place. A call site that needs a different width
  passes it as a `className` (`w-auto` for a select that shares a row with other
  controls); the chevron class is private to the primitive, so there is no
  raw `<select>` to append it to, and `lib/components/ui/formControlUsage.test.ts`
  fails on one. The post line limit, the admin statistic type, the report
  category, the Wahoo environment, the notification actor and the privacy hide
  radius are all `Select`; the hide radius alone passes `h-10`, because the
  design's Hide Radius board draws that one select at 40 px. The activity-file
  switcher in `FitnessStatusDetail` is the one exception: it overlays its own
  foreground-coloured `ChevronDown`, as the design draws it, and sits in a card
  of its own beside the activity card (only for a status with more than one
  fitness file), not nested inside it.
- A checkbox is the shared `Checkbox` (`@/lib/components/ui/checkbox`): 16 px,
  radius 4, an orange fill and a white tick when checked, instead of the
  browser's blue control. It is still a real `<input type="checkbox">`, so a
  label that wraps it or points at it with `htmlFor` toggles it and a form posts
  it as before; the mute dialog's "Also hide notifications" option wraps it in
  its label. `lib/components/ui/formControlUsage.test.ts` fails on a raw
  `<input type="checkbox">` (and on a raw `<select>`).
- The unread-count pill (`NotificationBadge`) is filled `#B7282E` in light — the
  design's count-badge red, darker than the `#EF4444` `--destructive` token that
  white text only reaches 3.8:1 on — and `--destructive` (`#7F1D1D`) in dark.
- Palette tokens beyond the shadcn set: `--control-off` (`bg-control-off`, the
  Switch track when off: `#CCCCCC` light, `#545454` dark) and `--surface-accent`
  (`bg-surface-accent`, the pale orange tile behind an accent icon: `#FFF6F0`
  light, `#271A11` dark; a selected tile keeps `bg-primary/20`). The dark brand
  backdrop on `body` is `#492812` top-left and `#193543` top-right at 60 %.
  `app/globals.contrast.test.ts` guards the values.
- Dropdown menu rows highlight with `--accent` in light and `--muted` (#2B2B2B)
  in dark, and a radio item's indicator is a 6 px dot. A row that paints its own
  `focus:` wash (the current row of `SectionNavDropdown` / `SectionNavSelect`,
  the visibility selector, the Strava gear menu) repeats it as `dark:focus:`:
  the shared item's `dark:focus:bg-muted` survives tailwind-merge unless the row
  names its own `dark:focus:` background, so the hovered row would turn grey in
  dark. Loading placeholders use the shared `.skeleton` utility rather than
  `bg-muted`, which sits almost on the card and is near-invisible.
- The shared `Dialog` is 440 px wide by default (a dialog that needs more sets
  its own `sm:max-w-*`, as the gear forms do at `sm:max-w-lg`), has a 16 px
  radius, and sits on `bg-card` in dark mode (`bg-background` in light) so it
  reads lighter than the dimmed page. The light `outline` Button is filled with
  `bg-card` (#FAFAFA); dark stays the translucent `bg-input/30`, except the
  scroll-to-top pill (`bg-popover`) and the timeline refresh button (`bg-card`),
  which are solid `#171717` with the `--border` hairline in dark.
- When pairing a visible count with `sr-only` text, put only the noun (e.g.
  "boosts") in the `sr-only` span, not the number — the visible digit is already
  announced, so including it double-reads (see `posts/read-only-stats.tsx`).
- Use the dynamic viewport unit `min-h-dvh` (not `min-h-screen` / `100vh`) for
  full-height layouts, so mobile browser toolbars don't break centering.
- One `<main>` landmark per page: don't render `<main>` in a `page.tsx` when an
  ancestor layout already provides one.

<a id="review-logging"></a>

### Review: Logging

- No `console.*` in committed code (lint-enforced in `app/`/`lib/`). Server-side
  code uses `logger` from `@/lib/utils/logger` (`logger.info({ message })`).
  Migrations and `scripts/` may use `console.*`. Do not log from React/client
  code.
- A caught error is logged as `err: toLoggableError(error)`
  (`@/lib/utils/toLoggableError`), not only as `error: err.message`. The
  formatter reads `err.stack` to emit `stack_trace`; a message string alone
  reports nothing actionable. Keep the human-readable `error: <message>` too
  when that same string is persisted.
- A user-visible degradation is not a `logger.warn` and nothing else — persist it
  where that feature's state lives so it is visible and retryable. But scope the
  signal to what broke: don't reuse a status flag that already means something
  bigger (a missing route map records `fitness_files.mapError`; setting
  `processingStatus: 'failed'` would hide the whole activity from the detail
  dashboard, the stat grid, the fitness overview and every rollup). Grep for what
  reads a flag before reusing it.

<a id="review-auth-error-page"></a>

### Review: Auth error page

- Failed auth/OAuth requests must reach the in-app `/auth/error`, never
  better-auth's built-in `/api/auth/error`: `onAPIError.errorURL` in
  `lib/services/auth/auth.ts` stays set. The built-in page does not render in
  production — it 302s to `/?error=...`, dropping a failed sign-in on the home
  timeline.
- `AUTH_ERROR_PATH` stays **root-relative**. better-auth copies it straight into
  the `Location` header with no resolution, so an absolute URL built from
  `getBaseURL()` bounces a login started on a trusted alias domain over to
  `ACTIVITIES_HOST` mid-flow.
- The error page never renders `error_description`, and renders the `error` code
  only when it is **allow-listed** (`isKnownAuthErrorCode`) — not merely
  token-shaped. Both are caller-controlled via a hand-crafted link, and
  `?error=Account-locked-please-call-1-800-555-0100` passes the character class
  and length cap while reading as prose on our own auth card.
- That allow-list gates **rendering only**. Both fields are still logged for any
  code: allow-listing bounds nothing in the log (any description can ride a
  mapped code — the 200/64-character caps are the real bounds), and an unmapped
  code is what most needs the description, since better-auth rewrites codes it
  cannot classify to `UNKNOWN` while forwarding the real description.
- Don't add `onAPIError.onError` for correlation: better-auth short-circuits it
  for anything it redirects (`status === 'FOUND'`), which is exactly this class
  of failure, and setting it suppresses better-auth's own built-in logging.
- If `socialProviders`, `sso()` or `genericOAuth()` are added, pass
  `errorCallbackURL` per flow as well — `onAPIError.errorURL` is only the default
  for provider-callback failures.

<a id="review-better-auth-session-refresh"></a>

### Review: Better-auth session refresh

- A server-side session read never slides the session. `getServerAuthSession`
  keeps `query: { disableRefresh: true }`, and a new `auth.api.*` call that
  resolves a session (anything behind `sessionMiddleware` /
  `getSessionFromCtx`, not only `getSession`) either disables the refresh or
  runs in a route handler that returns better-auth's `Set-Cookie`. A Server
  Component can do neither, so it goes through `getServerAuthSession`.
- Refreshes happen only inside better-auth's own `/api/auth/*` handler, where
  the row and the cookie move together. `SessionKeepAlive` stays mounted in the
  signed-in layout and keeps its timer, because the layout survives client-side
  navigation and a window that is never hidden fires no `visibilitychange`.
- `lib/services/auth/sessionRefresh.test.ts` keeps driving the real better-auth
  instance: a server-render read leaves a due session untouched, and
  `/get-session` extends it and re-issues the cookie. See
  [Better-auth Session Refresh](#agents-better-auth-session-refresh).

<a id="review-oauth-access-token-sliding-expiry"></a>

### Review: OAuth access token sliding expiry

- Every bearer guard still slides a user's opaque token when it accepts a
  request (`extendAccessTokenIfDue`), and only then: after the expiry and scope
  checks in `resolveTokenContext` and the actor, moderation and confirmation
  checks in the guard. Never for an app token or a JWT. This server issues no
  refresh tokens, so a change that drops or narrows the slide signs every
  client out after one window; one that slides a refused request keeps a
  suspended account's token alive.
- `refresh_token` stays out of `OAUTH_GRANT_TYPES`, and the provider config,
  registration and both discovery documents read that constant rather than a
  literal, unless `offline_access` is deliberately supported end to end.
- Every path that mints a user token takes its lifetime from
  `OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS`, never a literal, so the issued
  expiry and the slide agree.
- A failed slide write never fails the request, and better-auth's `revoked`
  column stays unread unless the web-sign-out behaviour is deliberately
  changed. See
  [OAuth Access Token Sliding Expiry](#agents-oauth-access-token-sliding-expiry).

<a id="review-unconfirmed-accounts-app-tokens"></a>

### Review: Unconfirmed accounts & app tokens

- A check for "has this account confirmed its e-mail" reads `verificationCode`
  AND `emailVerified`, never `verifiedAt`. The second column is what
  grandfathers the accounts `20260320072514_better_auth_columns` wrongly marked
  verified — better-auth's `requireEmailVerification` has been letting them sign
  in ever since, so honouring it here grants nothing new and locks nobody out.
  A repair keyed on when a migration ran is NOT a substitute: two attempts at
  that bound shipped wrong in opposite directions. `accounts.verifiedAt` originally carried `DEFAULT CURRENT_TIMESTAMP`
  (`20230824181927_add_accounts_verification`, dropped in `drop_accounts_verifiedat_default`), so a pending registration previously got a
  timestamp anyway and a `verifiedAt` test is a **no-op that reads as a working
  gate**. The column carried that default since 2023-08-24; every check
  written against it since has been inert, `canCreateSessionForAccount`'s
  included.
  `createAccount` writes an explicit `verifiedAt: null` now, but rows written
  before that still carry the default. The same trap bit
  `20260320072514_better_auth_columns`, whose `whereNotNull('verifiedAt')`
  backfill consequently set `emailVerified = true` on every account of that
  era, pending ones included — which is why `20260828140000_clear_stale_verification_codes`
  exists and why `serializeAdminAccounts`' `confirmed` field had to stop reading
  `verifiedAt` too.
- Every MANDATORY authenticated surface refuses an unconfirmed account with 403
  (`isActorConfirmationPending` in `lib/services/guards/OAuthGuard.ts`,
  `lib/services/guards/AuthenticatedGuard.ts`, and
  `lib/services/guards/AdminApiGuard.ts`), matching Mastodon's
  `require_user!`. `OptionalOAuthGuard` deliberately does NOT — it
  DOWNGRADES such a token to the anonymous path
  (`unconfirmedAccount: 'anonymous'`). Refusing made presenting a
  valid token FAIL a public read that succeeds with no Authorization header at
  all; accepting the actor would let an unverified account read DMs addressed
  to it and drive outbound federation via `resolve=true`, which Mastodon does
  not permit either — its search controller applies `require_user!`, so
  `authorize_if_got_token!` is only a partial model here. Suspension is
  different and stays global in both codebases. The reason it matters:
  `POST /api/v1/accounts` returns a real user access token at registration and
  `POST /api/v1/apps` is unauthenticated, so a token that works before
  confirmation lets an anonymous party script usable accounts.
- `unconfirmedAccount: 'allow'` (supported in `OAuthGuard` and
  `AuthenticatedGuard` options) has exactly one active route consumer,
  `POST /api/v1/emails/confirmations` — the endpoint that resends the
  confirmation e-mail, which Mastodon exempts too. A second consumer needs the
  same argument. It relaxes confirmation only: `isActorModerationBlocked` still
  runs in both guards, so a suspended actor or disabled account is refused there
  as well.
  `OptionalOAuthGuard`'s `unconfirmedAccount: 'anonymous'` downgrade is a
  different disposition and does not count against this.
- `allowModerationBlocked` (supported in `AuthenticatedGuard` options) is
  reserved for restrictive revocation endpoints (`accounts/sessions`,
  `accounts/sessions/[id]`, `accounts/connected-apps/[clientId]`) so an owner
  can terminate attacker sessions and revoke connected apps during suspected
  account compromise even while suspended/disabled. It relaxes
  `isActorModerationBlocked` only; CSRF same-origin proof and
  `isActorConfirmationPending` remain enforced.
- Account-level actor management (`actors/switch`, `actors/cancel-deletion`)
  authenticates the account directly via session and same-origin CSRF proof,
  checking account ownership of the target actor rather than gating on the
  session's active actor. `cancel-deletion` still refuses a suspended target
  actor, whose scheduled deletion may be the admin hard delete.
- Do not "unify" this with better-auth's `emailAndPassword.requireEmailVerification`,
  which covers credential sign-in only — but DO read the same column it reads.
  `emailVerified` is on the domain `Account` precisely so the two gates agree;
  removing it re-locks out the backfilled cohort. That gate is why the cookie
  path was never open **for an account registered after 2026-03-20** — older
  ones were marked `emailVerified` by that migration's backfill and have been
  signing in ever since, which is the cohort
  `20260828140000_clear_stale_verification_codes` exists for. Do not repeat the
  unqualified form of this claim.
- A handler that needs to know whether a bearer token is an **app**
  (`client_credentials`) token reads `userId`, never `currentActor`.
  `OAuthAppGuard` also leaves `currentActor` null when it merely fails to resolve
  an actor for a user-delegated token (no grant `referenceId`, and every actor on
  the account pending deletion), which is how a user was accepted as an app and
  could mint accounts.
- `Account.verifiedAt` stays `.nullish()` and `SQLAccount.verifiedAt` nullable:
  both row-to-domain mappers pass a literal `null` through, so `.optional()`
  makes `Actor.parse` throw and the first request by an unconfirmed actor 500s.

<a id="review-emails"></a>

### Review: Emails

- Every email is built by a `build<Name>Email(params): RenderedEmail` module in
  `lib/services/email/templates/`. No subject/HTML/text literals at a call site.
  All active templates follow this; there is no legacy shape left to copy.
- Templates compose blocks from `@/lib/services/email/layout/blocks` and render
  through `renderEmail`; they never write markup. Escaping belongs to the block
  builders, so a template hands in plain strings, and nothing in the layout emits
  an unescaped value today.
- Every `href`/`src` is absolute and built from `getBaseURL()`. Root-relative
  URLs are unresolvable in a mail client, and a hardcoded `https://${config.host}`
  is wrong under `ACTIVITIES_INSECURE_AUTH=true`.
- The plain-text part is derived from the same block list, never hand-written
  alongside the HTML.
- **A local `vi.mock('@/lib/config', …)` must include `getBaseURL`.** It shadows
  the global mock, and because most email call sites catch delivery errors, an
  omission does not fail loudly: the template throws, the catch swallows it, and
  the test passes while the email silently stops sending. This has bitten twice.
- Template changes are verified by rendering:
  `./scripts/mock/renderEmailPreviews.ts` (see `docs/maintenance.md`). A PR
  migrating a template must add it to `buildPreviews()`, and fixtures must be
  production-shaped (43-char codes).
- Outlook-only properties (`mso-padding-alt` on both the button cell and its
  anchor, `mso-hide:all`, the MSO ghost table pinning the column to 600px) are
  load-bearing and invisible in a browser. Don't drop them as dead style.
- **An email image never points at a stored media path directly.** Stored images
  are WebP unless the caller asked for another format, and Outlook desktop and
  Windows Mail cannot decode WebP. An email image needs a stored JPEG copy
  (`saveMediaImageRendition(…, 'jpeg')`) and a column remembering it — the route
  map uses `fitness_files.mapImageEmailPath` — with the WebP as a **live**
  fallback for every case where no copy exists (storage unconfigured, over quota,
  failed encode, or a row predating the column), not legacy-only dead code. A
  stored file with no `medias` row is invisible to generic media cleanup, backup
  and deletion, so check each of those knows about it and that the file is
  deleted wherever its reference is dropped.

<a id="review-post-media-layout"></a>

### Review: Post media layout

- **Feed framing is breakpoint-scoped and owned by the element that renders the
  feed's outer frame**, through `MOBILE_FEED_SURFACE_CLASS` in
  `lib/components/posts/feedLayout.ts`. Below `md` that element spans the
  viewport, cancels the enclosing shell's horizontal padding, and drops only
  its outer border, shadow and corner rounding; the post separators
  (`divide-y`), the article's `px-4` text inset, and the borders of nested
  content-warning, quote, link-preview and fitness cards all stay. Apply it to
  the frame owner — the feed, its loading skeleton, its empty state, and the
  home composer — and to it alone: `Posts` applies it only when `framed`, and
  embedded feeds keep the parent frame (`framed={false}` renders no frame and
  no mobile bleed). The margin is deliberately `calc(50% - 50vw)`, not a fixed
  `-mx-4`: the shared `/` loading boundary renders under both the signed-in
  `px-4` column and the raw logged-out landing branch with no padding, so a
  fixed gutter overflowed the viewport in the second one. `max-md:w-auto` is
  load-bearing — with `width: 100%` the negative margins only shift a `w-full`
  frame left instead of widening it. Search's results shell also drops its
  `overflow-hidden` below `md` (`max-md:overflow-visible`); that removes the
  clip the (now gone) rounding needed and lets embedded posts' non-portalled
  overlays escape below `md`, and Explore's wrapper drops `backdrop-blur`
  below `md` on the posts tab (`max-md:backdrop-blur-none`, the only tab that
  renders `Posts`) because `backdrop-filter` makes it
  the containing block for the `max-md:fixed` edit-history panel. `PublicShell` and its top bar and footer drop
  their 680px reading-column cap below `md` (`max-md:max-w-none`) so the page's other
  content and chrome stay aligned with the full-bleed feed below `md` (the
  frame margin already reaches the viewport edges either way).
- **A visual attachment scroller bleeds out to the owning feed frame's inner edges at every
  breakpoint so cards can scroll beneath the avatar mid-scroll, but at rest and initial scroll position, the media aligns with the post text's left line.** `Attachments` pulls the
  row out by `--post-media-bleed-left` / `--post-media-bleed-right`, whose
  defaults (`4.25rem` / `1rem`) describe the 40px avatar, 12px gap and the
  article's 16px inset. Below `md` the owning frame is the screen edge (except
  a logged-out status page, whose frame is its inset thread card, and a logged-out shared collection's feed, an inset card of its own); from
  `md` up it is the feed card's inner edge, or the parent frame for an embedded
  feed (the parentless landing feed has no frame there, so the row spans the
  column). **The media column tracks the message column, not the avatar and not
  the frame edge**: the same `--post-media-bleed-left` and
  `--post-media-bleed-right` that pull the row out are also the strip
  scroller's `padding-left` / `scroll-padding-left` and `padding-right` (and
  the lone picture row's both paddings), so the first card rests on the text's
  left edge, any card that snaps settles onto it — `x proximity` only snaps
  when the reader stops near one — and the scroll can only reach until the last
  card's right edge meets the text's right edge. The full-bleed row still lets
  cards travel out to the frame edge,
  beneath the avatar, mid-scroll. A nested override and the column are two
  sides of the same variables, but they move different edges: the
  content-warning card's `px-3` override carries the cards to its own inset
  text column, while Explore's `p-2` shell override pushes the frame edge
  outward and carries the cards back to the unchanged article text column
  across that wider frame. Captions align with their own card — the card
  already sits on the text line — and the strip pager's `pr` is the same right
  bleed, so the controls end on the message's right line too. The media row
  must not be narrowed to achieve this: a lone picture still sizes naturally at
  `min(100%, Npx)` — a wide one spans the message column, a narrow one keeps
  its own width on the left line — the strip keeps its item widths, gaps,
  snapping and pager, and no ancestor may clip the row.
- **Media corner rounding follows attachment order:** A single attachment rounds
  all four outer corners (`rounded-2xl`). For a horizontal media strip: the first item
  rounds only its top-left and bottom-left corners (`rounded-l-2xl`), middle items
  keep square corners (`rounded-none`), and the last item rounds only its top-right and
  bottom-right corners (`rounded-r-2xl`). First and last refer to attachment order (index `0`
  vs index `N-1`), not whichever items happen to be visible during scrolling. Square refers
  to corners; natural sizing and aspect ratios are preserved without forcing 1:1 crops.
  The media button — the clipping wrapper — carries the explicit per-position
  corner. Where both `rounded-[inherit]` and an explicit corner class reach the
  same `cn()`, what survives depends on the tailwind-merge radius groups:
  base-vs-base keeps exactly one winner (lone `rounded-2xl`, middle
  `rounded-none`), while side-specific corners (`rounded-l-2xl`,
  `rounded-r-2xl`) are kept alongside the inherit — and then the side longhands
  override the inherited corners by normal CSS cascade, so the nested `img` /
  `video` still rounds exactly its two outer corners. Nodes that receive no
  explicit class (e.g. the blurhash canvas) keep `rounded-[inherit]`, which
  resolves through the wrapper's own explicit corner, transitively equal to the
  button's radius — so media frames never bleed square pixels past rounded
  parent edges.
- A status's media is **one attachment at its own size, or a horizontally
  scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
  this for every surface that renders a post. A lone picture keeps its own
  aspect ratio and starts on the post text's left line, scaled by WIDTH;
  the branch this replaced cropped every portrait photo to a full-width 16:9.
- The gallery uses 240px image boxes, 12px gaps, aspect-ratio-based card widths
  with a 160px minimum and 78% maximum, and `scroll-snap-type: x proximity`.
  Captions sit below their images, preserve line breaks and custom emoji, and
  clamp independently to three lines. Paired circular arrows sit below the
  captions while overflowing, remain focusable at their boundaries with guarded
  `aria-disabled` states. Each click advances exactly one adjacent card —
  landing it on the text line through the `scroll-padding-left` inset — using
  the first boundary in the requested direction when the user is between cards,
  and clamps at either end. While layout is still pending and no card boundary
  exists yet, a press falls back to one visible width (`clientWidth`) in the
  requested direction. Scrolling stays smooth unless reduced motion is
  requested.
- **There is no item cap and no `+N` overlay** — scrolling reaches everything —
  so anything the strip renders unboundedly needs a deferral: images pass
  `loading="lazy"`, videos `preload="none"` (`loading` is image-only) — but only
  a video carrying a `poster`. A posterless one shows nothing at all when
  deferred, since its only pre-playback frame comes from the `#t=0.01` fragment,
  and federated video never has a poster. A lone picture or video is
  deliberately eager, being the post's largest element. Re-adding a cap hides
  media the post actually carries.
- There are no edge fades or overlaid arrows; the arrows sit beneath captions
  so they do not obscure media or interfere with touch.
- **Filtering is layout-only.** `isVisualAttachment` picks what gets a picture
  box and `isAudibleAttachment` what becomes an inline player; a `.fit` file or
  PDF is skipped rather than rendering an empty box. But the lightbox is handed
  exactly the pictures on screen, indexed into THAT list — passing the raw
  array gives `MediasModal` a blank slide and a wrong "n of m". Anything asking
  "do I have media to show" asks `isRenderableAttachment`, never
  `attachments.length` (`post.tsx`'s link-preview suppression does).
- **An ordinary video is a player, not a picture button.** `Attachments` renders
  it — lone or in the strip — as a tile with a picture's size, corners and
  caption holding `<video controls>`, and that tile is a `div`, never a `button`,
  because the controls are interactive content. Pressing it plays the video in
  the post and does not open the lightbox, so `Media` leaves a click on a
  controlled video un-prevented (a default-prevented click does not toggle
  playback in Chromium). A looping gifv and a GIF keep the animation card with
  its own play/pause chip and zoom button. The lightbox is still handed every
  visual attachment, videos included. The sensitive-content gate is unchanged:
  `ContentWarning` mounts nothing while collapsed, so no `<video>` exists, and no
  request is made, until it is expanded.
- **A stored dimension of `0` means "unknown", not "zero pixels"** — several
  media-storage paths persist `metaData.width ?? 0` — so every read goes through
  `getMediaGeometry`, which also clamps pathological shapes and falls back to a
  4:3 box so blurhash has something to reserve.
- **A media button's focus indicator is an `outline` with a NEGATIVE offset,
  never an outset ring.** The strip's own `overflow-x-auto` clips an outset
  ring, and the media box can still reach the frame's inner edge — a wide lone
  picture's right edge, and every strip card while it is being dragged — where
  `main`'s `overflow-x-clip` cuts the ring's outer edge off below `md`. An
  inset `box-shadow` does not work either — it paints beneath content and the
  button's only child is an opaque image. `Attachments` uses one spelling for
  both shapes; it has been got wrong twice and is pinned by a test.
- `useMediaStripScroll` measures the strip's own container, never a viewport
  breakpoint, through a **callback** ref because the strip is conditional. Its
  `contentKey` must describe item WIDTHS, not their count: the observer watches
  the container, which does not resize when an edit swaps a panorama for a
  portrait.
- `no-scrollbar` belongs only on a row that carries its own overflow affordance.
  It was applied in the emoji and reaction pickers while defined nowhere, so
  defining it would have removed their only cue.

<a id="review-status-delete-unboost-federation"></a>

### Review: Status delete & unboost federation

- **Local deletion commits before external and synchronous fan-out.** The database
  queue uses `deleteStatusWithQueueJob`, which inserts the delete job and removes
  the status in one transaction; a transaction failure propagates and rolls back.
  `SendDeleteNoteJob` federates the `Delete`/`Tombstone` after commit. For other
  queues, flag any change that reintroduces inline fan-out ahead of
  `database.deleteStatus`: it makes the response wait on remote inboxes and lets
  inbox-resolution errors abandon the local deletion. A failing remote server
  alone is not that trigger: the sender and `getActorPerson` swallow remote
  lookup/network failures. Once the local deletion has committed, a publish error
  must be logged without telling the author the post remains.
- Neither job may load the status it federates: `database.deleteStatus` is a
  cascading hard delete, so the data travels in the payload — `to`/`cc` for the
  `Delete`, plus `originalStatusId`/`createdAt` for the `Undo`, all captured
  pre-delete. `getFederatedStatusDeliveryInboxes` takes `Pick<Status, 'to' | 'cc'>`
  and the `undoAnnounce` sender takes a matching narrowed `announce`. A
  "consistency" refactor onto `loadStatusAndActor` silently stops federation —
  that is precisely how `sendUndoAnnounceJob` shipped broken.
- Dedup ids keep their `#delete` / `#undo` suffix; the bare status id collides
  with `SendNoteJob`/`SendUpdateNoteJob`/`SendAnnounceJob` in the queue's global
  dedup window.
- `sendUndoAnnounceJob` and `sendAnnounceJob` must resolve inboxes the same way
  (`getFollowersInbox` + `filterFederatedUrls`), or an unboost reaches a
  different audience than the boost did.
- The activities `deleteStatus` sender never rejects (`postActivityToInbox`
  swallows and returns `undefined`), so a per-inbox isolation test must mock the
  sender, not the socket, or it asserts nothing.

<a id="review-link-preview-cards"></a>

### Review: Link preview cards

- A card is cached **per URL** in `link_previews` and mapped to a status by
  `status_link_previews`. A change that moves card data onto `statuses`, or
  keys the cache per status, loses the whole point: a widely-shared link is
  fetched once per refresh window, not once per post.
- **A failure must go through `recordLinkPreviewFailure`, never
  `upsertLinkPreview`.** The latter writes the whole row, so recording a failure
  through it blanks a card that every status linking that URL is still showing —
  and the negative cache then suppresses the retry that would repair it. A row
  that is already `completed` keeps its content and its status.
- `fetchLinkPreviewJob` must re-resolve the status's URL before attaching
  (`resolveStatusPreviewUrl`). An edit leaves the pre-edit job queued; without
  the re-check it re-attaches the old card, or resurrects one an edit removed.
  The scheduler and the job must keep using that single resolver.
- Extraction runs the **whole** `processStatusTextContent` and walks its output,
  on both paths — not a rearrangement of its parts, so the extractor sees the
  reader's DOM. Check that `extractPreviewUrl` is still given `tags` and that
  `resolveStatusPreviewUrl` still passes `status.tags`: the emoji substitution
  can EMPTY an anchor whose text the extractor already counted (a non-https
  `Emoji` icon url is dropped entirely by `sanitizeTrustedStatusText`), and
  dropping that one argument silently restores a phishing card.
- **The extractor and the reader parse that shared string with DIFFERENT
  parsers** — htmlparser2 on the server, the browser's own tree construction in
  the client bundle — so any HTML5 rule that MOVES content between elements is a
  divergence. Nested anchors are the known one: `getVisibleText` must keep
  stopping at the FIRST descendant `<a>`, in document order, because a browser
  pops the outer anchor at the inner one's start tag — so the inner anchor and
  everything after it ends up outside. Reject a change that counts a nested
  anchor's text as its ancestor's, and equally one that counts the text AFTER
  the nest (a trailing `" — worth a read."` reads as prose beside an empty
  anchor). Reject "an anchor containing an anchor is invisible" too — text
  before the nest survives and keeps the outer anchor eligible.
  New cases belong in `parserAgreement.test.ts`, which checks the extractor
  against a jsdom DOM rather than against hand-written expectations. A link whose text renders to nothing — empty,
  entity-only, or hidden by `hidden`/`invisible` including via an ANCESTOR — is
  skipped, because otherwise a link the reader cannot see gets a full-width
  clickable card carrying an attacker-chosen title and image. `<template>` is
  not an exception: the sanitizer unwraps it, so that anchor is genuinely
  visible and keeps its card. Reject any change that walks marked's token tree
  for local posts — it cannot see ancestors, cannot decode entities, and its
  table cells crashed the walker into "no links at all".
- **That short hidden-class list (`hidden`, `invisible`, `quote-inline`) is
  only sufficient because `sanitizeText` allowlists the `class` attribute**
  (`ALLOWED_CONTENT_CLASSES`, applied to `a` and `span`; `p` keeps `class`
  filtered to `quote-inline` alone, for Mastodon's quote fallback). The class reaches the real DOM — `cleanClassName`
  hands an anchor's straight to `className` — and this app compiles Tailwind, so
  before the allowlist a remote post could hide a link with `sr-only`,
  `opacity-0` or any other utility in the bundle and take the card while the
  reader saw nothing. Treat the two lists as one mechanism: adding a class to
  the allowlist without deciding whether it hides content reopens this, and the
  coupling test in `extractUrl.test.ts` is what fails when someone tries. Reject
  prefix globs (`h-*`, `p-*`) however much Mastodon's own config uses them —
  here they would admit `h-screen` and `p-0`. Also reject a
  `SANITIZED_TRUSTED_STATUS_OPTION` that REPLACES `allowedClasses` instead of
  spreading it: a tag with no entry keeps its class untouched, so listing only
  `img` hands `span`/`a` back an unrestricted class attribute.
- **Anything that rewrites status HTML between the two sanitize passes is an
  injection point, and `convertEmojisToImages` is the one that exists.** A
  remote `Emoji` tag's `name` and `icon.url` are stored verbatim, so both are
  attacker-controlled. Four distinct bugs have come out of this one function, so
  reject any change that simplifies it back toward
  `tags.reduce((t, tag) => t.replaceAll(tag.name, …), text)`. It must keep all
  of: searching for a shortcode-shaped **token** and looking the name up (never
  using the name as the search string); a **single** pass over the original text
  (each replacement emits an `alt=":shortcode:"` that a later one would match);
  substituting only in **text** pieces, never inside tags (a `:` survives in an
  href, and rewriting there corrupted the very link the card was for — no
  hostile input needed); and a **function** replacement, which is what makes `$`
  literal (`$&` / `` $` `` are re-read after escaping and splice raw markup
  from elsewhere in the post into the src). `escapeHtml` on the url is required
  on top of those. Reject moving the check to ingest only: at render it also
  covers rows already stored.
- Every optional Mastodon `PreviewCard` field needs an `''`/`0` default. That
  schema is non-nullable and `Status.parse` runs per status inside a handler
  that **skips** what it cannot serialize, so one missing key drops the whole
  status from the timeline rather than just losing the card.
- `html`/`embed_url` stay empty (no oEmbed consumption, so no remote markup is
  handed to clients), thumbnails are `https`-only and hotlinked with
  `referrerPolicy="no-referrer"`, and the href goes through `safeExternalHref`.
- The kill switch is `network.linkPreviews`, checked both when scheduling and
  inside the job (a delayed job must not drain after an operator turns it off).
  It is not a `features.*` flag: that namespace is navigation-only. It gates
  fetching only — the cleanup that drops a card when an edit removes its link
  runs regardless.
- Known and deliberate: a first-fetch failure is never retried, an attached card
  is only refreshed if someone posts the link again, `link_previews` rows are
  never collected, and polls get no card at all. There is no recurring-job
  infrastructure to hang a sweep on, and polls store rendered HTML where notes
  store markdown (so wiring them up needs that asymmetry fixed first, not just
  the call added). Don't flag these as bugs, and don't "fix" them with a sweep
  that has nothing to run it.
