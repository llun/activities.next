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
  └─ External services: QStash, SMTP/Resend/SES/Lambda, OpenTelemetry
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
- Session management stored in the database
- OAuth 2.0 access tokens (JWT and opaque) for API access

The application also acts as an **OAuth 2.0 provider** (using better-auth's OAuth provider plugin), allowing third-party applications to authenticate users and access the API.

### ActivityPub Federation

The server implements the [ActivityPub](https://www.w3.org/TR/activitypub/) protocol for federation:

- **Inbox** (`/api/inbox`, `/api/users/:username/inbox`) — Receives activities from remote servers
- **Outbox** (`/api/users/:username/outbox`) — Lists activities by a local actor
- **WebFinger** (`/.well-known/webfinger`) — Actor discovery, including the `http://ostatus.org/schema/1.0/subscribe` template that points remote-follow visitors at `/authorize_interaction`
- **Remote follow** (`/authorize_interaction?uri=…`) — Mastodon-compatible landing page where a signed-in local user confirms following an account another server sent them to; the outbound half (a logged-out visitor following a local account from their own server) resolves through `GET /api/v1/remote-follow`
- **NodeInfo** (`/.well-known/nodeinfo`) — Instance metadata
- **HTTP Signatures** — All outgoing requests are signed; incoming requests are verified

#### Inbound Forwarding & Verification

Incoming HTTP deliveries to `/api/inbox` and `/api/users/:username/inbox` are guarded by `ActivityPubVerifySenderGuard`:

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
  - Enqueues `ForwardActivityJob` on the job queue (`Create`, `Update`, `Delete` activities).
  - Outbound HTTP POST requests are signed with the targeted local actor's key or the instance federation signing actor (`getFederationSigningActor`).
  - OpenTelemetry spans track `inbox.forward_targets_count`, `inbox.local_actor_id`, and `inbox.activity_id`.

On follow accept, `acceptFollowRequest` enqueues `FollowTimelineBackfillJob`. First discovery of a remote actor (zero stored statuses) fetches the outbox first page (cap 20, public/unlisted only, Announces skipped, each `Create` routed through `CreateNoteJob`/`CreatePollJob` with the followed actor pinned as verified sender), then the actor's stored statuses are merged into the follower's home timeline (also the whole behavior for already-known and local actors); best-effort — a failure never affects the follow.

### Background Jobs

Long-running operations (sending activities to remote servers, processing file uploads) are dispatched to a background queue. Supported backends:

- **Database Queue (Transactional Outbox)** — Built-in resilient queue stored in `queue_jobs` table (`ACTIVITIES_QUEUE_TYPE=database`). Executes jobs asynchronously with polynomial backoff retries and dead-letter queue persistence.
- **Upstash QStash** — Managed HTTP-based message queue (recommended for production)
- **Google Cloud Tasks** — Managed HTTP-based task queue with OIDC verification and dead-letter queue support
- **Synchronous** — Jobs execute inline (default, suitable for small instances and local development)

External queue clients (`@upstash/qstash` and `@google-cloud/tasks`) and the PostgreSQL driver (`pg`) are isolated into dedicated Yarn workspaces under `packages/` (`@activities/qstash`, `@activities/cloudtasks`, `@activities/pg`). They are loaded on demand dynamically (via `dynamicImport` with type stubs for queue clients, or Knex dynamic driver loading for PostgreSQL), preventing optional SDKs from being unconditionally bundled into the minimal standalone application.

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
  document `<head>` is parsed: the byte cap bounds transfer, not CPU, and the
  HTML parser is quadratic in nesting depth.
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
  visit count; the Apple and Mapbox renderers draw at one flat opacity. `?format=png`
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
- [Settings Forms (Client Components)](#agents-settings-forms-client-components)
- [Transactional & Notification Emails](#agents-transactional-notification-emails)
- [Link Preview Cards](#agents-link-preview-cards)
- [Status Delete & Unboost Federation](#agents-status-delete-unboost-federation)
- [Better-auth Plugin Guidelines](#agents-better-auth-plugin-guidelines)
- [Better-auth Database Joins](#agents-better-auth-database-joins)
- [OAuth Client Registrations](#agents-oauth-client-registrations)
- [Auth Error Page](#agents-auth-error-page)
- [OAuth Grants Must Resolve an Actor](#agents-oauth-grants-must-resolve-an-actor)
- [An Unconfirmed Account May Not Act](#agents-an-unconfirmed-account-may-not-act)
- [Review: Runtime vs. build-time configuration](#review-runtime-vs-build-time-configuration)
- [Review: Client components & data flow](#review-client-components-data-flow)
- [Review: Page chrome, layout & accessibility](#review-page-chrome-layout-accessibility)
- [Review: Logging](#review-logging)
- [Review: Auth error page](#review-auth-error-page)
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

- **All server-side outbound HTTP requests MUST go through `safeRemoteFetch` (`@/lib/utils/safeRemoteFetch`).**
- Never call raw `fetch()` directly in server-side services or utilities.
- `safeRemoteFetch` is backed by `got` and applies standard SSRF protection (requiring HTTPS, blocking private IP ranges such as loopback and RFC 1918 subnets), streaming response-size limits, timeout bounds, DNS pinning, and redirect handling.
- External cloud integrations (e.g. translation providers like DeepL, OpenAI, or Gemini, and alt-text vision generation) must target public HTTPS endpoints. Internal or self-hosted HTTP services running on private IP addresses are not supported.

<a id="agents-link-prefetching-in-feeds"></a>

### Link prefetching in feeds

- **A `<Link>` rendered once per row of a feed or list MUST pass `prefetch={false}`.** Next's App Router `<Link>` defaults to prefetching every link that enters the viewport, and this app's feeds are infinite-scroll, so a repeated link is not one request — it is one request per row, fired continuously as the user scrolls. This is the bug that flooded production: `Posts` renders two author links per post (the avatar and the display name), so scrolling the home timeline issued a stream of `GET /@user@domain?_rsc=…` prefetches.
- The cost is not just a page render. Every one of those targets is a fully dynamic route — `/@user@domain` runs a session lookup plus six actor queries — and for a remote actor this instance has not persisted yet, `getProfileData` additionally performs a **WebFinger lookup and a signed actor fetch against the remote server**. Viewport prefetching therefore turns idle scrolling into outbound federation traffic aimed at other people's instances.
- There is no global switch: Next 16's `prefetch` prop (`boolean | 'auto' | null`) is per-`Link` and has no `next.config.ts` counterpart, so the opt-out is written at each call site. `prefetch={false}` disables prefetching on **both** viewport entry and hover — accept the hover loss; a profile open is a deliberate navigation and does not need to be instant.
- Current opt-outs: the shared post author links (`lib/components/posts/actor.tsx`), the booster link on the boosted-by line (`BoostStatus` in `lib/components/posts/post.tsx`), notification rows (`NotificationItem`, `StatusNotification`, `ActivityImportNotification`), follower/following rows (`FollowList`), search account and hashtag rows, the likes list and chips (`StatusLikes`), collection member rows, and trending hashtag rows. Regression-tested in `lib/components/posts/actor.test.tsx` and `lib/components/posts/boost-status.test.tsx`, which mock `next/link` because the real one does not reflect `prefetch` into the DOM.
- Navigation **chrome** keeps prefetching and should: the sidebar, mobile nav, section sub-nav, pagination, and one-off page links render a bounded handful of links, so prefetch is a straight latency win there. The rule is about links whose count scales with the number of rows on screen. **The one exception inside chrome** is the mobile bar's synthesized Profile entry (`lib/components/layout/mobile-nav.tsx`): unlike every other mobile-nav item, which is a fixed registry route, Profile's href is the viewer's own per-user `/@user@domain` — the same fully-dynamic `[actor]` route the post-author links above opt out of (a per-user session lookup plus six actor queries on every render; for a REMOTE actor, which the self-profile is not, that same route also drives a WebFinger lookup and a signed actor fetch) — so it alone carries `prefetch={false}` while the registry items and the overflow (More) menu links around it keep default prefetching. Regression-tested in `lib/components/layout/mobile-nav.test.tsx`, which mocks `next/link` the same way.

<a id="agents-navigation-customization"></a>

### Navigation Customization

- **The nav item registry is the single source of truth, and adding an item is two lines.** Its id goes in `NAV_ITEM_IDS` (`lib/services/navigation/navPreferences.ts`) and its presentation — icon, label, `shortLabel`, `blurb` — goes in `NAV_ITEM_DEFINITIONS` (`lib/components/layout/nav-items.ts`). Every surface derives from those: the full sidebar, the collapsed rail, the mobile bar and its More sheet, and the Settings → Navigation manager. Never hardcode a nav list in a component (the mobile bar used to keep its own `mobileDirectHrefs` allowlist, which is exactly the drift this replaced).
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

- Use `PageHeader` from `@/lib/components/page-header` for every page title in the `(timeline)` route group. By default it renders the sticky, full-width chrome (translucent background + backdrop blur + bottom border) and centers the title above the content column. Pages always call `<PageHeader title="…" description="…" actions={…} />`; they don't need to know which sub-nav pattern (if any) wraps them.
- **Unified desktop content width.** Every top-level page in the `(timeline)` group shares **one** content width on desktop so the column stays aligned as you switch tabs. The `(timeline)` layout wrapper centers content at `max-w-content` (a single `--container-content: 940px` token defined in `app/globals.css`'s `@theme`), and `PageHeader` centers its title row at the same `max-w-content`. There is **no** per-page width tier any more: do **not** reintroduce the old two-tier `max-w-2xl` (timeline) / `max-w-4xl` (sections) split, a `contentWidth` prop on `PageHeader`, or the `data-layout-width="wide"` opt-in CSS rule. Section layouts (settings, fitness, admin) and Messages all inherit the unified `max-w-content` from the wrapper — they don't set their own width.
- **Page skeleton alignment (`loading.tsx`).** Route loading skeletons for logged-in pages in `(timeline)` must align with the rendered page so that transition causes no visual jumping of either the header or the content box below it:
  - **Reuse `PageHeader` directly on top-level timeline pages.** Never hand-roll a sticky header div or breakout style. Rendering `<PageHeader>` from `@/lib/components/page-header` ensures sticky breakout styling, padding (`px-4 py-4`), bottom border, and total header height (79px) match the loaded page pixel-for-pixel.
  - **Mirror font and action metrics.** Pass `title={<span className="skeleton block h-7 w-… rounded-md" />}` to match `h1 text-xl` (28px line height = `h-7`), `description={<span className="skeleton block h-4 w-… rounded" />}` to match `mt-0.5 text-xs text-muted-foreground` (16px line height = `h-4`), and action button skeletons in `actions={…}` (e.g. `size-9` for standard icon buttons, `h-8 w-18` for small buttons). `PageHeader` centers actions vertically via `.shrink-0.self-center`; hand-rolled headers default to top-aligned (`items-start`), which makes action buttons jump down 7px when the page hydrates.
  - **Prevent layout shift below the header.** Layouts apply vertical spacing between the sticky header and page content (`space-y-6` on timeline/favorites, `gap-5 md:gap-6` on messages). Any discrepancy in header height (such as 75px vs 79px) causes the entire content box below the header to jump vertically when data loads.
  - **Mirror panel item layout in content skeletons.** Skeletons should match the vertical rhythm of the real components: e.g. in direct messages, mirror the 3-line conversation card (title, preview, timestamp) without combining `divide-y` on containers with per-item `border-b` (which creates double borders), and use `size-9` for `Button size="icon"` and `h-9` for default buttons.
  - **Page inventory & skeleton rules across routes:**
    - **Top-level standalone timeline routes (MUST use sticky `PageHeader` in skeleton):**
      - `(home)` (`app/(timeline)/(home)/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`, action `size-9`.
      - `favorites` (`app/(timeline)/favorites/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `messages` (`app/(timeline)/messages/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`, and action `h-8 w-18`.
      - `search` (`app/(timeline)/search/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `[actor]/followers` & `[actor]/following` (`app/(timeline)/[actor]/FollowListLoadingSkeleton.tsx`): Both routes render `PageHeader` when signed in. Hand-rolled sticky headers here (e.g. 75px with `h-6` title and `space-y-1`) violate the rule and cause a 4px jump; they must reuse `PageHeader` directly.
      - `bookmarks` (`app/(timeline)/bookmarks/page.tsx`), `explore` (`app/(timeline)/explore/page.tsx`), `lists` & `lists/[id]` (`app/(timeline)/lists/page.tsx`), `collections/[id]` (`app/(timeline)/collections/[id]/page.tsx`): All render top-level `PageHeader`s (some with action buttons like `Button size="sm"` -> `h-8`). Note that `/lists` serves as the unified index for both lists and collections. When adding `loading.tsx` skeletons for these routes, always reuse `PageHeader` with matching `h-7` title, `h-4` description, and `actions` skeletons.
      - `notifications` (`app/(timeline)/notifications/page.tsx`): Renders `PageHeader` with `PageSubnavProvider` for sticky filter tabs (`All`, `Mentions`). Skeletons must include both the `PageHeader` and subnav tab placeholder inside the sticky header container to prevent tab strip jumps.
    - **Section-mode routes (`settings`, `fitness`, `admin`, `account`):**
      - The outer layout (`app/(timeline)/<section>/layout.tsx`) renders the sticky `PageHeader` _outside_ `PageHeaderSectionProvider`, while `SectionNavDropdown` and children render _inside_ it.
      - Child pages inside these sections render their own `PageHeader` in **section mode** (plain in-panel title block `mb-6 text-xl`, not sticky, not breakout).
      - Child route skeletons inside these sections must **NEVER** render a sticky breakout `PageHeader`, as that duplicates the sticky header already rendered by `layout.tsx`. If a child route skeleton has a header, it must render an in-panel section title skeleton.
    - **Non-header pages (`[actor]/[status]`, `[actor]` profile, `tags/[tag]`):**
      - Detail pages (`[actor]/[status]/loading.tsx`), profile pages (`[actor]/loading.tsx`), and tag pages (`tags/[tag]`) do not render a top-level `PageHeader` and have bespoke layout structures (post permalink card with back navigation, profile banner/avatar grid, or inline tag title). Skeletons for these pages mirror their respective card, profile, or tag geometry instead of `PageHeader`.

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

- `PageSubnavProvider` remains available for sections that need horizontal tabs **inside** the sticky header: wrap the layout's `{children}` in it and pass the rendered tabs as `subnav`. The closest `PageHeader` renders the tabs directly under the title row, inside the sticky chrome. Do **not** render the sub-nav directly in the layout JSX above the header. No settings-style section layout uses this any more (admin moved to the dropdown sub-nav above to match the design system), but the top-level Notifications page (`app/(timeline)/notifications/page.tsx`) uses it for its sticky-header filter tabs, and the primitive also backs the nested in-content segmented-control pattern.

  ```tsx
  import { PageSubnavProvider } from '@/lib/components/page-header'

  // const subnav = (/* tabs strip — desktop tabs + mobile dropdown */)
  // return <PageSubnavProvider subnav={subnav}>{children}</PageSubnavProvider>
  ```

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
copy change lands in one place instead of eleven. All eleven templates are on
it; there is no legacy shape left to copy.

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
- **Every `href`/`src` is absolute and built from `getBaseURL()`.** A
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

<a id="agents-better-auth-database-joins"></a>

### Better-auth Database Joins

- **`advanced.database.joins` is ON (`lib/services/auth/auth.ts`), and answering every join is `knexAdapter`'s job — the fallback is a slower path, not a free one.** The flag lived at `experimental.joins` until better-auth 1.7 moved it here. On 1.6.x it was an assertion rather than a request: the adapter factory forwarded `join` to `findOne`/`findMany` and read the related rows straight off what the adapter returned (`data[tableName]`), with no capability check and no fallback, so an adapter that ignored a join shape handed back a session with no user, `findSession` turned that into `null`, and **every signed-in user was silently logged out** while sign-in still appeared to succeed. 1.7 checks whether the adapter included the key and falls back to separate queries, which turns that outage into a per-request extra statement. Nothing in the adapter's own unit tests catches either — they call the adapter directly, so they never see the factory's transform. `lib/services/auth/sessionJoins.test.ts` drives the real better-auth instance against a real database and asserts the single statement; keep it passing.
- **A join key is the joined TABLE name, and the returned row must nest under exactly that key.** For this instance's model mapping, `join: { user: true }` on a session arrives as `{ accounts: { on: { from: 'accountId', to: 'id' }, limit: 1, relation: 'one-to-one' } }` — the columns are already resolved, so the adapter uses them as given.
- **Joined columns must be aliased before they are selected.** `sessions` and `accounts` both have `id`, `createdAt` and `updatedAt`; selecting both tables unaliased overwrites the session's own id with the account's, which is a worse bug than the missing join. The adapter selects each joined column as `__j<n>_<column>` and re-nests it — the prefix is short on purpose, because PostgreSQL truncates identifiers at 63 bytes and a truncated alias merges two columns into one.
- **Only `one-to-one` is folded into the base statement; anything else gets a follow-up query.** A `one-to-many` join carries a per-parent `limit` that plain SQL cannot express without window functions, and on `findMany` it would multiply the base rows and break `limit`/`offset`. The follow-up path is also the fallback for a table better-auth's schema does not describe — that path is always correct, so prefer it over a half-working join.
- The joined table's column list comes from better-auth's own schema, which is lossless: the factory's output transform reads only the model's schema fields plus `id` and drops everything else, so selecting exactly those matches what a `SELECT *` would have produced while keeping app-only columns out.
- **Session lookups run `WHERE token = ?` on every authenticated request** — `sessions.token` is indexed (`sessions_token_idx`) for exactly that reason. The older `(accountId, token)` composite cannot serve it: a B-tree led by `accountId` leaves a bare-`token` predicate to a sequential scan. Don't drop the single-column index on the grounds that the composite already mentions `token`.
- **`experimental` was removed outright in 1.7 — it is not a compatible alias for the new key.** better-auth's options type accepts unknown keys, so a stale `experimental: { joins: true }` neither fails to compile nor warns; it just stops requesting joins, and every authenticated request quietly costs a second statement again. Check the option's location against the installed version's `advanced.database` on any better-auth upgrade.

<a id="agents-oauth-client-registrations"></a>

### OAuth Client Registrations

- **Never delete or expire rows in `oauthClient`.** Registrations created through `POST /api/v1/apps` are durable. Mastodon-API clients (Phanpy, Elk, Tusky, …) persist the `client_id`/`client_secret` they get from that endpoint indefinitely and only re-register when their stored copy is **missing** — so deleting a registration permanently wedges every client still holding it: it keeps presenting a `client_id` this server no longer knows and has no way to learn it must register again. A time-based cleanup does not help, because any finite TTL eventually deletes a live cached client. Mastodon hit exactly this and **removed its own application "vacuuming" in 4.3**. (A 24h "stale registration" collector used to live in `createApplication.ts` and broke Phanpy sign-in for this reason — the failure surfaced as `invalid_client` / `client_id is required`.) The trade-off is that abandoned registrations accumulate: `createApplication`'s per-source throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so a default deployment does not bound them. Accept that, or add a guard that **rejects writes** — never one that deletes registrations.
- **A registration must write `oauthClient.clientCredentialsScopes`, and that is not the same column as `scopes`.** better-auth 1.6 validated a `client_credentials` request against the client's registered `scopes`; 1.7 moved the decision to this separate, server-owned column and denies the grant outright when it is missing or empty — `400 unauthorized_client` / `client has no authorized client_credentials scopes`. The column arrived with the 1.7 schema migration and nothing ever wrote it, so every application on the instance was refused an app token — and a native Mastodon client asks for one **before** it offers to sign a user in (Ivory does, with the credentials `POST /api/v1/apps` just handed it), so the login never started and the only sign of it was that 400 in the token proxy's log. `createApplication` writes the column through `toClientCredentialsScopes` (`lib/services/oauth/clientCredentialsScopes.ts`); that module documents the derivation rule, why its reserved-scope filter is the only thing enforcing it on this path, and how it differs from 1.6 — read it there rather than re-deriving it, and do not simplify the filter away. Fixing the write path is **not sufficient on its own**: registrations are never deleted and clients cache their credentials indefinitely (see the bullet above), so every client already installed would stay wedged — `20260828000000_backfill_oauth_client_credentials_scopes` repairs the existing rows, carrying a second copy of the reserved list because a migration runs through the plain `knex` CLI with no TypeScript loader and no path aliases (`lib/database/sql/oauthClientCredentialsScopesMigration.test.ts` pins the two against each other), plus two gates of its own that refuse public clients and clients not registered for the grant. This grants no new authority: an app token has no user, so only `OAuthAppGuard` accepts one — `apps/verify_credentials` and Mastodon's API account registration, itself gated on `registrations.open` — and every other guard requires an actor that an actor-less token never resolves.
- **An app token lives one hour, not the 7 days `accessTokenExpiresIn` configures.** `createUserTokens` reads `m2mAccessTokenExpiresIn` for a grant with no user and this server does not set it, so better-auth's 3600s default applies. Unrelated to the scope ceiling above; it is the other thing about app tokens that reads wrongly from `auth.ts`.
- **An unknown `client_id` must fail at `/oauth/authorize`, not be forwarded to Better Auth.** Better Auth's authorize endpoint answers an unregistered client with `invalid_client` / **`client_id is required`** — the same message it uses for a genuinely absent `client_id`, which makes the failure very hard to read — and then redirects to the error page, so a failed login used to look like it silently did nothing (before `onAPIError.errorURL`, better-auth's own `/api/auth/error` 302'd straight on to the home timeline in production — see **Auth Error Page** below). `app/(nosidebar)/oauth/authorize/page.tsx` validates the client (and its `redirect_uri`) up front and returns `notFound()`; keep that check ahead of the Better Auth delegation. Per RFC 6749 §4.1.2.1 an invalid `client_id`/`redirect_uri` must be reported to the user rather than redirected to the requested `redirect_uri`.

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
- **`allowModerationBlocked` is the carve-out on `AuthenticatedGuard` for restrictive session and connected-app revocations.** `DELETE /api/v1/accounts/sessions`, `DELETE /api/v1/accounts/sessions/[token]`, and `DELETE /api/v1/accounts/connected-apps/[clientId]` pass `allowModerationBlocked: true` so a legitimate account owner can terminate attacker sessions and revoke authorized OAuth apps during compromise containment even if the account is disabled or an actor is suspended. Revocation only ever _reduces_ capability (destroying sessions and tokens) and cannot post, follow, or federate on the platform. It relaxes `isActorModerationBlocked` only; CSRF same-origin proof and `isActorConfirmationPending` remain strictly enforced (unconfirmed accounts are still refused with 403).
- **Account-level actor endpoints (`actors/switch`, `actors/cancel-deletion`) authenticate the session's account directly rather than fronting an arbitrary `currentActor`.** `POST /api/v1/actors/cancel-deletion` operates on the target `actorId`, so gating on the session's selected actor would 403 whenever another actor on the same account is suspended (and fail if the only active actor is pending deletion). Like `switch`, it validates same-origin CSRF proof, resolves the account via `getAccountFromSession`, enforces `isAccountConfirmationPending`, and checks that the account owns `actorId`.
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
- Optional external SDKs and database drivers (`@google-cloud/tasks`,
  `@upstash/qstash`, `pg`) must reside in dedicated workspace packages under
  `packages/*` and be imported dynamically (via `dynamicImport` with type stubs
  in `lib/types/optional-modules.d.ts` for queue SDKs, or Knex dynamic driver
  loading for database clients), never through static top-level imports in
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
- Status posts render through the shared `Posts`/`Post` components with the same
  action set on every surface. A page turns actions on with `currentActor` +
  `showActions`; it must not pass per-status action callbacks (`onReply`/`onQuote`/
  `onEdit`), hide individual actions, or build a bespoke post/action row.
  Reply/quote/edit use the shared `InlineStatusComposer`; pages pass only
  data-sync callbacks (`onStatusCreated`/`onPostUpdated`/`onPostDeleted`/
  `onLikeChanged`/`onBookmarkChanged`/`onReactionsChanged`) and
  `isMediaUploadEnabled`. See **Status Posts & Actions** in `AGENTS.md`.
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
- Route loading skeletons (`loading.tsx`) in `(timeline)` reuse `PageHeader` from
  `@/lib/components/page-header` directly with `.skeleton` placeholders (title
  `h-7`, description `h-4`, action button vertically centered via
  `.shrink-0.self-center` in `actions`) so the header height (79px) and action
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
  - Non-header routes (status permalinks, profile pages, tag pages) mirror their
    bespoke card, banner, or title geometry.
  - Content panel skeletons must mirror real component metrics (no double borders
    from `divide-y`, correct card heights and button sizes).
- Settings-style sections (settings, fitness, admin) use the shared
  `SectionNavDropdown` on every breakpoint — no re-inlined dropdown markup and no
  desktop vertical icon rail. Sentence-case labels ("Blocked accounts").
- Fitness stat strips (the activity detail's header strip, the strip under its
  map, the inline chip in a post) render through `FitnessStatGrid` and size
  themselves with **container** queries — no hand-rolled `grid-cols-*` strip and
  no `sm:`/viewport breakpoint, which cannot see a narrow column on a wide
  window. `@container` belongs on a wrapper, never on the grid it sizes. Two
  older strips (gear detail, fitness overview) are not migrated yet — see
  **Fitness Stat Strips** in `AGENTS.md`.
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
  hand-rolled sticky cell. The pinned cell is painted in the card's own surface
  (`bg-card`, never `bg-background` — the design paints the lane the card's
  colour and sets a colour there only to keep the sticky cell opaque, so
  `bg-background` reads as a white stripe down a grey card in light mode and a
  well sunk below it in dark) and must
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
  buttons and any orange text node — icons keep `text-primary`. Move stale
  `text-primary` text over when you touch it; `app/globals.contrast.test.ts`
  guards the tokens.
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
  `accounts/sessions/[token]`, `accounts/connected-apps/[clientId]`) so an owner
  can terminate attacker sessions and revoke connected apps during suspected
  account compromise even while suspended/disabled. It relaxes
  `isActorModerationBlocked` only; CSRF same-origin proof and
  `isActorConfirmationPending` remain enforced.
- Account-level actor management (`actors/switch`, `actors/cancel-deletion`)
  authenticates the account directly via session and same-origin CSRF proof,
  checking account ownership of the target actor rather than gating on the
  session's active actor.
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
  All eleven templates follow this; there is no legacy shape left to copy.
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

- A status's media is **one attachment at its own size, or a horizontally
  scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
  this for every surface that renders a post. A lone picture keeps its own
  aspect ratio and hugs the post's left edge, scaled by WIDTH; the branch this
  replaced cropped every portrait photo to a full-width 16:9.
- Four details of the strip are load-bearing and a "cleanup" that drops any of
  them is a regression: `flex-none` on each item, without which they shrink to
  fit and nothing ever overflows (the whole feature turns off silently);
  `STRIP_ITEM_MAX_WIDTH` (78%) so the next item always
  peeks — that peek is what says "this scrolls" on a touch screen, where the
  back chevron never appears at all; `scroll-snap-type: x proximity`, never `mandatory`, which pulls the
  peek flush the moment the scroll settles; and the forward chevron staying
  visible while the back one appears on hover only.
- **There is no item cap and no `+N` overlay** — scrolling reaches everything —
  so anything the strip renders unboundedly needs a deferral: images pass
  `loading="lazy"`, videos `preload="none"` (`loading` is image-only) — but only
  a video carrying a `poster`. A posterless one shows nothing at all when
  deferred, since its only pre-playback frame comes from the `#t=0.01` fragment,
  and federated video never has a poster. A lone picture or video is
  deliberately eager, being the post's largest element. Re-adding a cap hides
  media the post actually carries.
- The edge fade is a **`mask-image`**, not a background gradient: posts render
  on four surfaces (`bg-card`, `bg-background`, `bg-muted/30`, unframed) and a
  fade painted in one token is wrong on the other three and in dark mode
  everywhere.
- **Filtering is layout-only.** `isVisualAttachment` picks what gets a picture
  box and `isAudibleAttachment` what becomes an inline player; a `.fit` file or
  PDF is skipped rather than rendering an empty box. But the lightbox is handed
  exactly the pictures on screen, indexed into THAT list — passing the raw
  array gives `MediasModal` a blank slide and a wrong "n of m". Anything asking
  "do I have media to show" asks `isRenderableAttachment`, never
  `attachments.length` (`post.tsx`'s link-preview suppression does).
- **A stored dimension of `0` means "unknown", not "zero pixels"** — several
  media-storage paths persist `metaData.width ?? 0` — so every read goes through
  `getMediaGeometry`, which also clamps pathological shapes and falls back to a
  4:3 box so blurhash has something to reserve.
- **A strip item's focus indicator is an `outline` with a NEGATIVE offset.** An
  outset ring is clipped by the strip's own `overflow-x-auto`, and an inset ring
  is invisible — an inset `box-shadow` paints beneath content and the button's
  only child is an opaque image. This has been got wrong twice; the class string
  is pinned by a test.
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
