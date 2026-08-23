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
| `app/api/auth/`       | Authentication endpoints (better-auth)                                                                                                                                   |
| `app/api/v1/`         | Mastodon-compatible API v1 (statuses, timelines, accounts, notifications)                                                                                                |
| `app/api/v2/`         | Mastodon-compatible API v2 (instance info, media, search)                                                                                                                |
| `app/api/users/`      | ActivityPub actor endpoints (inbox, outbox, followers, following)                                                                                                        |
| `app/api/oauth/`      | OAuth 2.0 provider endpoints (authorize, userinfo, revoke) — the token endpoint lives at `app/(nosidebar)/oauth/token/`, serving `/oauth/token`                          |
| `app/api/oembed/`     | Public oEmbed provider (`GET /api/oembed`) returning rich embed metadata for this instance's public/unlisted status pages                                                |
| `app/api/well-known/` | Federation discovery (WebFinger, host-meta, OAuth/OIDC metadata) — NodeInfo is served from `app/api/nodeinfo/` via a `next.config.ts` rewrite of `/.well-known/nodeinfo` |
| `app/health/`         | Unauthenticated `GET /health` liveness probe returning `{"status":"UP"}`                                                                                                 |

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

### Background Jobs

Long-running operations (sending activities to remote servers, processing file uploads) are dispatched to a background queue. Supported backends:

- **Upstash QStash** — Managed HTTP-based message queue (recommended for production)
- **Synchronous** — Jobs execute inline (default, suitable for small instances and local development)

Note the difference where a job is delayed: QStash honours `delaySeconds`, while
the synchronous backend has no scheduler and **drops** any delayed message. Code
that wants a delay must therefore check `getQueue().runsInline` and skip the
delay rather than losing the job (see `syncStatusLinkPreview`).

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
              fitness_file_routes,
              fitness_gears, fitness_gear_components,
              collections, collection_members, collection_timeline,
              blocks, mutes, actor_domain_blocks, filters, reports,
              markers, endorsements,
              lists, featured_tags, customEmojis, translation_cache,
              link_previews, status_link_previews,
              domain federation rules, recipients, counters, poll_choices,
              clients, tokens, auth_codes (Mastodon API OAuth),
              oauthClient, oauthAccessToken, oauthRefreshToken,
              oauthConsent (better-auth OAuth provider)
```

## Technology Stack

| Layer                | Technology                                                           |
| -------------------- | -------------------------------------------------------------------- |
| **Runtime**          | Node.js 24                                                           |
| **Framework**        | Next.js 16 (App Router)                                              |
| **Language**         | TypeScript (strict mode)                                             |
| **UI Library**       | React 19                                                             |
| **Styling**          | Tailwind CSS                                                         |
| **UI Components**    | Radix UI primitives                                                  |
| **Database**         | Knex.js (SQLite / PostgreSQL; MySQL-compatible config paths)         |
| **Authentication**   | better-auth                                                          |
| **Logging**          | Pino                                                                 |
| **Testing**          | Vitest (native ESM)                                                  |
| **Code Quality**     | Oxlint + Prettier                                                    |
| **Package Manager**  | Yarn 4 (exact version pinned via `packageManager` in `package.json`) |
| **Containerization** | Docker (Alpine-based)                                                |
| **Observability**    | OpenTelemetry (optional)                                             |
