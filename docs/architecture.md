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
  ├─ Services: auth, guards, media, fitness, email, queue, federation, translation
  ├─ ActivityPub: create, follow, like, announce, update, delete, undo
  ├─ Jobs: delivery, imports, fitness processing, map and heatmap generation
  └─ Shared UI: post box, posts, settings, profile, timeline, UI primitives
        │
        ▼
Infrastructure boundary
  ├─ Database layer: Kysely with SQLite/PostgreSQL (and its migrator)
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

| Directory             | Purpose                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/(timeline)/`     | Main app pages with sidebar (home, profile, notifications, settings)                                                                                                                                                                                   |
| `app/(nosidebar)/`    | Authentication and standalone pages without sidebar (login, signup, OAuth consent, `/app` offline shell)                                                                                                                                               |
| `app/embed/`          | Public embed widgets (framable interactive heatmap embeds and static share images)                                                                                                                                                                     |
| `app/health/`         | Unauthenticated `GET /health` liveness probe returning `{"status":"UP"}`                                                                                                                                                                               |
| `app/api/auth/`       | Authentication endpoints (better-auth)                                                                                                                                                                                                                 |
| `app/api/inbox/`      | Shared ActivityPub inbox receiving federated activities (rewritten from `/inbox`)                                                                                                                                                                      |
| `app/api/nodeinfo/`   | NodeInfo 2.0 and 2.1 documents and discovery (rewritten from `/.well-known/nodeinfo`)                                                                                                                                                                  |
| `app/api/oauth/`      | OAuth 2.0 provider endpoints (authorize, userinfo, revoke) — the token endpoint lives at `app/(nosidebar)/oauth/token/`, serving `/oauth/token`                                                                                                        |
| `app/api/oembed/`     | Public oEmbed provider (`GET /api/oembed`) returning rich embed metadata for this instance's public/unlisted status pages                                                                                                                              |
| `app/api/users/`      | ActivityPub actor endpoints (inbox, outbox, followers, following)                                                                                                                                                                                      |
| `app/api/v1/`         | Mastodon-compatible API v1 (statuses, timelines, accounts, notifications), plus the activities.next-only `POST /api/v1/web-vitals` browser Web Vitals sink                                                                                             |
| `app/api/v2/`         | Mastodon-compatible API v2 (instance info, media, search)                                                                                                                                                                                              |
| `app/api/well-known/` | Federation discovery (WebFinger, host-meta, OAuth/OIDC metadata) and the Admin › Served domains reachability proof (`activities-domain-check`) — NodeInfo is served from `app/api/nodeinfo/` via a `next.config.ts` rewrite of `/.well-known/nodeinfo` |

### `lib/` — Core Business Logic

| Directory              | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `lib/activities/`      | ActivityPub protocol — building and processing Activity objects             |
| `lib/services/`        | Business logic services (auth, media, notifications, email, etc.)           |
| `lib/services/guards/` | Request authentication guards (session, OAuth token, ActivityPub signature) |
| `lib/database/`        | Database abstraction layer: Kysely domains, the migration runner            |
| `lib/jobs/`            | Background job handlers (sending activities, processing uploads)            |
| `lib/components/`      | Shared React components (posts, post-box, settings, UI primitives)          |
| `lib/config/`          | Configuration loading and validation (Zod schemas)                          |
| `lib/types/`           | TypeScript type definitions (ActivityPub, Mastodon API, database, domain)   |
| `lib/utils/`           | Utility functions (logger, API response helpers, text processing)           |

### `migrations/` — Database Schema

TypeScript migrations that `yarn migrate` runs with Kysely's migrator, registered in `migrations/index.ts` (their names in `migrations/names.ts`). The first, `20261014000000_baseline`, loads the frozen schema in `migrations/baseline/` into an empty database, or records it on one the Knex migrations of v1.192.34 built. Migrations are designed to work with SQLite and PostgreSQL.

## Key Design Decisions

### Database Abstraction

All database operations go through the `lib/database/` layer. Its queries are written with [Kysely](https://kysely.dev/), as plain query functions grouped by domain under `lib/database/domains/<name>/`, bound into the `Database` facade by `getSQLDatabase`; Kysely owns the connection (`createDatabaseConnection` in `lib/database/connection.ts`: better-sqlite3, or a node-postgres pool) and runs the migrations too (see [Kysely](maintenance.md#kysely) in the maintenance guide). This enables SQLite (development/small instances) and PostgreSQL (production) support without changing application code. Only the `better-sqlite3` and `pg` clients are supported.

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

`publicId` is only ever minted on insert — there is no lazy mint — so rows a
pre-publicId build wrote while the column was rolling out were filled in by a
backfill script that ships with v1.192.34; see
[Maintenance](./maintenance.md#public-id-backfill).

### Authentication

Authentication is handled by [better-auth](https://www.better-auth.com/), which provides:

- Local email/password authentication
- Passkey authentication
- Two-factor authentication
- One better-auth instance per served domain and name (`getAuth(baseURL, serviceName)` in `lib/services/auth/auth.ts`, cached under `baseURL + '\n' + serviceName`, LRU-capped at 32): `/api/auth/*` resolves the request's base URL (`resolveAuthBaseURL`) and that domain's identity name (`resolveAuthServiceName`), so a passkey's rpID and origin are the visited host and its rpName and the 2FA issuer are the visited domain's name. The name is a label only (WebAuthn binds a credential to its rpID, a TOTP secret does not depend on its issuer), so renaming a domain leaves saved passkeys and authenticators working; each instance has its own in-memory rate-limit counters. `getAuth()` with no argument (session, token, revoke) uses the configured host and `ACTIVITIES_SERVICE_NAME`. The account security page passes the same name to `TwoFactorManager` as the issuer, through `toTotpIssuer` (colons and control characters dropped)
- Session management stored in the database, slid forward only inside better-auth's own `/api/auth/*` handler, where its `Set-Cookie` reaches the browser (see [Better-auth Session Refresh](#agents-better-auth-session-refresh))
- OAuth 2.0 access tokens (JWT and opaque) for API access

The application also acts as an **OAuth 2.0 provider** (using better-auth's OAuth provider plugin), allowing third-party applications to authenticate users and access the API.

### Served Domains

One server answers on several domains. They come from three places: `ACTIVITIES_HOST` (the primary), the concrete `ACTIVITIES_TRUSTED_HOSTS` entries, and the `domains` table that **Admin › Served domains** edits. Only a row that is `on` is trusted, and a row is turned on only after `checkDomainReachability` (`lib/services/domains/domainCheck.ts`) has fetched `https://<domain>/.well-known/activities-domain-check` and found this server's proof for that host.

- **Host trust is synchronous**, so the active rows live in an in-process snapshot (`lib/services/domains/servedDomainSnapshot.ts`), refreshed at boot, every 30 seconds and after every admin write, and ignored when older than five minutes (fail closed). `getServedHostConfig()` is the config every request-time check uses: `headerHost`/`selectHeaderHost`, better-auth's `baseURL` per host and its `trustedOrigins` (a function called per request), local-domain matching and the federation policy.
- **The proxy has no database.** `proxy.ts` keeps the env rules; a bare `/@user` on a host they do not list is rewritten to `GET /api/handle-redirect`, which redirects onto `headerHost`.
- **Sign-up and instance metadata are per domain.** `resolveSignUpDomain` (`lib/services/domains/signUpDomain.ts`) returns the visited domain's sign-up settings: the server's `registrations.*` on the primary, the row on any other served domain, closed otherwise. `registerAccount`, both `POST /api/v1/accounts` paths, the sign-up page and landing card, `/api/v1/instance`, `/api/v2/instance` and NodeInfo all read it.
- **Identity and policies are per domain too.** `resolveDomainIdentity` (`lib/services/domains/domainIdentity.ts`; `getVisitedDomainIdentity` for server components) answers the visited domain's name, description, contact email, terms of service and privacy policy. Each field is the domain row's own value (`domains.name`, `description`, `contactEmail`, `termsOfService`, `privacyPolicy`; null = "Same as server") while the row is usable (an env domain's row always, an added row only while `on`, the same rule as sign-up), else the resolved server setting (Admin › Server settings). The primary, a wildcard preview host and an off or removed domain get the server identity; only `headerHost` (trust-filtered) picks the domain, so an untrusted Host never resolves a domain's identity. The row overrides (not the merged result) are cached per database for 15 seconds (`domainIdentityCache.ts`, at most 64 domains), and every admin domain write (settings, status, remove) invalidates the cache, across Next's module copies through a shared epoch. The lists and the snapshot never read the policy texts (`getServedDomainWithPolicies` does). It never throws: a failed read logs and serves the server identity. `/api/v1/instance`, `/api/v2/instance` (title, description, contact email, policy URLs), `/api/v1/instance/extended_description`, the terms and privacy endpoints and pages, NodeInfo's `metadata` and the sign-up page's "Join <name>" (`SignUpDomain.displayName`) all follow it, and so does every name label in the app (`getDomainDisplayName`: the name, else the domain): the page titles (the root layout's `generateMetadata`, `%s · <name>`), the web app manifest's `name`/`short_name` (`app/manifest.ts`), the sign-in heading and button, the logged-out landing, the passkey rpName and 2FA issuer (see Authentication) and the `og:site_name` of shared albums and heatmaps. The root metadata and the manifest read `headers()`, so no page is prerendered with one domain's name; every page was already request-time apart from `/_not-found` and the manifest.
- **Admin API**: `GET`/`POST /api/v1/admin/domains`, `GET`/`PATCH`/`DELETE /api/v1/admin/domains/:domain` and `POST /api/v1/admin/domains/:domain/check`, behind `AdminApiGuard`. `PATCH { status }` turns a domain on (after a passing check) or off and is sent alone; the other fields are the Registrations, Identity and Policies boxes (`updateDomainSettings`; identity and policy fields are trimmed text or null for "Same as server", blank is refused, and a policy's `*UpdatedAt` moves only when its text changes). `GET` and `PATCH` answer the domain's `AdminDomainDetail`; the primary's identity and policies are refused (422 `primary`), as they are Admin › Server settings'. The Features box is `PATCH { disabledFeatures }` (see below), refused for the primary the same way.
- **Rules, announcements, reports and features are per domain too** (step 5). `instance_rules.domain` and `announcements.domain` are nullable (null = every domain), `reports.domain` is the reported profile's domain (the host of its actor id, set in `createReport`, so the web route, the API and an inbound `Flag` all fill it) and `domains.disabledFeatures` is a JSON list. Which rows a visit sees is `lib/services/domains/domainAudience.ts`: `getRulesForHost` is the server rules then the domain's own (only an env or active added domain has own rules; the primary has none), `getAnnouncementsDomainForHost` adds the visited domain's announcements to the every-domain ones, and `POST /api/v1/reports` accepts only the rule ids visible on its host. `getInstanceRules({ domain })` is that visitor list, `getOwnInstanceRules({ domain })` one scope for the admin lists and `getAllInstanceRules()` every scope for resolving the rules a stored report cites. Admin writes name a domain through `resolveAdminDomainScope` (`domainScope.ts`: the primary, an env domain or an added row, on or off; rules refuse the primary). Removing a domain deletes its own rules and announcements. The feature list rides in the cached identity overrides (`DomainIdentity.disabledFeatures`, same 15 s cache and invalidation), and `getVisitedFeatures` / `getRequestFeatures` (`visitedFeatures.ts`) turn it into the effective switches for `app/(timeline)/layout.tsx`, Settings › Sidebar and `/api/v1/accounts/bootstrap`: the server switch AND NOT listed (`applyDisabledFeatures`). A domain can only turn off what the server has on. **The admin UI** is on each domain's page (Admin › Served domains › one domain), after Terms and privacy: Rules (the server rules read-only with an "All domains" chip, then the domain's own rules edited in a draft and written together by "Save rules": deletes, then creates and edits with their new positions, the first failure stops and the box resyncs from the server; the primary shows only the server rules and links to Admin › Server rules), Announcements (this domain's own, read-only, plus the count of published every-domain ones, and the "New announcement" button (its accessible name includes the domain), which opens `/admin/announcements?domain=<domain>` with Show on preselected), Features (a switch per feature, disabled and chipped "Turned off on the server" for one the server has off, saved as the whole `disabledFeatures` list; read-only On/Off badges on the primary) and Reports (the open count, capped at 1000, and a link to `/admin/reports?domain=<domain>`). Admin › Announcements gets a "Show on" select and domain chips, and Admin › Reports a "Domain" select (synced to the `domain` query parameter, which only takes a served domain) and a Domain column, all only while more than one domain is served.

### ActivityPub Federation

The server implements the [ActivityPub](https://www.w3.org/TR/activitypub/) protocol for federation:

- **Inbox** (`/api/inbox`, `/api/users/:username/inbox`) — Receives activities from remote servers
- **Outbox** (`/api/users/:username/outbox`) — Lists activities by a local actor
- **WebFinger** (`/.well-known/webfinger`) — Actor discovery, including the `http://ostatus.org/schema/1.0/subscribe` template that points remote-follow visitors at `/authorize_interaction`
- **Remote follow** (`/authorize_interaction?uri=…`) — Mastodon-compatible landing page where a signed-in local user confirms following an account another server sent them to; the outbound half (a logged-out visitor following a local account from their own server) resolves through `GET /api/v1/remote-follow`. A profile that has moved offers neither: it shows a disabled "Follow turned off" to everyone who does not already follow it
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

#### Outbound Delivery Outcomes

`DeliverActivityJob` (`lib/jobs/deliverActivityJob.ts`) treats any 2xx response as delivered (some Pleroma, Akkoma, GoToSocial and Misskey setups answer 201 or 204). A salvageable failure (HTTP 401, 408, 429 and every 5xx except 501; network errors including DNS failures such as `ENOTFOUND`/`EAI_AGAIN`, timeouts such as `ETIMEDOUT`, connection resets/refusals, and TLS certificate errors such as `DEPTH_ZERO_SELF_SIGNED_CERT` or `CERT_HAS_EXPIRED`; see `classifyDeliveryError`) is thrown as `SalvageableDeliveryError` so the queue retries it with its normal backoff; other responses such as 400, 403, 404, 410 Gone or 501 are logged and discarded. Delivery errors never change follow state: a DNS blip or short outage must not drop follow relationships, matching Mastodon, which retries and only marks a domain unavailable after sustained failure. There is no unavailable-domain tracking here yet, so a server that is gone for good costs each job its full retries before it is dead-lettered. `sendUpdateNoteJob` also never changes follow state; it delivers inline and does not retry failed inboxes.

#### Reply Addressing and Communities (FEP-1b12)

A reply from a local user always names the parent's author, as a mention tag and in the recipients (`statusRecipientsTo`/`statusRecipientsCC` in `lib/actions/createNote.ts`): public replies have Public and the followers collection in `to` and the author among the mentions in `cc`; unlisted replies have the followers collection and the parent author in `to` and Public in `cc` (with the mentions); followers-only replies have the same `to` and only the mentions in `cc`; a direct reply names the author only when mentioned or when the parent thread is already direct. `getFederatedStatusDeliveryInboxes` delivers to every named actor's inbox (shared inbox preferred), as Mastodon does for mentions.

When the parent belongs to a community (Lemmy, Mbin, PieFed, Friendica groups), a **public or unlisted** reply to a **public or unlisted** parent is also addressed to the community: the Group actor is added to `cc` and the note carries `audience: <community>`, so delivery reaches the community inbox and the group redistributes the reply. Followers-only and direct replies, and replies to a followers-only or direct parent, never name the community or carry `audience` (a private or direct reply may still address a Group it mentions, or whose post it replies to, like any other actor). The same rule applies to polls and to visibility changes: `updateNoteVisibilityFromUserInput` recomputes the community, so going public or unlisted keeps or gains it, and going followers-only or direct drops it.

Inbound `audience` is not stored (no migration, and the schema accepts any shape), and recipients are stored one row each with no order, so the community is found without relying on recipient order (`getReplyCommunityActorId` in `lib/services/federation/replyCommunity.ts`), among stored actors of type `Group` in the parent's author, `to` and `cc`:

- A parent of ours has no stored community; it is the community of its own parent, followed up the thread (depth limit 20, cycle guard). Its `to`/`cc` are never scanned for a Group. The walk reads each of our posts through the light `getStatusThreadStep` (parent id, author, whether the author is local, `to`/`cc`; two queries, no hydration) and fully reads only the remote post it ends on. Any ancestor, local or remote, that is not public or unlisted stops the walk with no community, so a hidden post in the chain never ties a public reply to a group.
- For a remote parent: the author if it is a Group (Mbin, Friendica); else the one Group in `to`/`cc` that is not a Mention tag of the parent (Lemmy, PieFed); else, when exactly one Group is in `to`/`cc` and it is mentioned, that one (Guppe, Friendica group-by-mention). When the remote parent addresses exactly one Group this way (for example a Mastodon post that mentions a Guppe group, or a Lemmy community), a public or unlisted reply also cc's that Group and carries `audience`: this is the group-by-mention convention of Guppe and Friendica. Several candidates are ambiguous and give no community: a wrong audience makes Lemmy reject the reply, so none is better than a guess.

Because our own notes do not store it either, `sendNoteJob` and `sendUpdateNoteJob` re-derive it (`sendUpdateNote` receives the audience from `sendUpdateNoteJob`) with `getStatusCommunityActorId`: the reply and its parent must both be public or unlisted, the parent's community is looked up as above, and it is used only if the reply's own `to`/`cc` names it. A Group that is merely mentioned, or one mentioned in a private reply, is therefore never used as the audience. `audience` is emitted on the `Create`/`Update` activity and on its note, as Lemmy and PieFed do; the ActivityPub GET/outbox representations of a note do not include it yet.

- **On-demand fetching of full remote reply threads.** Opening a remote status that is not yet stored live-fetches it, and for a signed-in viewer the status page also queues `FetchRemoteStatusJob` to persist the status plus its full remote reply thread: the in-process synchronous queue keeps the awaited run to the focused note's direct replies so the page stays fast, while a real queue walks the whole thread out of band and it appears on a later view (later views resolve the focused status from the database and skip the branch). A queue failure logs and continues — the live-fetched status still renders.

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

External queue clients (`@upstash/qstash` and `@google-cloud/tasks`), the PostgreSQL driver (`pg`), and optional email providers (`nodemailer`, `resend`, `@aws-sdk/client-ses`) are isolated into dedicated Yarn workspaces under `packages/` (`@activities/qstash`, `@activities/cloudtasks`, `@activities/pg`, `@activities/nodemailer`, `@activities/resend`, `@activities/ses`). They are loaded on demand dynamically (via `dynamicImport`, with type stubs for queue and email clients), preventing optional SDKs from being unconditionally bundled into the minimal standalone application. Because the standalone tracer cannot follow `dynamicImport`, `pg` and the packages it depends on are listed in `outputFileTracingIncludes` in `next.config.ts`, which `test/next.config.test.ts` checks against `pg`'s dependency tree. The Dockerfile includes `@activities/nodemailer` by default; builds omitting email workspaces gracefully disable email delivery.

#### Bulk imports (CSV)

`POST /api/v1/imports` reads the request body through a byte counter (the 5 MiB file plus a 64 KiB multipart allowance, answering 413 as soon as it is passed, with or without a `content-length`), and a file over 5 MiB gets 413 `File is too large` too. It then parses the multipart form and a Mastodon-format CSV (up to 20,000 rows), stores it in `bulk_imports` and `bulk_import_rows` in one transaction, then publishes `BulkImportJob`. An actor can have only one unfinished import: `createBulkImport` locks the actor row and refuses a second one, except that an unfinished import is marked finished with `lastError` "Abandoned: no progress" when it has no live claim (null or lapsed) and no `updatedAt` change for 15 minutes (`BULK_IMPORT_ABANDONED_MS`), or when it made no progress for 24 hours (`BULK_IMPORT_STALE_MS`), so a dead-lettered job cannot lock the actor out; abandoning also clears `runToken` and `claimedUntil`, so a suspended holder that resumes loses its lease. If publishing fails outside `NoQueue`, the import is finished with a `lastError` and the route answers 503. Under `NoQueue` the route starts the run detached and answers 202; a run that throws finishes the import with `lastError` "The import stopped because of an error", so it does not block the actor's next import. Row ids are deterministic, `${importId}:${rowIndex}`.

A run works in slices of about 20 seconds (`BULK_IMPORT_JOB_TIME_BUDGET_MS`), well under the 30 second cap QStash puts on a job. The budget is checked after each unit of work: before each overwrite resolution or removal, before each kept-row mark and each bookmark deletion or keep (after at least one, so every continuation makes progress) and after each row, since rows do remote work inline. When it is spent the run saves its place and publishes a continuation: `${importId}:overwrite:N` while the overwrite pre-pass is unfinished (`N` is the saved `overwriteProgress`), or `${importId}:continue:N` in the row pass (`N` is the saved `nextRowIndex`). Under an inline queue (`NoQueue`, `runsInline`) a run is not budgeted and finishes in one go, still claimed and fenced.

Only one run works on an import at a time. A run claims it with a `runToken` and a `claimedUntil` lease of `min(budget, 20 s) + 15 s`, taken by a conditional update that succeeds only when no lease is live, so a lapsed lease can be reclaimed. A heartbeat renews the lease under the same `runToken` (`renewBulkImportRun`) every 10 s (`BULK_IMPORT_HEARTBEAT_MS`, or a third of the lease if smaller) for as long as the run holds the claim, and each unit of work also renews it, so a lapsed lease means the holder is dead. A renewal that updates no row stops the run quietly (lease lost: nothing checkpointed, marked or published); one the run's own work awaits that throws fails the run with that error, with no lastError write and nothing published, so the queue retries, while a heartbeat renewal that throws is only logged and the next unit's renewal re-checks the lease. The run releases the claim before it publishes its continuation, so the continuation is not turned away by its own claim. A run that finds a live claim publishes `${importId}:wait:<runToken>:<claimedUntil>` with a delay that lands after the lease lapses. A wait job carries `waitedFor` (`{ runToken, claimedUntil }`): a live claim with a different token returns without republishing; the same token still live republishes one wait (remaining lease + 2 s, current `claimedUntil` in the id); a lapsed claim is claimed and the run resumes. The error path skips the lastError write when the lease is lost. Under NoQueue the delayed job is dropped, which is fine because the holder is still running in the same process.

When the mode is `overwrite`, the pre-pass runs before the rows. For `following`, `blocking` and `muting`, a row matches a current relation by handle first, then by the actor its handle resolves to, which is stored as `resolvedActorId` in the row data. Mastodon exports the handle with its local domain, while the stored actor's domain is its host, so the two forms can differ; an account the file names is not removed because of that domain difference or because its resolution failed. Only pending rows whose username matches an unmatched relation are resolved over the network, and relation actors are read in batches. A pending row whose resolution failed for a reason that may pass (not `forbidden`) protects an unmatched relation only if the usernames match and the handle's domain (which must contain a dot) equals the relation's host or the host is a subdomain of it: that relation is kept, and the row pass retries the row. The pre-pass removes what the file does not name first, then applies each kept row's side effect (follow preferences or mute) before marking the row, since keeping the final row can finish the import. It is budgeted and resumable through `overwriteProgress`, and sets `overwriteDone` only when it is fully done, so it runs once. Domain blocks and lists are local work and run in one pass with no budget; bookmarks are budgeted (a delete loop, then a keep loop).

Lists imports create their lists once per import (`listsPrepared`), before any row runs: each distinct list name in the file is created by exact title, skipping titles that already exist. A title that fails to create fails only its own rows. A list name must be 1 to 255 characters after trimming, the same rule as `app/api/v1/lists/route.ts`, or the row fails with `Invalid list name`.

The row pass works through pending rows in pages of 100 with one attempt per row, saving `nextRowIndex` after each page. `markBulkImportRowProcessed` only moves a row from pending, and only that transition bumps the counters, so a redelivered job cannot count a row twice; the import finishes when processed meets total. A row that throws is logged and stored with the generic error "Could not import this row" (the exception message can hold internals); expected outcomes such as "Account not found" are stored as they are. An existing follow keeps its stored reblogs, notify and languages when a row leaves them blank or the file has no such column; only a new follow gets the defaults. A following row, or a lists row for another account, fails with `Account is blocked` when either side blocks the other or the importer blocks the target's actor host or its handle domain, as Mastodon's `FollowService` refuses it. It fails with `Account has moved` when the target has moved. Failed rows stay with their error and are listed by `GET /api/v1/imports/:id`. Both tables are deleted with the actor's data.

#### Gallery albums

Albums are owner-curated groups of the owner's own gallery media (`gallery_albums`, `gallery_album_items`; the migration is additive and guarded with `hasTable`). They are never federated and never stored per viewer: every read goes through the gallery scope (`galleryMediaScope`) with `requireInGallery: false` and a required `GalleryAudience`, so what an audience sees is decided at read time by the posts the photos hang off, and the same album shows an owner every photo and a visitor only theirs.

- **The store** is the Kysely `galleryAlbumQueries` (`lib/database/domains/gallery/albums.ts`, bound in `lib/database/getSQLDatabase.ts`). Hidden-from-gallery photos are shown when their post is readable. Summaries, facts, dates, covers and the three-photo collage are all derived from the _visible_ items only, so a hidden photo never shows through a cover, a count or a date range. Sorting, the `<sortKey>:<mediaId>` keyset cursor and the date range are done in JS over a light item index (the sort key is `takenAt ?? createdAt`, or the item's `addedAt` for `added_desc`), because timestamp columns differ between SQLite and PostgreSQL.
- **Caps and races** are enforced in the store, atomically: 200 albums per actor, 2,000 items per album and 1 to 100 ids per request. The item cap counts every stored row whose media still exists, including a photo whose post was deleted (the owner no longer sees it, so the owner detail response carries that count as `storedItemCount` for the Add photos dialog); a row whose media is gone takes no room. Every album write (create, add, edit, remove, delete) and both media-delete paths take the owner's actor-row lock first (`lockGalleryAlbumActor`, PostgreSQL only) and re-read the album after it, so two creates cannot both pass the cap and a cover cannot be set on a photo that is being removed or deleted. Adding takes the owner's posted or Gallery-added media whatever its gallery switch, plus pending uploads, and anything else comes back as `skipped`. `POST /albums` with `media_ids` creates the album and its first photos in one transaction, so a failed add leaves no empty album; it takes an optional `cover_media_id` (one of `media_ids`, else 422) set right after the create with the PATCH rules, and ignored if that photo was skipped.
- **SQLite has no foreign keys**, so `deleteMedia`, `deleteMediaForAccount` and the actor delete remove the matching `gallery_album_items` and null any `coverMediaId` themselves (`removeMediaFromGalleryAlbums`). Hiding a photo keeps it in its albums; deleting it removes it (`removeMediaFromGalleryAlbums`).
- **Add from anywhere** (`lib/components/gallery/MediaAlbumsControl.tsx`, `useMediaAlbums.ts`, `AlbumUndoToast.tsx`; `app/(timeline)/gallery/media/`): one menu, three homes, so the media details dialog (`ownerId` prop), the lightbox (`albumsOwnerId` prop, compared by each caller with the post's author, where the control sits in the viewer's top bar between Details and Edit) and All media's multi-select share it. The lightbox loads the control lazily (`next/dynamic`, `ssr: false`, with `MediaAlbumsPillSkeleton`, the button's height and typical width, as the placeholder) so the menu, the New album dialog and the album picker behind it stay out of the first-load JavaScript of every timeline route that mounts a lightbox (`yarn bundle:report --check` guards it); the one constant the lightbox needs eagerly, `ALBUMS_MENU_SELECTOR`, lives in `mediaAlbumsUi.ts`. `albumsOwnerId` is also what turns on the lightbox's **Edit** button for the owner (see "Edit in Gallery" in [maintenance.md](maintenance.md#media-details-exif-and-gallery-settings)). `GET /api/v1/media/:id/albums` (owner only, 404 for anyone else's media, `getMediaAlbums` in `galleryAlbumQueries.ts`) and `POST /api/v1/gallery/albums/membership` (used by All media's Add to album) serve album membership queries; a toggle is the existing items `POST`/`DELETE`, and a selection from All media goes through `addGalleryAlbumItems` in `lib/client/galleryAlbums.ts`, which splits it into requests of 100 and reports `GalleryAlbumAddError` (with what the earlier batches added) if one fails. The control is deliberately outside any form: it saves on the spot, rolls a failed toggle back, and its message (with Undo) is in the flow, not a floating toast, so it stays inside a modal's focus scope and is never behind the menu. The menu is rendered inside the modal that holds the control (`PopoverContent` takes a `container`): the `aria-modal` viewer, or the details dialog, whose Radix scroll lock would otherwise cancel wheel and touch scrolling in a menu portalled to the body. It is capped to the available height, touches in it are stopped before the lightbox's swipe track, and a press that starts while it is open never closes the viewer. `useMediaAlbums` reports a change (`onChange`) as soon as the write resolves, even if the viewer has moved on, and `GalleryGrid` passes it to `onAlbumsChanged` when the viewer closes (or at once, if it is already closed), so the album page refreshes without swapping the photo being viewed.
- **Additions in albums**: a photo the owner added in Gallery without a post (`medias.galleryAddedAt`, see "Add to gallery" in [maintenance.md](maintenance.md#media-details-exif-and-gallery-settings)) is gallery media for the owner audience only, so the owner's albums list it (its Add to album menu works, and deleting the photo removes its album items) while a visitor's view of the album, including the public album page, never does: the scope still demands a visible post for every audience but the owner's.
- **Gallery filter UI and bundle confinement**: shared gallery filter components (`GalleryMediaFilterBar`, `GalleryMediaFilterEmpty`, `GalleryMediaFilterSheet`, `galleryMediaFilterState`, `useGalleryMediaFacets`) live under `lib/components/gallery/filters/`. To protect first-load bundle budgets on the critical reading path, nothing under `lib/components/gallery/filters/` may be imported by `GalleryGrid`, `GalleryPagedGrid`, `medias-modal/*`, or anything under `app/(timeline)/[actor]/` (profile, timeline, status, and public album pages). The bar has two host shapes: the album picker keeps the inline Species/Place/Date taken/Activity menus with the count line under them, while All media passes `filtersInSheet` to collapse the desktop menus into one **Filters** button (badged with the active-filter count) that opens the same `GalleryMediaFilterSheet` phones use — active filters then show as the phone's removable chips under the row at every width, and the count and Sort sit at the row's right end (the count line remains only on phones).
- **All media page chrome**: the Gallery layout renders `data-gallery-wide` on every route but `/gallery/privacy`, and `app/globals.css` re-declares `--container-content: 1120px` for those routes, so the grid (3/4/6 tiles per row in `GalleryGrid`) and the Gallery title band share the wider column. The page's own `PageHeader` is section mode with `srOnlyTitle` — the visible page name stays the section's `SectionNavDropdown` row, and Add/Select ride that row from sm up (`sm:absolute sm:right-0 sm:top-0 md:top-4` inside the layout's `relative` wrapper; the offset is `sm:top-0` because the wrapper's padding is `max-md:pt-0`), while below sm the actions keep their own row under the dropdown. Day headers stick with `surface="page"`: transparent at rest, gaining the frosted chrome surface (`bg-surface-chrome`, backdrop blur and hairline via `data-stuck`) while pinned. Grid tiles carry quiet round icon badges, top right, for hidden and only-you state.
- **Routes** (`app/api/v1/gallery/albums/**`) are owner-only: a missing album and somebody else's are the same 404, writes check the album, then validate the body (422), then the in-process limit of 120 writes per actor per minute (429). They sit in `routeScopeWiring.test.ts`.
- **Pages**: `/gallery/albums` and `/gallery/albums/[id]` (`app/(timeline)/gallery/albums/`). The detail page's facts are computed for the logged-out audience, and for a private album too (`getGalleryAlbumIndex({ ignoreAlbumVisibility: true })`, after the route has checked ownership), so the owner previews the real public-safe numbers, with an owner-only note of how many places are hidden for threatened species. The same count is on each album card for the owner (`hiddenPlaceCount`, never computed for a visitor). The page's **Share link** copies the public address (`getGalleryAlbumPublicUrl`) and is `aria-disabled` rather than `disabled` for a private album, so keyboard and touch users reach it and read the visible hint it points at (`aria-describedby`).
- **The public page** is `/@user@domain/albums/[id]` (`app/(timeline)/[actor]/albums/[id]/`). It nests under the existing `[actor]` route rather than taking a top-level `/albums/...` path: `[actor]` is a dynamic segment, so a static `albums` child cannot clash with `[actor]/[status]` (a status path is one segment, an album path two), the proxy's ActivityPub rewrites only match `/@user` and `/@user/<id>`, and the back link, the profile and the handle already live there. The page is `force-dynamic` and server-rendered: `resolveGalleryAudience` (the step `resolveGalleryAccount` takes, shared with the routes) turns the session into a `GalleryAudience`, `getGalleryAlbumView` reads the album for it, and `notFound()` answers for a private, missing, foreign or empty-for-this-viewer album alike. `PublicGalleryAlbumView` (client) takes the first page as props and pages with `getAccountGalleryAlbum`; the hero and species chips are the owner page's own components (`GalleryAlbumHero`, `GalleryAlbumSpeciesFilter`). Items use the existing lightbox with the public details route. The owner opening their own public URL gets the owner audience, like the other account gallery reads, and no owner controls; when visitors cannot open the album (private, or no photo a logged-out viewer can see), a note seen only by the owner says so and links to the owner album page (`ownerNotice`, from `getGalleryAlbumShare`).
- **Link previews** are computed in `generateMetadata` from `getGalleryAlbumShare`, which takes no viewer: it always reads the logged-out audience, so the title, the visible photo count, the date range, the country and the cover (one of those photos, full size for stills and the stored thumbnail for video) are identical for a crawler, a follower and the owner, and cannot carry anything the public view hides. An album a logged-out visitor cannot open gets bare `Album` tags with `noindex`, the same for private, missing and empty. The page streams behind `[actor]/loading.tsx` (the album has its own skeleton), so by the time `notFound()` runs the status line is already sent: an unavailable album is HTTP 200 with the not-found body and a `noindex` robots tag, exactly as a missing profile or status already is (checked on a production build; a path that matches no route is a true 404). The body and tags are identical for every unavailable case.
- **Public reads** (`app/api/v1/accounts/[id]/gallery/albums/**`) are `OptionalOAuthGuard` CORS `GET`s that mirror the other account gallery routes: rate limit, then the account (404 for a missing or remote one), then for an album the openability check (`getGalleryAlbum`, 404), then the query (422). The limit is 300 reads per viewer per minute, in process (`tryAlbumRead`), keyed by the actor for a signed-in viewer and by `getTrustedClientIp` for a logged-out one, which exists only when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is on; with no trusted address a logged-out read is not counted, because client IP headers are spoofable and a spoofed key would only let a caller dodge or frame others. The other anonymous gallery reads have no limit at all; these do because an album list reads every visible photo of every public album. They sit in `routeScopeWiring.test.ts`.
- **The profile Albums subview** is `'albums'` in `GALLERY_SUBVIEWS`, offered by `getProfileData` right after Subjects and Recent whenever `getActorHasVisibleGalleryAlbums` is true for the viewer's own audience (a public album with a photo this viewer can see; for the owner, any album), even if the actor has no in-gallery media. When an actor has visible albums but no in-gallery media, the Gallery tab is offered directly with Albums as its only subview.
- **Suggestions** are computed on every `GET /api/v1/gallery/albums/suggestions` and never stored (`lib/services/gallery/galleryAlbumSuggestions.ts`). They read the owner's gallery index (`OWNER_GALLERY_AUDIENCE`, so only the owner's own media that is in the gallery and on a post that still exists, in at most three windows of the index cap, newest first), then group it in JS (`galleryAlbumSuggestionGroups.ts`, pure) so SQLite and PostgreSQL agree. **A photo's day is its UTC date**, the date the gallery and the album pages show (`formatAlbumDateRange`), so a suggestion's title, id and meta line are all on the album's own dates, whatever the viewer's zone. `takenAt` is a real instant when the photo's EXIF has a UTC offset and the camera wall clock stored as UTC when it does not, and the media row does not record which. An **activity** is placed on a day in the viewer's zone (the route's validated `time_zone`, UTC by default, through `localDateKeyAt`), so the two readings can differ. A photo day is matched against the activities on its **UTC date first**; only when none is on it are the viewer-local dates of its photos tried (`photoActivityDays`), and a day takes the count and the public-post check from the reading that matched, never from both. That finds the right activity for a wall-clock photo seen from the zone it was taken in and for an instant seen from any zone, but it is a heuristic: a day can also pick up a neighbouring day's activity (a wall-clock photo late in the evening, an activity early the next morning) when its own date has none, and a wall-clock photo seen from another zone, or an instant taken within hours of UTC midnight, can be matched to a neighbouring day's activity or miss one. Photos with no `takenAt` are skipped. **Trips** split the UTC days wherever two neighbouring days are more than 3 days apart and keep runs of at least 8 photos; **species** need at least 5 photos of one `toSubjectKey`; an **activity day** is a UTC photo day with at least 5 photos and at least one countable fitness activity matched as above (`getFitnessActivitiesInWindow`, the same predicate as the fitness overview). Activities are looked up newest photo days first, in windows of photo days at most 31 days from newest to oldest, which read up to 33 local days once the viewer-local dates are added (`localDayWindow`, one query per window plus its pages), stopping once 6 days matched or after 12 windows, so a long history of activities never hides the newest days and a request costs a bounded number of reads; a suggestion older than the newest 12 windows of photo days with enough photos is not looked for. A group that one existing album already holds is dropped, judged on the photos the suggestion offers (its first 2,000, see below): `getGalleryAlbumItemSets` is asked only about those media ids, in batches, so the owner's album sizes do not matter, and an album that holds all the offered photos of a cut-short suggestion covers it. Suggestions are also offered in Add photos, minus those ≥ 80% already in the album; Use adds. At most 6 are kept per kind, newest first. A suggestion carries `kind`, `title`, `photoCount`, `firstAt`/`lastAt`, a `preview`, at most 2,000 `mediaIds` (`truncated` says more exist), and the place, species and activity counts. Counts come from `computeGalleryIndexFacts`. A title (`galleryAlbumSuggestionTitles.ts`) is public text once the album is, so it speaks only for the photos a logged-out visitor can see (a second index read under `PUBLIC_GALLERY_AUDIENCE`) and never from a followers-only photo. It names a place only when `getPublicPlace` shows the same one for _every_ of them, so a hidden location, a pending, failed or disabled lookup, a threatened species, a photo with no place and photos at two or more different places all fall back to dates. A suggestion none of whose photos a visitor can see gets a generic title with no date, place or species: "Trip", "Species series" or "Day out". An activity day's title says "Activity day" only when one of that day's activities is on a post a logged-out visitor can read (`getStatus` and `isStatusPubliclyReadable`; fitness posts default to followers-only); otherwise it is the date alone. `GET /api/v1/gallery/albums/suggestions/media?media_ids=` returns up to 100 of those photos, owner scope, in the order asked, for the dialog's review grid, which filters the loaded photos by species, place and date and whose **Select all** adds to the owner's picks rather than replacing them. Both routes are owner-only (`read` or `read:statuses`), validate first (422), and are limited in process to 20 and 120 reads per actor per minute (429); they sit in `routeScopeWiring.test.ts`. The dialog fills nothing in until the owner chooses **Use N**, and saves nothing until **Create album**.

#### Gallery lookup jobs

`ResolveMediaPlaceJob` (reverse geocoding) is published after an upload with coordinates commits (the sync upload path and the presigned path's verify step; uploads carry no subject) and after a `PUT /api/v1/media/:id` that changed the coordinates. `ResolveMediaSubjectJob` (GBIF taxon plus IUCN category) is published after a `PUT /api/v1/media/:id` that changed the subject (re-sending the stored one queues nothing). `POST /api/v1/media/:id/lookups`, the owner's Retry, re-publishes whichever of the two has not finished (only the one named by `{ kind }`, when the body names one). Under the synchronous queue they run inline, bounded by the lookup timeouts. The bulk backfill is a script, not a queue fan-out, because Nominatim forbids bursts.

- **A publish after a reset gets a fresh job id.** The upload publishes derive their id from the media and its inputs only, so a doubled verify collapses. Every `PUT` and Retry publish adds a random part: the database queue keeps finished jobs for days and ignores a new job under a taken id, and QStash deduplicates by id, so an edit back to an earlier subject or point would otherwise be dropped and stay `pending` for good. A Retry also sets `retry` in the job data, which makes the job skip a remembered `error` cache row.
- **The Nominatim limiter spaces real starts.** A call books its start only once it holds the slot, sleeps until `lastStart + 1100 ms`, then re-checks the provider's circuit before sending; the 10 s wait cap covers the time queued for the slot as well. So a slow call cannot release a burst of queued calls back to back, and calls queued behind one that opened the circuit are not sent.

- **They write through compare-and-set methods** (`setMediaSubjectLookup`, `setMediaPlaceLookup`): the write names the subject or coordinates the job read, so an edit made in between wins and the stale result is dropped.
- **They never fail the job on a provider error.** The error is stored as `failed` (so the owner sees "Couldn't check" and can retry), cached as an `error` row when the provider was actually asked (an open circuit or the limiter's wait cap is decided in-process and is not cached, so it cannot outlive the circuit or answer another process), logged as a `warn`, and the handler returns normally, so a rate-limited free service is not retried against by the queue. A malformed message is ignored.
- **The privacy rule is fail-closed on their state.** Only `resolved` with an IUCN category outside CR/EN/VU, written when the subject resolved to exactly one species, shows a species-like subject's place. A status that is `pending`, `failed`, `disabled`, `no-match` (from earlier builds) or still unset, or `resolved` with no IUCN category (a genus or family), has its place withheld from everyone but the owner while `hideThreatenedPlaces` is on, so queue lag, an unreachable GBIF or an ambiguous common name hides a place, never exposes one. See "Media Details, EXIF and Gallery Settings" in [maintenance.md](maintenance.md#media-details-exif-and-gallery-settings).

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

### Account data export

`POST /api/v1/account/archives` lets an account owner download everything the
account holds (the user-facing counterpart of the operator-run
`scripts/backup/exportActorArchive.ts`, see [Actor Archive
Export](maintenance.md#actor-archive-export)). It is built by
`ExportAccountArchiveJob` (`lib/jobs/exportAccountArchiveJob.ts`) from
`lib/services/accountArchive/`:

- **One archive per account, one zip.** The default profile's Mastodon-shaped
  files (`actor.json`, `outbox.json`, `likes.json`, `bookmarks.json`, media under
  `media_attachments/files/<storagePath>`) sit at the root, so the archive
  imports as a Mastodon export; in `actor.json` the `outbox`, `likes` and
  `bookmarks` properties name those sibling files by relative path, as
  Mastodon's backup does (the operator CLI keeps the URLs).
  - Every other profile has the same files under
    `activities.next/actors/<domain>/<username>/`. The extras per profile
    (`profile.json`, `statuses.jsonl`, `scheduled.json`, `medias.jsonl`,
    `gallery/*`, `fitness/*`, `graph.json`) live in that same directory.
  - `activities.next/account.json` describes the account,
    `activities.next/drafts.json` is there when the request carried drafts, and
    `activities.next/manifest.json` is always the last entry (format, version,
    `exportedAt`, the server host, the account's id, sign-up domain and default
    actor id, every profile's id and handle with its counts, the entry list and
    warnings).
  - Mastodon's CSV files (`following_accounts.csv`, `lists.csv`,
    `muted_accounts.csv`, `blocked_accounts.csv`, `blocked_domains.csv`,
    `bookmarks.csv`) are written by the same functions as the web app's CSV
    export (`exportPage` / `EXPORT_FILES` in
    `lib/services/exports/accountExports.ts`, called from
    `lib/services/accountArchive/stepsCsv.ts`), beside each profile's
    `actor.json`: at the root for the default profile, in the profile's folder
    for the others. The same data is also in `graph.json`.
  - A file is written one database page at a time (`exportPage`), with the page
    cursor in the step's cursor, so a very long list is spread over slices
    instead of needing one. The cursors survive edits between slices: every
    file pages by a keyset on the row id read through the account export reader
    (`getAccountExportRows`), not by a row that has to still exist, so a deleted
    or re-muted row cannot end a file, skip a row or repeat one. Rows come in id
    order (oldest first only for bookmarks; the other ids are random), so
    members of different lists can interleave, which Mastodon's importer and ours
    accept. A list member carries its list's title.
- **Nothing secret, by construction.** The collectors read through
  `lib/database/domains/accountExport/`, which selects an explicit column
  allowlist per table (`tables.ts`); `profile.json` lists an allowlist of the
  actor's settings keys (`EXPORTED_ACTOR_SETTING_KEYS`), so a setting added
  later stays out until someone lists it. A new column is therefore absent until
  someone lists it, which is the safe direction.
  - Keys, password hashes, 2FA and passkey material, sessions, OAuth grants
    and tokens, push subscriptions and fitness tokens are not in any allowlist,
    and the job test scans every JSON entry's key names.
  - A file is copied into the archive only when its stored path is the
    account's own media (a profile image must be one of the account's `medias`
    rows) and lies under `medias/`; a path that names `archives/`, fitness
    storage or anything else is refused with a warning.
  - `stripExactLocations` removes the media place coordinates, the Fitness
    privacy home point and hidden circles and the Gallery hidden locations from
    the JSON documents; it does not rewrite the owner's files (activity files
    and the EXIF of photos are copied as they are).
- **Resumable, idempotent slices.** The collect stage writes each page to a
  part key under `archives/<id>/<secret>/stage/` that has the writer's id in it,
  and then saves the cursor (`account_archives.progress`) with a compare-and-set
  that records the writer of every part it counts, so a slice killed at any
  point reruns the page and its leftovers are never read.
  - Every delivery takes a lease (a random token and an expiry kept in the
    cursor). The queue messages are numbered runs: message `n` is current only
    while the cursor says run `n - 1` finished, so a duplicate of a finished run
    is dropped and a retry of an unfinished one runs. The next message's id comes
    from its run number, and a run finishes once, so a new run always gets a new
    id. The one deliberate repeat is the recovery of a lost publish: a
    redelivery of a run that already finished republishes the next run under the
    same id (a queue that dedupes drops the copy if the first arrived; Cloud
    Tasks does not, and the lease and run checks absorb a copy). The reaper's
    requeue id has the run number and the reap count in it.
  - A delivery that finds another worker's live lease fails with a retryable
    error, without counting as a failure, so the queue brings it back after the
    lease lapses; a worker that loses its lease finds out at its next
    compare-and-set save and stops.
  - The slice budget depends on the queue (`budget.ts`): 20 seconds on QStash,
    whose jobs are cut off at 30, and four minutes elsewhere. A slice that runs
    out of time saves its cursor and publishes the next message.
  - A slice that throws is retried; the failure count resets only when a slice
    finishes its run, so three failing deliveries in a row, in collection or in
    assembly, mark the export `failed` and delete its files. Errors written to
    the logs have the `archives/<id>/<secret>` part of any path redacted.
- **Resumable assembly.** Writing the zip is a stage of the same cursor, so a
  large export does not need to fit in one slice. `zipFormat.ts` is a small
  zip writer whose state fits in the cursor, with Zip64 records (readable by
  `unzip`, Python, Go, Java `ZipFile` and yauzl; the tests check several of
  them).
  - Staged documents (the JSON, JSON lines and CSV text) are deflated part
    by part when they are staged, with a full flush after each part, so the
    parts concatenate into one deflate stream (closed by an empty final block)
    and no compressor state has to survive a slice; their sizes and CRC-32 are
    recorded while staging, so these entries carry them in the header and have
    no data descriptor, which lets a streaming reader such as Java's
    `ZipInputStream` read them. A resume inside a staged document starts at
    the right part and offset instead of reading the earlier parts again.
  - Files copied from storage (media, fitness files) are stored, not
    compressed, with a Zip64 data descriptor, because their CRC is only known
    at the end: a reader that does not use the central directory cannot read
    past the first of them. Small documents built during assembly
    (`account.json`, the manifest) are built once and kept in the stage, so
    every slice reads the same bytes.
  - The output goes through `ResumableSink` (`objectStore.ts`): on local disk
    a `.partial` file that a resumed slice writes on in from the checkpoint
    offset (opening it changes nothing) and that is cut to its final size and
    renamed at the end; on S3 a multipart upload (8 MiB parts, so at least
    5 MiB except the last) whose UploadId and part ETags are in the cursor
    (completion uses the ETags that `ListParts` lists, after checking their
    count and sizes against the cursor, and falls back to the cursor's ETags
    with a warning when the credentials may not list parts or the store
    answers NotImplemented), with the bytes that do not fill a part kept in a
    staged tail object.
  - A source file that changes while it is exported can give a zip with a bad
    CRC on both sinks (the accepted case; nothing detects it). Every
    checkpoint writes a tail under a new name (the writer and a sequence
    number), and the older tail is deleted only after the cursor that refers
    to the new one has been saved, so a checkpoint whose save never lands
    cannot damage the saved state.
  - S3 calls of an export time out after 30 seconds in total, under the
    lease's grace (the clients make a single attempt (on QStash the 30-second
    job is the tighter limit and needs about 1.7 MB/s at 8 MiB parts), because
    the SDK's retries would triple it and outlive the lease; the slice retry
    is the retry, and a transient error reading a media or fitness file from
    storage fails the slice instead of leaving the file out): the client is
    built with `throwOnRequestTimeout`, which the SDK needs to reject a
    stalled request (without it the handler only logs a warning), and the
    clients that read the media and fitness source files use the same
    timeout. Parts are 8 MiB and grow by 8 MiB every 1,000 parts, so the
    10,000-part limit of S3 is out of reach before about 430 GiB; an upload
    that would pass it fails with a clear message.
  - Two rules keep a worker that stalled past its lease from corrupting the
    export when it writes late. First, every staged object a worker writes
    and the cursor later relies on has the worker's slice token in its key,
    and the saved cursor records which writer's object it counts (staged
    document parts, file index parts, the directory and name parts, generated
    documents, the upload's tails); a late write creates a key nothing refers
    to, and such orphans go with the archive's prefix when the export
    finishes, fails or expires.
  - Second, the zip output itself (the S3 parts, the local `.partial`
    file) is shared by every worker that resumes from a saved cursor, so every
    byte written to it is a function of the saved cursor and the objects it
    names: a generated document (`manifest.json`, `account.json`) is stored
    and named by a cursor save before any byte of it is written out, and the
    copied source files are read as they are (one deleted during the export
    can be copied by one worker and skipped by another, which is accepted).
  - Before each write a worker also checks its own lease with a 45-second
    margin and stops with a retryable error, only so a stalled worker ends
    early; correctness does not depend on it. A source file that sends
    nothing for 45 seconds fails the slice (the request timeout ends at the
    response headers). A worker that fails after losing its lease logs and
    stops without writing a failure into the new owner's cursor. A failed
    export aborts its upload from the saved state alone, without reading the
    staged tail.
  - A large source file is copied across slices by byte range
    (`Range: bytes=n-`), and the set of claimed entry names (to drop
    duplicates) is kept as eight-byte hashes in staged parts, not read back
    from the central directory. Each attempt writes its own
    `archive-<attempt>.zip`, so a second worker finishing the same slice
    cannot clobber or delete the file the first one marked ready; the
    `ready` update is a compare-and-set, and the loser deletes nothing.
  - An abandoned S3 multipart upload that nothing aborts (a crashed worker)
    costs storage until it is aborted: add a bucket lifecycle rule that aborts
    incomplete multipart uploads after a day or two.
- **Storage.** The files use the media storage (local disk or S3-compatible),
  under the reserved `archives/` prefix, and the key holds a random secret
  segment that only the database row knows: `archives/<id>/<secret>/...`. The
  public files route refuses the prefix (`isReservedFitnessMediaPath`), and the
  owner-only download route is the only way out.
  - On a private bucket it redirects to a five-minute signed URL
    (`Content-Disposition: attachment`); on local disk, and on a bucket with
    `ACTIVITIES_MEDIA_STORAGE_HOSTNAME` set (it may be served publicly, and a
    signed URL carries the secret key, so anyone holding it could drop the
    signature), it streams the file through the server after the owner check.
  - The streamed download honours one range form, `Range: bytes=n-` (206, or
    416 past the end), so a broken download can resume; the transfer still has
    to fit the host's request duration, so a platform with a short function
    limit (serverless) needs the file served by the bucket (leave the hostname
    unset) or a longer limit. A ready row whose object is gone answers 404.
  - Do not serve the bucket or the `archives/` prefix through a public CDN
    hostname: the secret segment makes a key unguessable, but it is not an
    access control. Deleting an export deletes `archives/<id>/`.
- **Limits.** One queued or running export per account (a partial unique index
  on `account_archives`), one request per 7 days (`429` with `nextAllowedAt`
  and a `Retry-After` header, whether the earlier export is running or
  finished; a failed export does not count), drafts capped at 5 MiB and
  reduced to an allowlist of fields with no attachment bytes; the request body
  is counted as it arrives and refused past 6 MiB.
  - A ready archive expires after 7 days: a delayed `ExportAccountArchiveJob`
    (`action: 'expire'`) deletes it under a real queue,
    `startActorDeletionSweep` does the same every ten minutes (the only
    mechanism under the in-process queue), and the list and download routes
    expire a due archive on access.
  - Every cursor save moves `account_archives.heartbeatAt`; an export whose
    heartbeat is an hour old (a dead worker, a lost message) is reaped by the
    same sweep (oldest heartbeat first) and by
    `GET /api/v1/account/archives`: its current run is requeued, counted in
    `reapCount` (up to three times in a row: a run that makes progress sets it
    back to 0), or, behind the in-process queue or after the third reap, it is
    marked `failed` (only if it did not resume since the row was read) and
    its files and unfinished upload are discarded; a failed export does not
    count against the 7-day limit.
  - A suspended (moderation-blocked) account can still list and download its
    own exports, as an export is the user's copy of their data.
  - When an account's last actor is deleted (`deleteActorJob`, checked again
    after the deletion for two actors deleted at once) or a pending account is
    rejected, its exports' files are deleted first and then its rows, so a
    deleted account's full export does not linger.
    `scripts/maintenance/cleanupMediaStorage.ts` and the operator backup
    (`scripts/backup/productionArchive.ts`) skip the `archives/` prefix like
    the fitness prefix.

### Account data import

The account archive importer restores a Mastodon archive or an `activities.next`
account export into the signed-in actor's current profile. Account & security →
Import and export (`/account/import-export`) is the web UI for it.

#### Records, phases and recovery

`account_imports` stores the importing account and actor, archive kind and
options, upload token and byte count, state, phase and cursor, progress, lease
token and expiry, reason-code error, and lifecycle timestamps.
`account_import_items` is the resumable catalog: one source item per import
kind, with its source id, position, raw JSON while needed, state, reason code
and imported target id. A partial unique index allows one queued or running
import per actor (profile). Import starts are limited to three per account in
a rolling 24-hour window; every profile of the account shares the same limit.
Only starts that reached `startedAt` count, so an uploaded archive that is
never started does not use a start.

The worker takes a database lease for each slice, renews it around writes and
stops each queued slice within a 20-second budget. Each continuation job id is
deterministic from the import, phase/cursor and a persisted, increasing pass
counter; a later continuation or reaper pass therefore gets a fresh id even
when it resumes the same cursor. The phases run in order: inspect the archive,
catalog items, restore profile and settings, gears, media, statuses and albums,
pass through the collections no-op, process archived fitness files for
`activities.next` archives, then finish. Status and item cursors let a worker
continue where it stopped. Statuses are processed in published order so
available parents are handled before replies. A reply whose parent cannot be
imported is skipped as `parent_unavailable`; it does not keep the statuses
phase cycling. The catalog phase reopens and rescans the ZIP from its beginning
on continuation, skipping catalog positions already recorded.

`DELETE /api/v1/account/imports/:id` marks a queued or running import cancelled
and queues cleanup; the runner checks cancellation before continuing. The
periodic stuck-import sweep runs every ten minutes. A running import with an
expired lease and no progress for an hour is requeued if its owner is still
available. A missing actor/account, suspended or disabled actor, or actor
being deleted is failed with `actor_unavailable` and its staged upload is
deleted when the import row is still present for the sweep to inspect. An
otherwise available import still stuck for 24 hours is failed
with `import_stuck` and its upload is deleted. When an import reaches `done`,
`failed` or `cancelled`, its catalog rows' raw `data` is cleared in the same
database transaction; processed, skipped and non-retryable failed items also
clear their raw data as they finish. Retryable failed items retain it until
they are retried or the import becomes terminal.

`GET /api/v1/account/imports/:id` serves an outcome `report` once an import
is terminal (`done`, `failed` or `cancelled`): one grouped query over the item
catalog counts done items by kind and skipped and failed items by reason code
(`unknown` for a row without one). While an import is queued or running the
field is absent, so a moving count is never served; the list route never
includes it.

Import-level failures use fixed reason codes. `archive_changed` means a
previously started archive changed during a later read; the start endpoint
returns `409` if it detects a changed archive during inspection. `upload_expired`
means a queued upload was not started within 24 hours; the sweep marks it
failed and deletes its staged upload. An upload that cannot be stored fails
the queued row with `upload_empty` (an empty body), `file_too_large` (over the
configured cap, or not the declared size) or `upload_failed` (the store refused the
streamed bytes); a presigned URL that cannot be created fails it with
`upload_url_failed`, and a start that cannot queue its job fails the running
row with `queue_failed`. A ZIP-level refusal fails the import with `archive_`
plus the reader's reason: `archive_not_a_zip`, `archive_unsafe_name`,
`archive_entry_too_large`, `archive_ratio_too_high` and
`archive_total_too_large` (the entry-count cap and the 200,000-item catalog
cap share `archive_too_many_entries`, described with the bounds below). Any
other error fails the import with `import_failed`. An individual catalog item
that errors is marked `failed` with reason `item_failed`, while the rest of the
import continues and can still finish with status `done`. Failed items do not
increase `completedItems` or `skippedItems`, so those progress counts may not
add up to `totalItems`. When the same actor imports the same source again,
pending or failed rows can be claimed again, as can skipped rows whose reason
depends on an option or size limit (`option_disabled`, `reply-to-other`,
`media_too_large`, `media_quota_exceeded` or `fitness_too_large`). Other
skipped verdicts remain settled.

Skipped items record a reason code. `option_disabled` marks a like or bookmark
whose option is off; `reply-to-other` a reply excluded by the replies option;
`reply-uri-too-long` a kept reply whose parent URI exceeds the 255-character
`statuses.reply` limit; `boost` an Announce activity; `direct` a Mastodon
direct message; `invalid` an item that fails schema validation;
`bad-date` an item with no parseable publication time; `foreign-author` an item
whose author is not the archive actor; `parent_unavailable` a reply whose
parent is not in the archive; `local_status_missing` a like whose target is no
readable local status; `bookmark_unavailable` a bookmark row that could not be
imported; `archive_item_invalid` an item whose stored data is no longer
usable; `media_missing` a media file absent from the archive;
`media_type_unsupported` a media type the importer does not accept;
`media_too_large` and `fitness_too_large` content over its size limit;
`media_invalid` media bytes that fail validation or decoding;
`media_quota_exceeded` media that would exceed the owner's storage quota;
`gear_invalid` a gallery or fitness gear record that fails validation;
`album_invalid` an album record that fails validation; `album_limit` an album
over the per-actor album limit; `fitness_invalid` a fitness file whose record
or bytes fail validation; `fitness_missing` a fitness file absent from the
archive; `status_unavailable` a fitness file whose status was not imported;
and `storage_unavailable` a media or fitness save no store accepted anything
for (no storage configured). `storage_unavailable` is a settled skip: the row
is not re-claimed on a later import, unlike the option- and size-limit
verdicts above.

#### Archive and document bounds

Uploads default to 10 GiB, configurable with
`ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE`. The ZIP reader checks the central
directory before inflating anything: at most 200,000 ZIP entries, 2 GiB
uncompressed per entry, 20 GiB uncompressed across entries, and a compression
ratio of at most 1,000:1. Entry names must be relative and cannot contain a
backslash, NUL, drive prefix or `..` path segment; directory and symlink entries
are ignored. The importer reads the stored ZIP with random-access ranges. It
does not extract files to disk, and it never opens a ZIP nested inside an
archive. At start, the importer records the upload size and available ETag and
checks that identity on later range reads. S3 range requests use `If-Match` for
the recorded ETag. If a later read detects a changed object, the import fails
with `lastErrorCode: archive_changed`.

Mastodon's `outbox.json` `orderedItems` array, own-export JSONL files and root
JSON arrays are scanned incrementally, one item at a time. Each item or line
is capped at 512 KiB; root JSON arrays are capped at 256 MiB total. Selected
root-field scanners cap each source document at 4 MiB, keys at 1 KiB and
captured values at 64 KiB (8 KiB for selected strings). `actor.json`, the own
export's `profile.json`, and its gallery settings document are read through
these bounded top-level scanners: selected fields are captured, and no profile
or settings document is parsed whole. Independently of the ZIP-entry limit,
the importer enforces a 200,000-item cap on cataloged items; exceeding it fails
the import with `archive_too_many_entries`.

#### Quiet writes and imported data

The status writer inserts the local status directly with its archived creation
time, rebuilt recipients and owned tags, attachments, polls and edit history;
it does not use the ordinary create-and-publish path. The `noSideEffects`
guard rejects status publication, timeline, notification, preview, arbitrary
HTTP and arbitrary queue helpers, while explicitly allowing the bookmark CSV
import path and fitness processing job. Likes are added only when the target
status is local and `canActorReadStatus` says the importing actor can read it.
Bookmarks go through the same `importRow` path used for CSV bookmark imports.
With `repliesToOthers: "keep"`, a foreign parent's URI is stored as data in the
imported status's `statuses.reply` field, which is limited to 255 characters;
the importer never fetches that parent. A parent URI longer than 255 characters
cannot be stored, so that reply is skipped with reason `reply-uri-too-long`
and never stored truncated. Local thread reads resolve a parent
only from a status already stored in the database.

There are two current exceptions to the quiet/security goal that callers
should account for. When `profile` is enabled and a federated profile field
changes, the profile phase calls `publishActorUpdate`, sending one ordinary
ActivityPub `Update(Person)`. For bookmarks, `importRow` can queue
`fetchRemoteStatusJob` when an archive URI names an unknown remote status, so a
URL from the archive can be fetched indirectly. Other archive URLs are used as
identifiers or matched to safe paths inside the archive; media and profile
image bytes are read from archive entries rather than fetched from their
source URLs. These two code paths mean that the global guarantees “no archive
URL is ever fetched” and “no federation” are not currently true for every
option combination.

Status public IDs are deterministic from the importing actor id and source
status id, with the archived publication time as the UUIDv7 timestamp. This
keeps repeated imports stable without allowing one actor's archive to claim
another actor's IDs. Mastodon Create activities must name the archive actor as
both activity author and note author; own-export status rows must also match
the archive actor. Foreign-author records are skipped. Archived publication
times must parse and cannot be more than five minutes in the future. Archived
edit supersede times must also parse, be no more than five minutes in the
future, and be at or after the original publication time; accepted revisions
are restored into status history at their archived times.

Media is matched to archive paths and sniffed from its bytes before storage.
Profile images are likewise archive-local and type-checked. The importer does
not enqueue gallery subject or place enrichment jobs. Fitness files are
processed with `publishSendNote: false` and `notifyOnComplete: false`, so
processing does not publish a fitness note or send a completion notification.

The optional profile restore allowlist includes display name, bio, profile
fields, avatar and header images. A profile image the importer itself refuses —
the sniffed type is not a stored png or jpeg, or the bytes fail the media
schema or the decode check — is skipped with `media_invalid`, as is one the
media path refuses because the bytes fail its validation; an image the
account's storage quota refuses is skipped with `media_quota_exceeded`. The
rest of the profile still applies. The profile phase keeps no item rows, so
these skip reasons are recorded in the import's progress — the import API
shows them on the run — and logged rather than recorded on the catalog. If
anything fails after an image was stored (the header's own read or save, a
cancellation, or the profile update), every image the run stored is deleted
instead of left orphaned, and the phase fails for its own reason. The settings option
reads only this server's own export. Its actor-settings allowlist is
`defaultPrivacy`, `defaultSensitive`, `defaultLanguage`, `defaultQuotePolicy`,
`postLineLimit`, `readingExpandMedia`, `readingExpandSpoilers`,
`readingAutoplayGifs`, `notificationPolicy`, `showMedia`,
`showMediaReplies`, `showFeatured`, `discoverable`, `indexable`,
`hideCollections` and `manuallyApprovesFollowers`. Its gallery-settings
allowlist is `autoDescribe`, `allowEmptyDescription`, `subjectHashtags`,
`galleryDefault`, `defaultPlacePrecision`, `showGear`, `mapPublic`,
`lifeListPublic`, `hiddenLocations`, `hideThreatenedPlaces`,
`subjectSuggestionMode`, `subjectConfidenceThreshold` and `photoEnhance`.
Fitness OAuth settings and other secrets, delivery toggles and actor-identity
fields are excluded. The import API exposes fixed `lastErrorCode` values rather
than exception text; archive exceptions are mapped to reason codes and redacted
before logging, and raw archive exception messages are not returned to the
owner.

Editing an imported status later uses the ordinary edit path and sends its
normal federated `Update`. The catalog phase rescans the ZIP on resume as
described above.

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

A fitness route heatmap row can be tile-backed:
`fitness_route_heatmap_pyramids` and `fitness_route_heatmap_tiles` hold a
per-actor tile pyramid, and every surface that draws a heatmap reads tiles when
the row has them. The stored geometry blob the row also carries is simplified
once against a single global budget set by the actor's whole history, so it can
only ever be drawn at one fidelity — zooming in reveals nothing the blob does
not already contain.

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
  privacy flag is stripped exactly as the public flattening strips it, and
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

The stored blob is still the fallback. It renders every row the pyramid cannot
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

`canvas.toBlob` drops all EXIF, so the composer and Add to gallery call
`resizeImage` with `{ keepMetadata: true }`: for a JPEG that actually gets
resized, the original's Exif APP1 segment is grafted into the resized bytes
(`lib/utils/jpegExif.ts`) with Orientation reset to 1, because the canvas is
already upright and the server applies EXIF orientation again. The server can
therefore still read the taken date, gear and GPS of a 12 MP phone photo.
Avatars and headers (`ImageUploadField`, `ProfileImageField`) do not keep it.

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
without a per-route list. Raising `proxyClientMaxBodySize` is not the fix: it
would have to track the runtime upload caps, which `next.config.ts` must not
read, and it buffers every in-flight upload in memory once more. Two paths are
always matched whatever `Content-Type` is sent: bare `/api` (the catch-all
excludes only `api/` followed by a segment), so it still gets the proxy's
404/405 instead of falling through to a page route, and `/api/v1/files/*`,
because the matcher ignores the method and a GET with a multipart header must
not produce a CSP-less, year-cacheable file response. `test/proxy.test.ts` checks
the matcher with Next's own config parser and runtime matcher. Do not fold the
`/api` entries back into the catch-all.

**Photo edits are non-destructive.** The photo editor renders the edit in the
browser and uploads the result (`POST /api/v1/media/:id/edit`); the server never
applies a recipe itself. It checks the render's pixel size against the recipe
(`getRecipeOutputSize` in `lib/services/medias/edit/geometry.ts`, within 2 px),
stores it through the same pipeline as any image (`saveEditedImage` on both
drivers: WebP, no EXIF, inside the 4000 px box) and makes it the live file:
`medias.original` points at the render, so every reader (the Mastodon entity,
the gallery, new posts) serves it with no special case. The recipe, an
optimistic `editVersion`, `editedAt` and the client's `editSaveId` live on the
`medias` row.

The files an edit keeps sit in `media_edit_files`, one row per slot:

- `original`: the file the photo was uploaded as, moved there by the first save
  together with its `originalMetaData` (including `upload.clientPath`), BlurHash
  and focus, so a revert (`POST /api/v1/media/:id/edit/revert`) restores every
  field exactly.
- `superseded:<id>`: an earlier render a post may still show. "Update posts"
  points each post at the new file (an ordinary edit of the post, sent as
  `Update(Note)`) and then prunes the superseded renders; "Gallery only" keeps
  them, because those posts still reference them.
- `mask:<id>`: the raster of a subject or brush mask of the recipe (a
  background mask is the inverse of its subject and has none). The browser
  makes it (the subject model or the brush) and uploads it as a `mask_<id>`
  PNG part of the save, only when it is new or its pixels changed; the server
  checks it is a PNG in the source's shape, at most 1024 px on its long edge,
  and stores its first channel through `saveMaskImage` (PNG, compression 9).
  A save upserts the slots of the recipe's masks and removes the others,
  deleting the released files after the commit; a revert removes them all.
  The editor reads a mask through the owner-only
  `GET /api/v1/media/:id/edit/masks/:maskId` (`Cache-Control: private`; the
  URL `GET …/edit` lists carries `?v=<row id>`, so a replaced mask is a new
  URL). Masks are never federated and are in no public entity.

The prune belongs to the latest write only. Updating the posts can take
seconds (each one federates), and a save or revert from another tab can
commit meanwhile: a "Gallery only" one supersedes this save's render precisely
so that the posts just updated keep it. So `pruneSupersededMediaEditFiles`
takes the version the write produced and, under the row lock, prunes nothing
once the media has moved past it, and `refreshPostsForEditedMedia` stops (the
rest go to `skipped`) as soon as the media's version moves, rather than
pointing a post at a render the later write is free to prune. That check runs
before each post's write, so a refresh can still write an older render into a
post just after a later save committed; the prune therefore also keeps any
superseded render an attachment of the photo still shows. For an edited
photo, the file a post shows is never taken from the client as sent:
`resolveOwnedAttachments` accepts the live file or, on an edit, the file that
post already shows for the photo. Anything else (a stale composer, an outbox
client, a refresh that lost a race with a later save) falls back to the file
the post already shows for the photo, so a refresh racing a later "Gallery
only" save or revert leaves the post as it was rather than writing that save's
file into it. Only a photo new to the post (a new attachment, or a new post)
takes the live file.

A "Gallery only" post keeps the file it was published with, and later edits of
that post keep it too: `withAttachmentMediaMetadata` re-reads the BlurHash,
focal point and thumbnail from the media row only for an attachment showing the
live file, and an attachment still on an earlier file of an edited photo keeps
what its row recorded for that file (so an "Update posts" save of another photo
in the post, or a text edit in the composer, does not federate the new
render's placeholder and focal point with the old image). Every edit through
`PUT /api/v1/statuses/:id` keeps each photo's file too: an alt-text or
focal-point edit (`media_attributes`, from the composer, the Gallery's Edit
details or a Mastodon client), a text edit from a Mastodon client (which
resends `media_ids`), and the composer adding, removing or reordering photos
(`media_ids`). The route rebuilds each photo the post already shows on the
file its own row shows (`withStatusAttachmentFile`); only a photo new to the
post takes the live file. A focal point set on a photo the post still shows on
an earlier file was drawn on that file, so it is written to the post's
attachment row and the media row (the render's) keeps its own. Only two
things move such a post to the live file: an "Update posts" save of that
photo, and a revert with "Update posts". A superseded
render is pruned once no post shows it, but the post's edit history
(`status_history`, `GET /api/v1/statuses/:id/history`) still names it, so an
earlier revision's media then points at a missing file (it keeps its BlurHash,
so clients that draw one show the placeholder); renders are not kept for the
history. A thumbnail a client uploaded for a photo stands for the image as it
was, so an edited photo has none (`getLiveThumbnail`): its `preview_url` and
the attachment's thumbnail are the edited file, until a revert.

Every kept file counts toward the account's storage usage, masks included (a
save checks the quota for the render and its mask parts together). The editor reads the
uploaded original through `GET /api/v1/media/:id/edit/source`, served from this
origin with `Cache-Control: private` so the canvas is never tainted by a CDN or
S3 origin. Deleting a media removes these rows and their files too. Deleting
an account or an actor removes the rows and frees their bytes from the usage
counter, and leaves the files to the storage cleanup script
(`cleanupMediaStorage.ts`), as it does the media's own files. The storage
cleanup and both archives treat the files as referenced.

### Offline-First PWA Launch & Timeline Caching

The application provides an instant, network-independent launch shell at `/app` (with Service Worker root fallback) backed by an IndexedDB status and timeline store with contiguous segment tracking, bounded retention, and background revalidation. See [Offline-First PWA Launch & Timeline Caching](#agents-offline-first-pwa-launch-timeline-caching) for full details.

### Browser Web Vitals

Optional, off by default, and meant for an operator who already collects the server's stdout. A sample of page loads reports Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS) and Interaction to Next Paint (INP) from the browser; the server writes each metric as one structured log line. Nothing is stored in the database and nothing leaves for a third party, so **without a log pipeline reading stdout the numbers do not aggregate anywhere**. The app has no OpenTelemetry SDK or metrics exporter, which is why the log is the sink.

- **Switch and sampling.** `ACTIVITIES_WEB_VITALS_SAMPLE_RATE` (0 to 1, default 0) is read at request time on dynamic routes, never baked into them at build time. The root layout mounts `WebVitals` (`lib/components/web-vitals/WebVitals.tsx`) inside a `Suspense` boundary; dynamic routes already render per request so `getWebVitalsConfig()` reads the runtime rate there without calling `connection()` (prerendered static pages such as `/_not-found` stay static and use the build-time value, normally 0 = off), and `WebVitals` renders `WebVitalsLoader` (`lib/components/web-vitals/WebVitalsLoader.tsx`) only while the rate is above zero. Because the root layout references `WebVitalsLoader`, Next keeps that tiny client loader in the root layout's client bundle on every page. `WebVitalsLoader` rolls `Math.random()` once per page load: an unsampled page load downloads only the small loader and registers no observers. `WebVitalsReporter` (`lib/components/web-vitals/WebVitalsReporter.tsx`), `webVitalsCollector` and `web-vitals` live in a separate async chunk that `WebVitalsLoader` imports in an effect only when sampled.
- **What is collected.** Only `LCP`, `CLS` and `INP` (the rest of what `useReportWebVitals` emits is ignored), each as `{ name, value, rating, navigationType, route, device }`. `value` is rounded (milliseconds, or CLS to three decimals), `rating` is web-vitals' `good`/`needs-improvement`/`poor`, `navigationType` comes from a fixed list (`other` for anything new), `device` is `mobile`/`tablet`/`desktop` from the viewport width at 768 and 1024 px. The release is added server-side, never sent by the browser.
- **Privacy allowlist.** `route` is a **route template** from the fixed list `WEB_VITAL_ROUTES` (`lib/utils/webVitals/types.ts`), chosen by `getWebVitalsRoute` (`lib/utils/webVitals/classify.ts`) from the pathname alone: `/[actor]/[status]`, `/tags/[tag]`, `/settings/*`, `other`, and so on. An actor handle, status id, tag, token, query string, DOM text, element selector or coordinate can not be sent, because the browser builds the report from those vocabularies and the endpoint's strict schema rejects anything outside them. A new page needs an entry in `WEB_VITAL_ROUTES` and `getWebVitalsRoute` to get its own bucket; until then it reports as `other`. The endpoint logs no IP address, user agent, cookie or URL.
- **Sending.** `createWebVitalsCollector` (`lib/components/web-vitals/webVitalsCollector.ts`) keeps the latest value per metric id and flushes on `visibilitychange` to hidden (and once more right after, because web-vitals reports the final values from its own listener) and on `pagehide`, in reports of at most six metrics, at most 30 metrics per page load. A metric id is sent once; a value that changes after its id was sent is dropped, so a tab that is hidden and shown again reports its first-hide values. Where the browser supports soft-navigation timing (currently Chromium behind a flag), soft navigations report their own metrics keyed by that navigation's URL; elsewhere CLS and INP accumulate over the whole session and are attributed to the route of the page load. `sendWebVitalsReport` (`lib/client/webVitals.ts`, re-exported by `lib/client.ts`) uses `navigator.sendBeacon` with a JSON blob and falls back to `fetch` with `keepalive`; a failure or a missing API drops the sample silently. The reporter imports the module directly rather than the `lib/client` barrel so the reporter's chunk stays small.
- **Endpoint.** `POST /api/v1/web-vitals` (`app/api/v1/web-vitals/route.ts`), unauthenticated and not traced (like `/health`). In order: `404` while the rate is 0; `403` without same-origin proof (`hasSameOriginProofQuietly`, the `hasSameOriginProof` check without its per-rejection warning, since anyone can send forged requests); the per-process cap, over which a request is answered `202` like an accepted one without being read or logged (at most one `warn` per clock minute per process); `413` for a body over 2 KiB, read through `readRequestTextWithLimit`; `400` for invalid JSON; `422` for a body the strict Zod schema (`lib/services/webVitals/schema.ts`) rejects: one to six metrics, only the six fields above, enums for the rest, finite non-negative values up to 120000 (LCP), 60000 (INP) or 10 (CLS). `ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE` (default 600) is a per-process cap, per fixed one-minute window, on same-origin report requests whether valid or not (so a deployment with several instances has several caps); each accepted report is at most six log lines.
- **Log shape.** One `info` line per metric: `{ message: 'web-vitals', webVitals: { name, value, rating, route, device, navigationType }, release }`, where `release` is the package version (the logger's own `serviceContext.version` is the Cloud Run revision on GCP). One line per metric, not per report, because a log-based distribution metric reads one numeric field per line, and LCP/INP (milliseconds) and CLS (unitless) need separate metrics.
- **Charting p75 in Cloud Logging.** The logger writes structured JSON with `severity` on GCP, so the fields arrive as `jsonPayload`. Create one distribution log-based metric per vital, for example `web_vitals_lcp`, with the filter `jsonPayload.message="web-vitals" AND jsonPayload.webVitals.name="LCP"`, the field name `jsonPayload.webVitals.value`, units `ms` (none for CLS), and label extractors on `jsonPayload.webVitals.route`, `.device`, `.rating` and `.navigationType`. Pick bucket bounds around the thresholds (exponential for LCP and INP, linear for CLS). In Metrics Explorer, aggregate the metric with the 75th percentile aligned over an hour, grouped by `route` or `device`. Percentiles from a distribution metric are interpolated from its buckets, so they are approximate; a sample rate changes the count, not the percentile. Other log pipelines can filter on the same fields.

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

Other tables: sessions, notifications, medias, gallery_gears,
              gallery_settings, gallery_lookup_cache, gallery_albums,
              gallery_album_items, fitness_files,
              fitness_settings, strava_archive_imports,
              wahoo_imports, wahoo_history_imports,
              fitness_route_heatmaps, fitness_route_heatmap_region_names,
              fitness_route_heatmap_pyramids, fitness_route_heatmap_tiles,
              fitness_file_routes, fitness_file_route_data, fitness_import_locks,
              fitness_gears, fitness_gear_components,
              fitness_gear_component_periods,
              collections, collection_members, collection_timeline
              (retired; unused, kept until dropped),
              blocks, mutes, actor_domain_blocks, filters, reports,
              moderation_actions, server_filters, server_filter_keywords,
              markers, endorsements,
              lists, featured_tags, customEmojis, translation_cache,
              link_previews, status_link_previews, status_quotes,
              status_reactions, announcements, announcement_reads,
              announcement_reactions, instance_rules, suggestion_dismissals,
              domain federation rules, relays, federated_timeline,
              status_detected_languages, recipients, counters, poll_choices,
              server_settings, domains (Admin › Served domains),
              clients, tokens, auth_codes (Mastodon API OAuth),
              oauthClient, oauthAccessToken, oauthRefreshToken,
              oauthConsent (better-auth OAuth provider)
```

Notification rows of the retired `added_to_collection` and `collection_update`
types may remain; every notification read or count in
`lib/database/domains/notification/queries.ts` must exclude
`RETIRED_NOTIFICATION_TYPES`.

## Technology Stack

| Layer                | Technology                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime**          | Node.js 24                                                                                                                            |
| **Framework**        | Next.js 16 (App Router)                                                                                                               |
| **Language**         | TypeScript (strict mode)                                                                                                              |
| **UI Library**       | React 19                                                                                                                              |
| **Styling**          | Tailwind CSS                                                                                                                          |
| **UI Components**    | Radix UI primitives                                                                                                                   |
| **Database**         | Kysely (SQLite / PostgreSQL), Kysely's migrator for migrations                                                                        |
| **Authentication**   | better-auth                                                                                                                           |
| **Logging**          | Pino                                                                                                                                  |
| **Testing**          | Vitest (native ESM)                                                                                                                   |
| **Code Quality**     | Oxlint + Prettier                                                                                                                     |
| **Package Manager**  | Yarn 4 Workspaces (exact version pinned via `packageManager` in `package.json`; optional dependencies modularized under `packages/*`) |
| **Containerization** | Docker (Alpine-based minimal base image; optional workspaces focused via build args)                                                  |
| **Observability**    | OpenTelemetry (optional)                                                                                                              |

---

## Contributor rules

Read the applicable rules below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Server/Client Module Boundary](#agents-server-client-module-boundary)
- [Instance Limits in Client Components](#agents-instance-limits-in-client-components)
- [Date Serialization in Server Components](#agents-date-serialization-in-server-components)
- [Client-Side API Calls](#agents-client-side-api-calls)
- [Client Component Patterns](#client-component-patterns)
- [Outbound Server-Side HTTP Requests](#agents-outbound-server-side-http-requests)
- [Link prefetching in feeds](#agents-link-prefetching-in-feeds)
- [Navigation Customization](#agents-navigation-customization)
- [Page Header & Sub-Navigation](#agents-page-header-sub-navigation)
- [Fitness Overview Calendar](#agents-fitness-overview-calendar)
- [Surfaces (Shared Surface Kit)](#agents-surfaces)
- [Accessibility](#accessibility)
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
- [Runtime vs. build-time configuration](#review-runtime-vs-build-time-configuration)
- [Logging](#review-logging)
- [Post media layout](#review-post-media-layout)
- [Offline-First PWA Launch & Timeline Caching](#agents-offline-first-pwa-launch-timeline-caching)

<a id="agents-server-client-module-boundary"></a>
<a id="review-client-components-data-flow"></a>

### Server/Client Module Boundary

- **Server-only code must never import a runtime value from a `'use client'` module.** Under the App Router such a module resolves to a _client reference_ on the server: components still render, but a plain value read out of it (a constant object, a lookup table) is empty. Types are erased, so `import type` is fine, and `export … from` re-exports are imports too; a Server Component rendering a Client Component is the normal composition pattern — this is specifically about reading values.
- The failure is invisible to the test suite: Vitest has no RSC boundary, so the import returns the real module there and tests pass while production silently gets nothing — a constant read out of a client reference comes back empty, so a validator keyed on it rejects every request with a 400 no test can see.
- `lib/clientModuleBoundary.test.ts` enforces this across `app/api/`, `lib/services/`, `lib/actions/`, `lib/jobs/`, `lib/database/`, and `lib/config/`. When both sides need a constant, put it in a dependency-free module both can import — `lib/services/statuses/pollDurations.ts` and `lib/services/mastodon/constants.ts` are the existing examples — not in the component that happens to render it.
- **Client bundles must not reach server-only packages.** Nothing a `'use client'` module imports (statically or via `import()`; type-only imports, `import` types and `'use server'` files excluded) may be a Node builtin (`crypto`, `fs`, `stream`, `node:*`), the whole `lodash` package (use `lodash/<method>`), or `@/lib/utils/logger` (pino). The walk is transitive through first-party modules only (`@/` and relative imports); npm packages are checked by name and not followed. Next would bundle polyfills or the library into the browser. `lib/clientImportGraph.test.ts` walks the import graph from every client module and fails with the chain; use the pure-JS `getStatusDetailPathSync` / `getHashFromStringSync` in browser-reachable code instead of `getHashFromString`.
- **A lazily loaded client component keeps SSR whenever it can be the primary content of some page; `ssr: false` only for UI that cannot exist before an interaction.** The inline composer and the reaction picker mount only after a click, so they render nothing on the server: the composer is imported from `lazy-inline-status-composer` (a `next/dynamic`, `ssr: false` wrapper that keeps `PostBox` out of anonymous first-load JS), and its chunk is preloaded at idle for a signed-in viewer (`useInlineComposer(canCompose)`, where `canCompose` is a required boolean; feeds pass `Boolean(currentActor) && showActions`, so a feed that renders no action row never downloads it) and never for an anonymous one; the picker chunk is preloaded at idle when a signed-in viewer's reaction button renders, and when its trigger is hovered or focused, or when the compact row's ⋯ menu opens (`preloadReactionPicker`). `FitnessStatusDetail` (status page) and the profile gallery panels (`ActorMediaGallery`, `ProfileGalleryTab`) are a page's primary content, so they stay in the server HTML; each gallery panel is preloaded at idle, and when the profile tab bar is hovered or focused, only if the profile has a panel that shows it (a Media or Gallery tab, or the media-only gallery).
- **Preloaded splits render synchronously (`createPreloadable`).** A `next/dynamic` component is a `React.lazy`, which suspends on the first render of each lazy instance even when its module is already loaded, and React then holds the Suspense reveal for ~300ms after a fallback commits, so preloading with `import()` alone still leaves a ~300ms first open. Each split therefore keeps its module-scope `dynamic(load, {...})` call (Next's compiler needs the inline options object) and passes it with `load` to `createPreloadable` (`lib/components/lazy/createPreloadable.tsx`), which returns `{ Component, preload }`: `Component` renders the dynamic component until `preload()` has resolved, then the loaded component directly. Each mounted instance picks its implementation once (`useState`) and keeps it: a preload resolving while an instance is mounted never swaps it, because that would remount it and drop its state (gallery pagination, an open viewer, a composer draft); only instances that mount afterwards use the preloaded component. `preload()` shares an in-flight or successful load across calls (each reaction button calls it) and retries only after a failure. Start preloads from an event handler or an effect (`runWhenIdle`), never at module top level, so the server render and hydration still use the dynamic (SSR'd) path and cannot mismatch.
- **Every split sits inside a `LazyChunkBoundary`**, so a chunk that fails to download (deploy skew) shows an inline `Alert` ("Couldn't load. Reload the page to try again.") instead of reaching the route error boundary. The boundary catches only chunk-load failures (`ChunkLoadError`, "Failed to load chunk", "Loading chunk", dynamic-import failures) and rethrows every other render error, so real bugs still reach the route error boundary.
- **Browser caching of favicons and app icons:** Browser favicon and PWA icons in `metadata.icons` (like `app/layout.tsx`) and `manifest.ts` must be wrapped with `withVersion` from `@/lib/utils/version`. This ensures browser caches (especially Safari's persistent SQLite icon cache) invalidate across releases.

<a id="agents-instance-limits-in-client-components"></a>

### Instance Limits in Client Components

- **Client authoring UI must size itself to the admin-configured server settings, never to a hardcoded constant.** Read them from `useInstanceLimits()` (`@/lib/components/instance-limits`), which the `(timeline)` layout publishes once from `getResolvedServerSettings()`. Current consumers: the composer's character counter and the inline reply box (`posts.maxCharacters`), the poll editor (`polls.*`), the composer's media picker and the avatar/header picker (`media.maxFileSize`), and the media picker's attachment count — both the composer and the inline reply box — plus the `addAttachment` reducer guard behind it (`posts.maxMediaAttachments`).
- Add a field to `InstanceLimits` and publish it from the layout rather than threading a prop: the composer renders inline under posts across the whole route group, so prop-threading touches ~30 files. Keep the context to values the browser genuinely needs; it is not a mirror of `ResolvedServerSettings`.
- **Do not import `lib/config/serverSettings` into a Client Component** for its value exports — it carries `process.env`-reading closures. Defaults belong in a dependency-free module (see **Server/Client Module Boundary**).
- The context is UX only. Every limit is enforced server-side too (`validateStatusContentLimits` on the status create/edit routes, `exceedsMaxMediaUploadSize` on every upload path); a client that is out of date can only be optimistic, never permissive. `posts.maxMediaAttachments` is the exception: **no** route enforces the resolved value. All three create/edit paths — `POST`/`PUT /api/v1/statuses[/:id]` (the route both the composer and the inline reply box post through) and the deprecated `POST /api/v1/accounts/outbox` — fall back to the fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling instead, answering `422` above it, so on that field a stale or missing provider lets media through up to the ceiling rather than up to the configured number. See **Database-backed server settings** in `docs/environment-variables.md` for the full explanation. When a new surface can author or upload, put it under the provider and read the limit from it.

<a id="agents-date-serialization-in-server-components"></a>

### Date Serialization in Server Components

- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** `Date` objects are not safely serializable across the server/client boundary and can cause hydration mismatches.
- Always pass timestamps as `number` (e.g. `Date.now()`) from Server Components.
- Client Components should accept `currentTime: number` and construct `new Date(currentTime)` internally before use.
- This pattern is already used throughout the codebase (e.g. `HashtagTimeline` accepts `currentTime: number` and forwards the number unchanged to `<Posts>`, which also takes `currentTime: number`; only leaf components construct `Date` objects from it).
- **Client Components that render relative timestamps (or fan out to `Posts`/`Post`) never call `Date.now()` / `new Date()` during render** — they receive and forward `currentTime` from the server to avoid hydration mismatches. A post header shows the compact form from `formatCompactRelativeTime` (`lib/components/posts/compactRelativeTime.ts`: `now`, `35m`, `2h`, `3d`, `2w`, `4mo`, `1y`) — a pure difference, so no time zone or locale can make the server and the browser disagree — while the timestamp button's accessible name keeps the spelled-out `posted 5 minutes ago`. Notifications, sessions, the edit-history panel and quote cards print date-fns' `formatDistance`, and the fitness heatmap chrome prints `formatRelativeTime` (`lib/fitness/relativeTime.ts`).
- **A Client Component that prints a clock time or date in the viewer's own time zone renders a zone-fixed value (UTC) until `useHasHydrated` (`lib/hooks/useHasHydrated.ts`) turns true, then the local one.** The server cannot know the viewer's zone, and `suppressHydrationWarning` only silences the mismatch — React keeps the server's text, so the reader never sees their local time. The fitness activity detail page's `ActivityStartTime` is the reference; its test hydrates server HTML under `withTimeZone`. A formatter that follows the viewer's locale as well (`Intl.DateTimeFormat(undefined, …)`, `toLocaleString(undefined, …)`) pins the locale too until then, because the server's default locale is no more the reader's than its zone is. That pre-hydration value must come from a formatter that is identical in every engine — date-fns `format` on a `UTCDate`, as `useMessageTimeFormat` (`app/(timeline)/messages/useMessageTimeFormat.ts`) does for the direct-message list and bubbles — not from `Intl` with a fixed locale, whose output varies with the engine's ICU (Safari renders `Oct 4 at 3:05 PM` where Node renders `Oct 4, 3:05 PM`) and would mismatch on hydration. Build the reader-locale `Intl.DateTimeFormat` once per component (`useMemo`), not per render. A date that only appears after a client-side fetch (the announcements popover and the admin announcements list) is never in the server HTML, so it needs neither.

<a id="agents-client-side-api-calls"></a>

### Client-Side API Calls

- **Never call `fetch()` directly inside React components.** All API calls from client components must go through `lib/client.ts` (or domain modules in `lib/client/*`).
- Add a named, exported function in the appropriate domain module under `lib/client/<domain>.ts` (e.g. `lib/client/accounts.ts`, `lib/client/statuses.ts`, `lib/client/fitnessFiles.ts`) and re-export it from `lib/client.ts`. The function should encapsulate the `fetch` call, method, headers, body serialization, and return a typed result.
- Import those functions in components: `import { myApiCall } from '@/lib/client'`.
- `lib/client.ts` is an API facade that re-exports functions across all domain modules in `lib/client/`. This keeps domain logic cleanly partitioned while preserving a unified import boundary for components.
- Status creation from the web composer (`PostBox`) and inline reply box (`StatusReplyBox`) goes through `createNote` and `createPoll` in `lib/client/statuses.ts`, which post to `POST /api/v1/statuses` (accepting `fitness_file_id`, `quoted_status_id`, and `quote_approval_policy` alongside standard Mastodon fields) with a UUIDv7 `Idempotency-Key` header minted once per submit attempt series (`generatePublicId()`) and reused across retries of the same draft, adapting the returned `Mastodon.Status` entity into `{ status, attachments }` for `onPostCreated` callbacks. After the server keeps a create (503 or 409, `isPostKeptByServer`) the composer locks the draft (text, content warning, visibility, attachments, poll, fitness file are read-only or disabled) and shows the saved-post message with `DRAFT_LOCKED_NOTICE` in a persistent `role="status"` line, so Post can only retry the same payload under the same key; a success unlocks and resets it. `classifyFailedPost` (`lib/client/http.ts`) decides for both composers: on a locked retry only a 410 (the kept post was deleted) unlocks the draft and drops the key; every other failure (400, 422, any other 4xx, a 5xx or a network error) keeps the lock and key and shows the server's message as its own sentence ("Couldn't send your saved post (<reason>). Press Post to retry or discard the draft.", "…or cancel the reply." in the reply box), and a 401 or 403 shows `SESSION_EXPIRED_NOTICE`, since the route can answer 400 or 422 while the post is still kept and a new key would duplicate it. The way out is explicit: PostBox's lock line has a "Discard draft" button, and the reply box's Cancel does the same while locked and is disabled while a submit is in flight; both clear the composer and the key and leave the kept post's media and fitness file in place. A media batch that settles after a submit began or the draft locked is dropped, and the reply box's attachment tiles are `inert` while locked. A new reply or quote target that arrives while a send is in flight waits until the send settles (the reply and quote previews cannot be closed meanwhile), so the send, its lock and its draft always stay with the target they were written for; a re-target of an idle composer leaves its draft in Drafts under its own target, with its attachments, and unlocks the composer. While the connection is down the composers swap Post for "Save draft" and "Send when online" (`OfflineSubmitButtons`); the second hands the draft to the send queue (see Send queue below), which builds its `Idempotency-Key` and fingerprint with the composer's own code (`submitRequest.ts`), so a retry from either sends the same key. The legacy `POST /api/v1/accounts/outbox` route remains only for backward compatibility.

### Client Component Patterns

- **The edit-history panel** lists prior revisions newest-first and labels each transition to the following version, including text, image or attachment, content-warning, sensitivity and poll-option changes. Its relative time is the transition time. Blank prior text is shown as **No text in this version**; missing or malformed prior text is shown as **Previous text is unavailable**. Incomplete legacy snapshots are called out as unavailable rather than guessed.
- **Timeline grouping and nested status threads.** `TimelineFeed` (`lib/components/posts/timeline-feed.tsx`) renders grouped home timelines, connecting related posts into visual threads and multi-author conversations with accessible badges, compact collapsed middle runs for long chains, and an optional boost carousel (`BoostCarousel`). `StatusThread` (`lib/components/posts/status-thread.tsx`) renders post detail conversation trees, structuring ancestors root-to-parent and nesting descendants by direct reply edges with author-continuation promotion and branch collapse controls. `PostHeader` and `PostBody` are the header and body halves of `Post`, shared with the combined post.
  - **Combined self-replies.** Inside a thread or conversation row, a run of quick self-replies renders as one feed row (`CombinedPostListItem`, `lib/components/posts/combined-post-list-item.tsx`) instead of one row per post. `buildCombinedBlocks` (`combinedThreadModel.ts`, pure) decides the runs from the row's chain-ordered statuses: two or more posts by the same author where each replies to the previous one (or to a reply tucked into the run), the author's next post is at most `COMBINE_MAX_GAP_MS` (10 minutes, inclusive) after the post it replies to (not after a reply that happens to be waiting in between), a tucked-in reply is at most that after the last tucked-in reply still waiting, or after the run's latest post when none is waiting, and all posts share one visibility. Someone else's reply to a run post is tucked into the run as an inset card when the run carries at most two of them, the reply is text only (no media, poll, quote or fitness activity) and the author's next post follows it; otherwise the run splits there, that reply renders as an ordinary post, and it is re-scanned and may start a run of its own. The author may also reply to a tucked-in reply, whether it is still waiting or already part of the run. A long thread (more than three posts) keeps its collapsed first post, expander and last post and combines once expanded; threads of two or three posts and conversations combine straight away. The combined post shows the first post's header with the span "first – last", a thread rail down the avatar column with a dot and a "2 of 4 · 15m" label (a button to that post's detail page, with an edit-history button for an edited part) per later post, and one action bar. Reply acts on the latest post; Boost, Like, Bookmark and React act on the first (`Actions`' `splitTargets`, which changes which post a control reaches, never what a post offers — and each button's accessible name says which: "Reply to the latest post", "Like the first post"). Every later part and every tucked-in reply keeps its own ⋯ menu (the same `PostMenu` a single post has, named "More actions for part 2 of 4" / "More actions for Mira Park's reply"), so quote, copy link, mute, block, report, translate and edit/delete-own work on the post they belong to; a tucked-in reply also has its own Reply and Like. The group ⋯ menu ("More actions for this post group") has a "Post group" heading over "Show as separate posts" and a "First post" heading over the items that act on the first post only. "Show as separate posts" turns the row back to one row per post (run after the menu closes, then focus moves to the row). The choice is kept per page view as every status id of the row, so it survives replies being added, the root post being deleted or an older parent paging in. The status page combines through the same model (next bullet).
  - **Combined self-replies on the post page.** `StatusThread` and the fitness `ActivityReplies` (`app/(timeline)/[actor]/[status]/ActivityReplies.tsx`) feed `buildCombinedBlocks` through `selfThreadModel.ts` (pure): `extractSelfReplyChain` takes the author's direct self-reply chain (the earliest reply continues it), and the model builds the run holding the opened post from the ancestors, the opened post and that chain with the timeline's rules unchanged. Other people's short text-only replies to the chain are added one at a time in the timeline's thread-row order (`sortComponentNodes`: parent before child, oldest first), and each is kept only if `buildCombinedBlocks` still tucks it and every reply kept before it, so the post page tucks what the timeline would and a reply that would split the run is left out instead. A structure pass over every ancestor, whatever its author, runs `buildCombinedBlocks` with `neverTuckIds` (the ancestors and the opened post), so every same-author stretch the timeline would combine comes back in `ancestorRuns` as a run of its own whoever wrote the opened post, a lone post by another author stays a plain row, and nothing on the ancestor path — the opened post included — is ever tucked in as an inset; later runs of the same chain, each started by a gap over `COMBINE_MAX_GAP_MS`, come back as `descendantRuns`. The opened post is always a full row, and when it sits under ancestors it carries `aria-current="location"` with the same tint and orange left edge an opened run part has (a lone post with nothing above it stays unmarked). When the focused block — the opened post itself, or the run holding it — answers a part of an ancestor run, a muted "Replying to <name> · i of n" line above the opened post's header, or above the focused run's first header, links to that part (run part rows and plain ancestor rows carry a `#<status id>` anchor); the target is the reply target of the focused block's first post, so a run answers the part its first part answers. The line drops the "i of n" when `hasMoreAncestors` means the numbering could be wrong, and after "Show as separate posts" splits the run into plain rows (the name alone then links to the part's plain row); it is skipped entirely when neither the part's actor nor its actor id yields a name (`Status.actor` is nullable; the id's handle is the fallback). The plain opened row shows the line only when it replies to that part itself: once "Show as separate posts" splits the opened post's own run, its later parts are plain rows whose reply target can differ from the run's, so they do not inherit the run's line. The model also returns the run, the opened part's index and `repliesOutsideRun`, with a `replyingToByReplyId` entry for a reply to an earlier part of the opened post's own run that cannot tuck in; that reply stays under Replies with a "Replying to i of n" line instead of splitting the run. `SelfThreadRun` (`self-thread-run.tsx`) renders every run: one header with the span, the rail with "i of n" labels, and for each part its own small action row with its own counts (no `splitTargets`, no clamp), `aria-current="location"`, a tint and an orange dot on the opened part, which is scrolled into view. Runs over `LONG_RUN_MAX_PARTS` (6) collapse the middle around the opened part and a separate anchor index (the part the focused block replies to, which draws no tint and carries no `aria-current`), so a long ancestor run never folds the part being answered; part 1's ⋯ menu has "Show as separate posts". Replies to any part of an ancestor run nest under that run (`ancestorIdAliases` in `buildThreadTree`) and keep their "Replying to i of n" label there, and "Replies (N)" and "No replies yet" count only the replies the Replies section lists. Known limit: the server sends only the path from the first post to the opened one, so when the opened reply answers a middle or first part, the author's later parts of that run are not loaded and the run shows only the loaded parts (a reply to part 2 of 3 shows "2 of 2"); loading the author's later parts is a follow-up. On a fitness activity `ActivityReplies` builds the same model with `tuckIntoFirstPart: false` (the activity itself stays unchanged, so other people's replies to it stay under Replies with "Replying to 1 of n"), and the athlete's follow-ups (`parts` from part 2) render as a rail under the action bar and are excluded from the replies count, paging and the Hide/Show toggle.
  - **Reply context.** Reply context follows the displayed original post for boosts, including nested boosts. `getTimelineContext` resolves stored parents through the same readability, block, mute, and content-warning rules as ordinary replies. A readable parent gets an author/snippet preview; when no permitted parent preview is available, the feed shows "In reply to a post" (that fallback alone does not identify whether the parent is missing or restricted). Replying from any feed row or nested thread status targets the selected post's ID, preserving mentions and recipient audience without flattening threads or redirecting replies to the root.
- **Composer toolbar (`PostBox`).** The toolbar is one row that stays on one line from 320 px up with the default character limit (it falls back to wrapping if an admin-raised limit makes the counter too wide), on desktop and phone alike: the media picker ("Add media (n/m)"), the emoji picker ("Add emoji or sticker") and **Post options** on the left (40 px square below `md`, 32 px from `md` up), then the character counter, **Cancel Edit** (when editing; only a 32 px `X` icon below `md`, still named "Cancel Edit" with a matching `title`) and **Post**/**Update** on the right. Everything else lives in the **Post options** menu (`post-options-menu.tsx`, `DropdownMenu`, aligned to the start), in this order: **Fitness file** (new posts only, so not when replying or editing), **Poll**, a separator, **Visibility**, **Content warning** and **Preview**.
  - **Visibility** is a submenu holding the visibility and "Who can quote" choices, shared with `VisibilitySelector` through `VisibilityMenuOptions`; its row shows the current value, followed by the quote policy's own icon (Followers or No one, with "Followers can quote" / "No one can quote" as screen-reader text) when the quote policy is restricted. Below `md` the submenu is pulled back over the menu (one `SUBMENU_WIDTH` constant drives its width and offset) because two menus do not fit side by side; it scrolls when the viewport is short.
  - **Poll**, **Content warning** and **Preview** are all `menuitemcheckbox` rows with `aria-checked`. Poll shows a check and closes the menu; it is disabled while quoting, and its explanation is the row's accessible description (its name stays "Poll"). Content warning and Preview show a purely visual switch (never a nested `role="switch"`) and keep the menu open (`onSelect` calls `preventDefault`).
  - The Post options button takes the `bg-primary/10 text-primary` tint while a poll, content warning or preview is on.
  - The fitness picker's hidden `<input type="file">` is `FitnessFileInput`, kept mounted next to the toolbar and opened through its imperative `open()` handle by the menu item, so the menu closing does not unmount it. Menu rows, including the submenu's quote-policy rows, are at least 40 px tall below `md`.
  - The reply composer (`StatusReplyBox`) is a separate, compact component and keeps its own buttons.
- **Composer vertical sizing & auto-growth.** Both the main composer (`PostBox`, used standalone on timelines and for quotes/edits) and the reply composer (`StatusReplyBox`, used for inline replies and fitness activity comments) automatically grow vertically with typing, wrapped lines, newlines, and pasted text while preserving caret positioning, focus, and existing controls:
  - Sizing classes on the message textareas: `field-sizing-content min-h-[72px]` (or `min-h-[60px]` for replies) `max-h-[min(320px,40dvh)] overflow-y-auto`.
  - Browsers supporting CSS `field-sizing: content` (Chrome 123+) size the textareas natively without JavaScript intervention.
  - For browsers lacking native `field-sizing: content` support (such as Safari and Firefox), the shared `useAutoResizeTextarea` hook (`@/lib/hooks/useAutoResizeTextarea`) provides a measured-height fallback that updates `element.style.height` based on `scrollHeight` on mount, input, value changes, and container width changes, while preserving `scrollTop` so internal scrolling does not jump. It adds the element's own border (`offsetHeight - clientHeight`, 0 for the borderless composers) to the measured `scrollHeight`, because a `border-box` textarea's `height` includes its border and `scrollHeight` does not: a bordered box fitted without it is 2px short and scrolls its last line away. The share dialog's read-only snippet box on the heatmap page (`HeatmapShareEmbed`) is the bordered caller; it uses this hook with the shared `Textarea`'s own `field-sizing-content` rather than a hook of its own.
  - Height is capped at `min(320px, 40dvh)`. On extremely short viewports, CSS `min-height` takes precedence over `max-height`. Textareas scroll internally after reaching the cap and shrink smoothly back to the minimum height when text is deleted or draft-reset clears the content.
- **Validate any user-controlled URL before using it as an `href`**: parse with `new URL()` and allow only the `http:` or `https:` protocols — not a `startsWith` or regex check — so a `javascript:` (or other) scheme can't become a DOM-XSS sink (see `lib/utils/fitness.ts`).
- **React state updater functions stay pure** — no side effects, and don't fire another variable's state update from inside an updater. Do the separate `setState` calls in the event handler instead, so Strict Mode's double-invoke can't misfire them.
- **Optimistic UI (e.g. optimistic delete with rollback on failure) disables the create/edit actions while the operation is in flight**, so a rollback can't discard items added in the meantime.
- **Don't wrap a callback in `useCallback` when its dependencies change on every render.** The compiler memoizes most components, but not per `.map` iteration, so list rows still need `memo` to skip re-rendering with the list. Post list rows (`PostListItem`, shared by `Posts` and `TimelineFeed`) are `memo` because the React Compiler does not memoize per loop iteration: without it, opening the inline composer re-renders every row. Pass a row plain values, its own slice of shared state (`activeComposer` is null for every other row) and stable callbacks (`useCallback` in the page, above any early return), and build per-row closures inside the row.
- **The React Compiler is on** (`reactCompiler: true` in `next.config.ts`, `babel-plugin-react-compiler` pinned in `package.json`) for client components only; server components are not compiled. New components and hooks need no manual `useMemo`/`useCallback`/`memo` for performance; leave the existing ones in place. It compiles in `infer` mode and skips a function where it detects a Rules-of-React violation (a ref read or written during render, mutating props, a `react-hooks` lint suppression) and any function containing `try/finally` (so `MainPageTimeline` and `post-box` stay uncompiled). It cannot see globals (`window.*`, `navigator.*`), module-level mutable state, mutable objects read during render, calls with no reactive arguments (`Date.now()`, `new Date()`, `localStorage.getItem()`), or `useMemo`/`useCallback` deps the body never reads. Those are compiled with changed behavior (computed once, not invalidated), so read such values through state, `useSyncExternalStore` or an effect. Unit tests run without the compiler, but a client component should still be rendered as an element (`<Component />`), not called as a function, because a compiled one needs a renderer.
- **Post list rows carry the `feed-row` class**, which `app/globals.css` gives `content-visibility: auto` (with `contain-intrinsic-block-size: auto 380px`, the content box of a not-yet-rendered row, about 405px with padding and divider) so long timelines skip layout and paint of off-screen rows. The containment applies to on-screen rows too: the row becomes a stacking context and the containing block of absolute and fixed descendants, and it clips like `overflow: clip` to its rounded padding box. An overlay rendered inside a row (a panel, error bubble, picker or composer that is not portaled) MUST either be portaled (Radix dropdowns, tooltips, popovers and dialogs, the reaction picker, the media modal) or carry the `data-row-overlay` attribute on an element that exists only while it is open (a bare attribute, never `={bool}`: React renders `data-row-overlay="false"`, which still matches). Passing a `container` inside a row to `ui/popover.tsx` defeats its portal. `.feed-row:has([data-row-overlay])` turns containment off. The rules sit in an `@supports` block whose condition is `@supports selector(:has(a)) and (overflow-anchor: auto)`, so browsers without `:has()` or scroll anchoring (older Chrome, Safari) never contain a row. `app/globals.css` is guarded by `test/feed-row-css.test.ts`, and `test/feed-row-overlays.test.ts` scans the post components for unmarked overlays: any `fixed` tag (including responsive variants), or an `absolute` tag with a `top-full`/`bottom-full`/`left-full`/`right-full` offset, unless it is marked or inside `createPortal`, and any valued `data-row-overlay=`. It is a lint, not an audit: arbitrary offsets, `-translate-y-full`, margin- or numeric-offset placement (`absolute mt-2`, `absolute -top-10`) and classes built outside the tag are not seen.

<a id="agents-outbound-server-side-http-requests"></a>

### Outbound Server-Side HTTP Requests

- **Server-side outbound JSON and text HTTP requests MUST go through `safeRemoteFetch` (`@/lib/utils/safeRemoteFetch`).** Binary downloads use the guarded helper below.
- Never call raw `fetch()` directly in server-side services or utilities.
- `safeRemoteFetch` is backed by `got` and applies standard SSRF protection (requiring HTTPS, blocking private IP ranges such as loopback and RFC 1918 subnets), streaming response-size limits, timeout bounds, DNS pinning, and redirect handling.
- A fetch whose response is trusted because of the host it came from — an ActivityPub object fetched to authenticate it (`getNote`, the forwarded-Delete confirmation, a `QuoteAuthorization` stamp) — passes `allowCrossHostRedirects: false`, so an open redirect on that host cannot hand the answer to another one. See [A Fetched Document's Own `id` Is Not Evidence](mastodon-api-compatibility.md#agents-a-fetched-document-s-own-id-is-not-evidence). Remote servers running in `AUTHORIZED_FETCH` / secure mode also reject unsigned ActivityPub GETs, so server-to-server fetches that resolve remote actors or statuses (`getActorPerson`, `getActorPosts`, `getNote`, search, remote statuses, profiles, status detail, Move target verification) sign the request with the headless instance actor from `getFederationSigningActor`, never the viewing user's actor (its key may not be publicly resolvable on a multi-domain setup), and degrade to an unsigned request when that signer cannot be resolved. Only outbound delivery POSTs sign as the user.
- Binary FIT and image downloads use `safeImageFetch` with `readResponseArrayBufferWithLimit` because the text response of `safeRemoteFetch` would corrupt those bytes. The binary helper checks each redirect and destination address; callers apply an overall timeout and byte cap and do not forward provider bearer tokens to file hosts.
- Web Push delivery (`web-push`) is the one outbound POST to a URL a client chose. The subscribe routes refuse any endpoint `isAllowedPushEndpoint` rejects (`lib/services/notifications/pushEndpoint.ts`: HTTPS, no credentials, no local names, public addresses only), delivery skips a stored endpoint `isDeliverablePushEndpoint` rejects and connects through `pushDeliveryAgent`, whose lookup refuses a restricted address at connect time (so a rebound record is caught), with a per-request timeout. `createPushSubscription` keeps at most `MAX_PUSH_SUBSCRIPTIONS_PER_ACTOR` per actor (oldest dropped), which bounds the per-notification fan-out.
- External cloud integrations (e.g. translation providers like DeepL, OpenAI, or Gemini, and alt-text vision generation) must target public HTTPS endpoints. Internal or self-hosted HTTP services running on private IP addresses are not supported.
- **Profile link verification fetches the page a profile link points at** (any public HTTPS site the owner typed, or a remote actor's server sent) through `safeRemoteFetch` in `lib/services/profile-links/verifyProfileLink.ts`, from `VerifyProfileLinksJob`: 5 s connect + 5 s read per hop (about 30 s for a link with two redirects), a 1 MiB body that fails instead of truncating, HTML only, two redirects. See [Actor Profile & Deletion Federation](#agents-actor-profile-deletion-federation).
- **Gallery lookups call two public services, both through `safeRemoteFetch` with `allowCrossHostRedirects: false`, in `lib/services/gallery/lookups/`.** `gbif.ts` talks to the GBIF API (`ACTIVITIES_GALLERY_GBIF_ENDPOINT`; taxon match, taxon, IUCN category and species search) and `nominatim.ts` to Nominatim (`ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT`; reverse geocoding). Both go through `lookupGet`, which sends `User-Agent: activities.next/<version> (+https://<host>)` (Nominatim's usage policy requires one) and `Accept-Language`, applies a 5 s total / 2 s connect timeout and a body cap, and never forwards the vision API key. A self-hosted endpoint must resolve to a public address, because `safeRemoteFetch` refuses private ones.
  - **Only the snapped cell centre leaves for geocoding.** `reverseGeocode` receives the 0.05 degree grid centre (about 5 km, the same grid as the public `area` precision), never the stored point, for every GPS upload, including photos whose precision is `hidden`, so the media details dialog can prefill the place name. The subject lookup sends the subject's name or scientific name to GBIF and nothing about the photo.
  - **Limits are per process.** Each provider has a minimum-interval and concurrency limiter (Nominatim: one request at a time, at least 1100 ms apart; GBIF: four at a time) and a circuit breaker: after a timeout, a 5xx or a 429 the provider is "down" for its `Retry-After` or five minutes and calls fail fast as `failed`, so an air-gapped server adds at most one 2 s connect timeout per provider per five minutes to an upload. With several instances behind one queue the cache below is the protection that is actually shared; a busy instance should run its own Nominatim.
  - **Answers are cached in `gallery_lookup_cache`**, keyed by `kind` and a normalised key (`gbif-match`, `gbif-taxon`, `gbif-search`, `geocode`), with `ok`, `miss` and `error` outcomes on separate TTLs (misses and errors are cached too, so a typo or an outage is not retried on every upload; a local `circuit-open` or `rate-limited` failure is not) and single-flight, so a burst of uploads in one cell makes one request. A GBIF or `geocode` key for an endpoint other than that provider's default carries a short tag of that endpoint, so fixing a wrong endpoint (or leaving a regional self-hosted Nominatim) never serves what the other one said. A `gbif-match` row stores which kind of answer GBIF gave (a confident match, `NONE`, a name placed in a species or genus, or one placed higher), never a bare miss, and a `gbif-search` row stores whether every result was readable, whether GBIF said it was the last page (`endOfRecords`), and which results name the query exactly across all their vernacular names (the row keeps only 20 names per result, for display); both keys carry a version tag (`m2|`, `s3|`), so the older rows, whose misses did not tell those answers apart or whose exact hits came from the cut-down name list, are never read. A cached row in a shape the client does not know is a `parse` failure. The owner's Retry (and `backfillGalleryLookups.ts`, which runs every lookup as a retry) asks again past a remembered error and past a remembered unknown `species/{key}`, but never past a remembered `geocode` miss: a place `no-match` is final (the endpoint tag keeps one endpoint's misses from answering for another), so the backfill asks Nominatim once per no-match cell, not once per photo. The table is not linked to an actor, but a `geocode` key is a 5 km cell, so it is a coarse trace of where the instance's photos were taken; `backfillGalleryLookups.ts --prune-cache` deletes expired rows.
  - **Admins can switch each service off** under Admin → Network (`network.speciesLookups`, `network.placeLookups`, both default on, in the server-settings registry like `network.linkPreviews`). Jobs and routes re-check the switch at run time, so turning it off stops queued work.

#### Inbound request bodies on unauthenticated routes

- **An unauthenticated route (public webhook, client registration, anything that parses before the auth check) must not call `req.json()` / `req.text()` / `req.formData()` directly** — each buffers the whole body first. Read it through `@/lib/utils/boundedRequestBody` (`readRequestTextWithLimit`, `readRequestBodyWithLimit`, cap `SMALL_REQUEST_BODY_MAX_BYTES` = 64 KiB) or pass `{ maxBytes }` to `getRequestBody`. The cap is checked against a declared `content-length` before reading and again on the stream (the header can be absent or false), and an over-cap body answers 413 (`isRequestBodyTooLargeError`). Do not clone the request to peek at its body with these helpers: they `await` the stream's cancellation, and cancelling one `tee()` branch never settles until the other is read, so on a clone the over-cap read hangs instead of answering 413. The one deliberate exception is `ActivityPubVerifyGuard`'s `readBoundedBody`, which reads a clone (the handler still needs the original body) and stops at the cap WITHOUT awaiting `reader.cancel()` — stopping the reads is what bounds the work there.
- A body-parsing `addAttributes` callback on `traceApiRoute` runs **before** the handler and so before an auth guard; set span attributes inside the guarded handler (`trace.getActiveSpan()`) instead.
- Next's `proxy.ts` body clone (default 10 MB) is a backstop, not a limit to rely on.

<a id="agents-link-prefetching-in-feeds"></a>

### Link prefetching in feeds

- **A `<Link>` rendered once per row of a feed or list MUST pass `prefetch={false}`.** Next's App Router `<Link>` defaults to prefetching every link that enters the viewport, and this app's feeds are infinite-scroll, so a repeated link is not one request — it is one request per row, fired continuously as the user scrolls. `Posts` renders two author links per post (the avatar and the display name), so scrolling the home timeline issues a stream of `GET /@user@domain?_rsc=…` prefetches.
- The cost is not just a page render. Every one of those targets is a fully dynamic route — `/@user@domain` runs a session lookup plus six actor queries — and for a remote actor this instance has not persisted yet, `getProfileData` additionally performs a **WebFinger lookup and a signed actor fetch against the remote server**. Viewport prefetching therefore turns idle scrolling into outbound federation traffic aimed at other people's instances.
- There is no global switch: Next 16's `prefetch` prop (`boolean | 'auto' | null`) is per-`Link` and has no `next.config.ts` counterpart, so the opt-out is written at each call site. `prefetch={false}` disables prefetching on **both** viewport entry and hover — accept the hover loss. Without a prefetch the router has nothing to show until the server answers, so a profile click leaves the old page frozen for the whole round trip; `PendingProfileNavigationProvider` (`app/(timeline)/PendingProfileNavigation.tsx`, mounted by the `(timeline)` layout) covers that gap: it watches same-tab clicks on links to `/@user@domain` and paints the `[actor]` route's own `ProfileLoading` skeleton over the content column (`PendingProfileOverlay`, in the signed-in `<main>` and in `PublicShell`) until the pathname changes, when the route's `loading.tsx` takes over. It is an overlay, not a swap, so the page underneath keeps the height and scroll position the browser records for Back. New profile links get this for free; do not re-enable prefetching on them to make profiles feel instant.
- Current opt-outs: the shared post author links (`lib/components/posts/actor.tsx`), the booster link on the boosted-by line (`BoostStatus` in `lib/components/posts/post.tsx`), quote card links (`QuoteCard` in `lib/components/posts/quote-card.tsx`), notification rows (`NotificationItem`, `StatusNotification`, `ActivityImportNotification`), follower/following rows (`FollowList`), search account and hashtag rows, the likes list and chips (`StatusLikes`), and trending hashtag rows. Regression-tested in `lib/components/posts/actor.test.tsx`, `lib/components/posts/boost-status.test.tsx`, and `lib/components/posts/quote-card.test.tsx`, which mock `next/link` because the real one does not reflect `prefetch` into the DOM.
- Navigation **chrome** keeps prefetching and should: the sidebar, mobile navigation drawer, section sub-nav, pagination, and one-off page links render a bounded handful of links, so prefetch is a straight latency win there. The rule is about links whose count scales with the number of rows on screen. **The one exception inside chrome** is the user profile link: both as a main nav item (`item.id === 'profile'` in `lib/components/layout/sidebar.tsx`) and in the account menu (`ActorSwitcher` in the sidebar bottom row, the tablet rail, and the mobile drawer): unlike other registry nav items, Profile's href is the viewer's own per-user `/@user@domain` (`profileUrl`) — the same fully-dynamic `[actor]` route the post-author links above opt out of (a per-user session lookup plus six actor queries on every render) — so it carries `prefetch={false}` while other registry items and the overflow (More) menu links around it keep default prefetching. Regression-tested in `lib/components/actor-switcher/ActorSwitcher.test.tsx`, which mocks `next/link` the same way. The same holds for a `BackLink` whose target is a profile — the signed-in followers/following Back and the post page's direct-entry Back — which pass `prefetch={false}`.

<a id="agents-navigation-customization"></a>

### Navigation Customization

- **The nav item registry is the single source of truth, and adding an item is two lines.** Its id goes in `NAV_ITEM_IDS` (`lib/services/navigation/navPreferences.ts`) and its presentation — icon, label, `shortLabel`, `blurb` — goes in `NAV_ITEM_DEFINITIONS` (`lib/components/layout/nav-items.ts`). Every surface derives from those: the full sidebar, the collapsed rail, the mobile navigation drawer and its More group, and the Settings → Sidebar manager (`/settings/sidebar`). Never hardcode a nav list in a component.
- **`lib/services/navigation/navPreferences.ts` must stay dependency-free** — no React, no lucide, no env. Both sides import it: the `'use client'` surfaces render from it, and `app/api/v1/accounts/navigation-preferences/route.ts` validates writes against it. It owns which ids are pinned (`LOCKED_NAV_IDS`), which belong to an optional instance feature (`NAV_FEATURE_BY_ID`), and the order/split/move algebra. See **Server/Client Module Boundary**.
- **Main navigation items and default order:** `NAV_ITEM_IDS` in `lib/services/navigation/navPreferences.ts`, ending `… notifications`, `admin`, `profile`, `settings`. There is no `account` ("Account & security") item in the main navigation; `profile` ("Profile", `UserRound` icon) takes the slot before `settings`. Profile's href resolves to the current actor's profile page (`profileUrl`, like `fitnessUrl` and `galleryUrl`), active only when viewing your own profile pages.
- **Pinned items (`LOCKED_NAV_IDS`):** `timeline`, `search`, `lists`, `notifications`, and `settings` can be reordered, but never hidden: they are either the core reading surfaces or the only way back to settings. `profile` is NOT locked (hideable under More); `settings` stays locked.
- **Legacy alias for stored orders:** Saved preferences with the legacy `account` id map `account` to `profile` in the same position (`normalizedOrder` and `sanitizeNavOrder`, which also preserves the offline bootstrap copy). Any stored hidden `account` entry is dropped/ignored (`legacyAccount: 'drop'`) so that a stored hidden `account` cannot unexpectedly hide `profile`.
- **Every nav surface reads `useNavPreferences()`; none of them keeps its own copy.** `NavPreferencesProvider` is rendered once by the `(timeline)` layout, seeded from `getActorSettings`, and wraps the nav chrome **and** `{children}` — the settings manager edits the very sidebar rendered beside it on wide viewports, and a soft navigation never re-runs the layout to re-seed two separate stores.
- **`profile` and `gallery` are registry items with dynamic URLs.** `app/(timeline)/layout.tsx` sets `galleryUrl` when the actor has an account and passes it down like `fitnessUrl`; `Sidebar` derives `profileUrl` (`/@username@domain`) from the current actor itself (the mobile drawer renders `Sidebar`, so it gets it too), and `app/(timeline)/settings/sidebar/page.tsx` builds the same URL for `NavigationSettings`. `BuildNavItemsParams` and `availableNavIds` take both, and Profile is unavailable without a `profileUrl`. The Gallery pages are owner-only; the public surface is the profile Gallery tab.
- **Settings → Sidebar (`/settings/sidebar`)** manages the list, showing Profile (hideable) and no Account & security row, accompanied by an explanatory note: "Account & security and Sign out are in the account menu at the bottom of the sidebar."
- **Account menu (`ActorSwitcher`):** The whole account row at the bottom of the sidebar is the dropdown menu trigger, for both single-profile and multi-profile accounts. The menu provides:
  1. Header: non-interactive user identity label (avatar, display name, handle).
  2. View profile (`profileHref`, `prefetch={false}`) and Edit profile (`/settings/profile`, `prefetch={false}`).
  3. When 2+ profiles exist: a "Switch profile" list with pending-deletion notices and cancellation, plus a checkmark on the active profile.
  4. "Add another profile" (opens `AddActorDialog`).
  5. "Account & security" (`/account`, `prefetch={false}`) — reachable only from this menu and the Settings index footer card.
  6. "Sign out" (opens `SignOutDialog`).
     On the tablet icon rail (`variant="rail"`), the avatar button acts as the trigger and opens the menu as a flyout to the right (`side="right"`). In the mobile phone drawer (`drawer={true}`), the account row opens the menu upward with 44px minimum height touch targets under coarse pointers (`pointer-coarse:min-h-[44px]`). Account & security is reachable only from this menu and the Settings index footer card.
- **Saves carry the whole preference, not a delta**, so concurrent edits resolve to last-write-wins; the store keeps one request in flight with a single trailing save, and a drag persists once on drop rather than once per row it crosses. Dedupe is keyed on the **payload** (what goes over the wire), not on what the navigation looks like: Reset deliberately stores empty lists — that is what keeps the account following the shipped navigation as it changes — and keying on the visible state would make Reset a no-op whenever the visible order already matched the defaults.
- **Two reorder semantics, and the difference is deliberate.** The sidebar's `⋯` menu swaps with the nearest _visible_ neighbour (`moveNavItem`), because hidden items are not on screen there to move past. The settings manager lists hidden rows inline, so all three of its reorder paths — dragging a row, the grip's arrow keys, and the per-row Move up/down buttons — splice within the displayed list (`moveNavItemTo`). The keyboard and the buttons share `moveRow`, which is also what reports the move (and the ends of the list) to a screen reader; a drag calls `moveTo` per row crossed and `commit` on drop, because it is the pointer that reports it. Whatever a surface offers via drag it must also offer via the keyboard, and the buttons are what make it work on a touch device, where a pointer that cannot hover cannot drag and there is no keyboard either.
- **A hidden item is tucked away, never taken away**: it stays reachable under More on every surface, `LOCKED_NAV_IDS` can never be hidden (the server strips them from `navHidden` as well, so a hand-edited preference cannot strand someone), and an item that is unavailable — admin for a non-admin, or a feature the instance turned off — keeps its slot in the stored order so re-enabling restores the account's layout.
- **Instance feature switches (`features.*` server settings) only remove items from navigation.** A served domain can additionally turn a feature off for its own visitors (`domains.disabledFeatures`, effective switch = server switch AND NOT disabled on the visited domain), with the same nav-only effect. They do not gate routes, APIs, or the composer: an existing link keeps working. If that ever changes, it is a separate, deliberate decision — do not add a `notFound()` guard as a side effect of a nav change.

<a id="agents-page-header-sub-navigation"></a>
<a id="review-page-chrome-layout-accessibility"></a>

### Page Header & Sub-Navigation

The **design system is the source of truth** for page chrome. There is one
section-navigation pattern: the shared section dropdown. There is no second one to pick.

- Use `PageHeader` from `@/lib/components/page-header` for every page title in the `(timeline)` route group. From `md` (768px) up it renders the sticky, full-width chrome (translucent background + backdrop blur + bottom border) and centers the title above the content column. Below `md`, under a mobile navigation provider, it renders the mobile compact bar instead and its own box becomes plain content (see **Mobile chrome** below). Pages always call `<PageHeader title="…" description="…" actions={…} />`; they don't need to know which sub-nav pattern (if any) wraps them. Five optional props exist for the mobile split:
  - `back={{ href, accessibleName, label?, prefetch? }}` — a parent-route Back. Never put a back arrow inside `title`: below `md` it is a row at the top of the content reading "Back" (or "Back to profile" — pass `...profileBack(name)` from `lib/components/navigation-history/backDestination.ts` when it returns to a profile), from `md` up it is the same icon beside the title (rendered by `BackLink`, outside the `h1`). `accessibleName` names the destination ("Back to lists") — see **Mobile chrome**.
  - `compactTitle` — a short section title for the mobile bar when the content keeps a more specific heading (the list timeline's bar says "Lists" over the list's name). Without it the bar's title is the page's `h1` below `md` and the box's `h1` is `max-md:hidden`, so exactly one `h1` is displayed at any width.
  - `flushOnMobile` — below `md` the content directly below meets the header's bottom edge instead of the parent's `space-y-*` rhythm: signed in, the compact bar's hairline when the box has nothing to show there (the bar keeps `mb-0`), else the box; logged out, the sticky box (`max-md:mb-0`). For a full-bleed surface that must not show a band above it (the home timeline's composer, see **Home timeline boundaries** below). The geometry lives in `PageHeader`; callers never pull themselves up with a negative margin.
  - `actionsInMobileBar` — signed in, below `md` `actions` render at the end of the compact bar instead of in the content row, whose copy is `max-md:hidden` (the home timeline's Refresh, which sits beside the title as it did before the redesign). Every other page keeps its actions in the content, where they scroll away; do not opt a page in without a design decision.
  - `mobileBarActions` — signed in, below `md` controls passed here sit at the end of the mobile compact bar while `actions` stays in the content row (for example, Notifications puts `PageRefreshButton` in the compact bar and keeps `MarkAllReadButton` in the content row). In section mode (`PageHeaderSectionProvider`) or without the signed-in mobile navigation, `mobileBarActions` renders alongside `actions` at the trailing end of the header actions row.
  - None of the five props splits into a mobile bar in section mode (under `PageHeaderSectionProvider`): the section layout owns the bar, so a section detail page renders its own `BackLink` above its section-mode heading (the admin account, report and hashtag pages).
- **Unified desktop content width.** Every top-level page in the `(timeline)` group shares **one** content width on desktop so the column stays aligned as you switch tabs. The `(timeline)` layout wrapper centers content at `max-w-content` (a single `--container-content: 940px` token defined in `app/globals.css`'s `@theme`), and `PageHeader` centers its title row at the same `max-w-content`. There is **no** per-page width tier: do **not** reintroduce the two-tier `max-w-2xl` (timeline) / `max-w-4xl` (sections) split, a `contentWidth` prop on `PageHeader`, or the `data-layout-width="wide"` opt-in CSS rule. Every section (Settings, Account & security, Admin, Fitness, Gallery, Messages) inherits `max-w-content`; none sets its own width except the one approved Gallery exception: `app/(timeline)/gallery/layout.tsx` renders `data-gallery-wide` on every `/gallery` route except `/gallery/privacy`, and `app/globals.css` widens the column to **1120px** on those routes by overriding `--container-content` in a `html:has([data-gallery-wide])` rule (the token itself lives in a non-inline `@theme { --container-content }` block so the `max-w-content` utility emits `var(--container-content)` and follows the override). No other section may opt in. The `--container-section` / `max-w-section` / `data-section-layout` widening for a navigation rail must not come back.
- **Page skeleton alignment (`loading.tsx`).** Route loading skeletons for logged-in pages in `(timeline)` must align with the rendered page so that transition causes no visual jumping of either the header or the content box below it:
  - **Reuse `PageHeader` directly on top-level timeline pages.** Never hand-roll a sticky header div or breakout style. Rendering `<PageHeader>` from `@/lib/components/page-header` ensures sticky breakout styling, padding (`px-4 py-4`), bottom border, and total header height (79px from `md` up, also for a header with actions and no description: the title row then takes a `md:min-h-[46px]` floor, the 28px title plus the 2px and 16px description it would have had, as on the home timeline's Refresh; a title-only header keeps its own height; below `md` the 56px compact bar plus the content row) match the loaded page pixel-for-pixel.
  - **Mirror font and action metrics.** Pass `title={<span className="skeleton block h-7 w-… rounded-md" />}` to match `h1 text-xl` (28px line height = `h-7`), `description={<span className="skeleton block h-4 w-… rounded" />}` to match `mt-0.5 text-xs text-muted-foreground` (16px line height = `h-4`), and action button skeletons in `actions={…}` (e.g. `size-9` for standard icon buttons, `h-8 w-18` for small buttons). `PageHeader` centers actions vertically via `.shrink-0.self-center`; hand-rolled headers default to top-aligned (`items-start`), which makes action buttons jump down 7px when the page hydrates.
  - **Prevent layout shift below the header.** Layouts apply vertical spacing between the sticky header and page content (`space-y-6` on timeline/favorites, `gap-5 md:gap-6` on messages). Any discrepancy in header height (such as 75px vs 79px) causes the entire content box below the header to jump vertically when data loads.
  - **Home timeline new posts.** The floating pill under the header (`app/(timeline)/NewPostsPill.tsx`) counts the posts the 15-second poll found (not loaded yet) plus the posts already loaded above the reader ("N new posts"): the timeline reopens at the saved reading spot under a fresher first page, and a refresh while scrolled down merges newer posts in above (clamping the preserved reading anchor's `offsetTop` to `VIEW_TOP_EDGE = 80` when new posts are prepended so they always sit above the sticky header edge rather than in the composer gap). Those are tracked by id outside React state (`createUnseenAboveStore`) and recounted on scroll against the feed rows' `data-row-status-ids` (every status a row shows, so a thread or conversation row counts all its posts; a row counts as seen once any part of it is on screen), so the count goes down as the reader scrolls up through them without re-rendering the feed. When the reader is scrolled down (or restored to a mid-feed anchor) with zero unseen posts above, the pill shows "Back to top" (with a spinning refresh icon while a background refresh is in flight). Tapping the pill jumps to the newest post (refreshing first when polled posts are not loaded) and clears any saved scroll anchor. While the pill shows, the phone's bottom "Scroll to top" hides. Tapping the "Timeline" title scrolls back to the top and immediately clears the saved scroll anchor, while tapping the nav item of the page already open (sidebar, rail, drawer; a page with a query string still resets) scrolls back to the top (where reaching the top zone clears the saved scroll anchor), as a Mastodon column header does.
  - **Home timeline boundaries.** On `(home)` below `md` (768px), the sticky compact bar (menu button, "Timeline", and Refresh at its end via `actionsInMobileBar`) carries the whole header — the page has no description, so the header's content box is empty and hidden there — and `PageHeader`'s `flushOnMobile` prop lets the composer meet the bar's hairline with no white band (announcements never add to the header or the content flow: they are a megaphone icon button beside Refresh, shown whenever at least one active announcement exists, read or unread, and absent when there are none or the load failed; while anything is unread it carries a small `primary` dot at its top-right corner and is named "Announcements, N new", and the dot clears live as items are marked read). The composer meets the feed through one full-viewport-width, 1px `border`-token divider. Keep the outer timeline stack's spacing for the feed-to-pagination boundary, and mirror the same geometry in `(home)/loading.tsx` so loading, empty, refresh, and populated states do not jump. At `md` and above, keep the separate flat composer and feed frames (`POST_LIST_FRAME_CLASS`: `rounded-lg border`, no shadow) with their 24px gaps in the centered `max-w-content` column. Do not wrap the header in a narrower containing block or change the shared `MOBILE_FEED_SURFACE_CLASS`; this is home-boundary spacing only.
  - **Mobile timeline pagination spacing (`LoadMoreButton`) and Scroll to top button (`ScrollToTopButton`).** On the mobile home timeline below `md`, pagination renders as a visual overlay pill centered over the lower area of the final rendered timeline card (`presentation="overlay"`), removing the large blank pagination band beneath the feed. The `IntersectionObserver` target is separated into a compact, non-zero-sized sentinel (`h-px`) in normal document flow at the feed end, avoiding large wrapper spacing while keeping auto-pagination and post actions fully interactive. For other timeline and list pages, `LoadMoreButton` retains standard in-flow pagination with container safe-area spacing (`max-md:pt-6 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]` and `py-4` on desktop). In parallel, `ScrollToTopButton` uses fixed positioning with `bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]` to preserve safe-area clearance above the home indicator while maintaining approximately 12–16 CSS pixels of visible clearance above Safari's collapsed bottom address bar without floating excessively high over post content. Additionally, `PageHeader` supports an optional overlay slot (`bottomSlot`) positioned below its sticky container at `top: 100%` plus ~8 CSS pixels clearance (with `pointer-events-none` container) for sticky controls such as the new-post count pill without causing layout shift in the feed below. Below `md` the slot hangs under the sticky mobile compact bar instead (the desktop overlay is `max-md:hidden`), so the pill stays reachable while the feed scrolls. The slot holds the new-posts pill, so anything in it must be `pointer-events-auto` itself. Both copies of the slot (and of `actions` with `actionsInMobileBar`, which the desktop box and the mobile bar both render) are mounted at every width with CSS hiding one, so stateful content owns its state once in the page (`useAnnouncements` in `MainPageTimeline`) and the copies are presentational. The announcements panel is a popover (`role="region"`, `shadow-lg`) under the header, closed by its trigger, an outside press, focus moving to a control outside it, or Escape (handled on the document while focus is inside it or on the body); Escape and the trigger return focus to the trigger via a focus request in `useAnnouncements`, and an Escape with focus on the body closes it without being cancelled. It never opens by itself: it opens only from the header icon (which also toggles it closed), and its state is never stored.
  - **Mirror panel item layout in content skeletons.** Skeletons should match the vertical rhythm of the real components: e.g. in direct messages, mirror the 3-line conversation card (title, preview, timestamp) without combining `divide-y` on containers with per-item `border-b` (which creates double borders), and use `size-9` for `Button size="icon"` and `h-9` for default buttons.
  - **Page inventory & skeleton rules across routes:**
    - **Top-level standalone timeline routes (MUST use sticky `PageHeader` in skeleton):**
      - `(home)` (`app/(timeline)/(home)/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7` and action `size-9`, and no description (the home header has none; see **Home timeline boundaries**).
      - `favorites` (`app/(timeline)/favorites/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `messages` (`app/(timeline)/messages/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`, and action `h-8 w-18`.
      - `search` (`app/(timeline)/search/loading.tsx`): Reference implementation. Uses `PageHeader` with title `h-7`, description `h-4`.
      - `[actor]/followers` & `[actor]/following` (`app/(timeline)/[actor]/FollowListLoadingSkeleton.tsx`): Both routes render `PageHeader` when signed in. Hand-rolled sticky headers here (e.g. 75px with `h-6` title and `space-y-1`) violate the rule and cause a 4px jump; they must reuse `PageHeader` directly. Signed in, below `md` the skeleton mirrors the loaded page: `compactTitle` gives the bar the plain "Followers"/"Following" title (a skeleton there renders as an arrow and a bar), the `PageHeader` box is `max-md:hidden` and a `md:hidden` block stands in for it (`pt-2`, the 44px "Back to profile" row, then a 20px `h-5` count flush under it, matching the loaded description's `text-sm` line). The logged-out header (`group-data-[shell=public]/shell:` variants) is the icon Back beside the title and count at every width, as `FollowListPage` renders it there.
      - `bookmarks` (`app/(timeline)/bookmarks/page.tsx`), `explore` (`app/(timeline)/explore/page.tsx`), `lists` & `lists/[id]` (`app/(timeline)/lists/page.tsx`): All render top-level `PageHeader`s (some with action buttons like `Button size="sm"` -> `h-8`). When adding `loading.tsx` skeletons for these routes, always reuse `PageHeader` with matching `h-7` title, `h-4` description, and `actions` skeletons, then draw the page's own shape under it: `PostListSkeleton` for a list of posts (`PostFeedLoading` is that header-plus-posts pair, used by Bookmarks and Favorites; `lists/[id]` draws its own header over the same `PostListSkeleton`, so its rows are full-bleed on a phone like the loaded posts), a `Frame divided` of rows for Explore.
      - `notifications` (`app/(timeline)/notifications/page.tsx`): Renders `PageHeader` with `PageSubnavProvider` for sticky filter tabs (`All`, `Mentions`), `MarkAllReadButton` in `actions`, and `PageRefreshButton` in `mobileBarActions` (putting Refresh in the mobile compact bar below `md` and at the trailing end of the header actions row from `md` up, while Mark all read stays in the content row on mobile). Skeletons must include both the `PageHeader` (with matching `actions` and `mobileBarActions` skeleton sizes) and subnav tab placeholder inside the sticky header container to prevent tab strip jumps.
    - **Section-mode routes (`settings`, `fitness`, `gallery`, `admin`, `account`):**
      - The outer layout (`app/(timeline)/<section>/layout.tsx`) renders the sticky `PageHeader` _outside_ `PageHeaderSectionProvider`, while the section navigation (`SectionNavDropdown`, rendered by `SectionLayout` for Settings, Account & security and Admin, directly by the Fitness and Gallery layouts) and children render _inside_ it.
      - Child pages inside these sections render their own `PageHeader` in **section mode** (plain in-panel title block `mb-6 text-xl`, not sticky, not breakout; an `h2`, because the section layout's `PageHeader` owns the page's `h1`).
      - Child route skeletons inside these sections must **NEVER** render a sticky breakout `PageHeader`, as that duplicates the sticky header already rendered by `layout.tsx`. If a child route skeleton has a header, it must render an in-panel section title skeleton.
    - **Non-header pages (`[actor]/[status]`, `[actor]` profile):**
      - Detail pages (`[actor]/[status]/loading.tsx`) and profile pages (`[actor]/loading.tsx`) do not render a top-level `PageHeader` and have bespoke layout structures (post permalink card with back navigation, or profile cover, avatar, counts strip and post list). Skeletons for these pages mirror their respective card or profile geometry instead of `PageHeader`. Below `md` the status page renders `MobileCompactHeader` itself ("Post"/"Activity"), and the profile renders the floating menu button with its cover flush to the top; their skeletons mirror that. The status skeleton is the full-bleed surface signed in and, logged out below `md`, an inset card one `py-6` gap under the top bar (see **Logged-out pages**).
    - **Hashtag page (`tags/[tag]`, `HashtagTimeline`):** signed in, it renders `PageHeader` (title `#tag`, description the post count) so from `md` up it has the standard sticky 79px chrome, the title at 16px from the top and the content 24px below, like Bookmarks or Favorites; its `loading.tsx` draws both headings (the sticky one and the plain logged-out one) and `PostListSkeleton`, and `group-data-[shell=public]/shell:` shows the right one. Below `md` the page must keep its phone layout (compact bar "#tag", then the plain count 24px under it), so the box takes `className="max-md:hidden"` and the count is a separate `md:hidden` line; `PageHeader`'s own mobile box (16px padding, in the 24px stack) would move it. Logged out there is no mobile navigation provider, so `PageHeader` would be sticky chrome at every width inside `PublicShell`'s narrow column: that branch keeps the inline icon-and-title block, one `py-6` gap under the public top bar at every width.

#### Section navigation: one dropdown, never an in-pane list

- **Every section switches between its pages with `SectionNavDropdown`** (`@/lib/components/section-nav-dropdown`), at every width, above the page content. Settings (`app/(timeline)/settings/layout.tsx`), Account & security (`account/layout.tsx`) and Admin (`admin/layout.tsx`) render it through `SectionLayout` (`@/lib/components/section-nav`), which also owns their index pages; Fitness, Gallery and Fitness › Connections render it themselves. Do **not** re-inline dropdown markup, and do **not** render a navigation list, rail, tab strip or second menu of a section's pages inside the content column beside the app sidebar at any width — no rail, no "Back to …" row below `lg`, no wider `--container-section` column. `lib/components/sectionNavPattern.test.ts` fails on a reintroduction.
- **Input:** `label` (the `<nav>` landmark's name), `groups: SectionNavGroup[]` (`{ heading?, items: SectionNavItem[], menuOnly?, afterFooter? }`, each item `{ name, url, icon: ReactNode, description?, alsoMatches?, badge?, badgeLabel?, danger? (destructive action: name and icon in the destructive colour) }`), an optional `footer: SectionNavFooter` (`{ heading, item }`) and, for a section with a list page, `indexUrl` (and `shortLabel` for a long name: Account & security's "Account" below `md`). The shapes live in `lib/components/section-nav-shared.tsx` and each section's `sections.tsx` exports them; Fitness and Gallery pass one headless group and no `indexUrl`. Icons are rendered elements (`<Sun />`), not components, so a server layout can pass the list straight through. Sentence-case names ("Blocked accounts"); long names truncate in the trigger and the rows.
- **The row:** with `indexUrl`, a plain link to the section's list page (visible "Admin", "Settings", "Account & security" / "Account" below `md`; accessible name "Admin (all pages)" etc.), a "/" and the trigger, in one `<nav aria-label="Admin">` — not a breadcrumb landmark, and no crumb after the trigger. Without `indexUrl` (Fitness, Gallery) the row is the trigger alone. A page nested under an item (an admin account, report, hashtag or domain, Add domain, a signed-in verify-email under Email & name via `alsoMatches`, a bike under Gear) shows its parent on the trigger and keeps its own `BackLink` under the row.
- **Trigger:** an outline `Button` (`h-10 rounded-lg`, `w-full` below `sm`, `sm:w-64`) showing the active page's icon in `text-primary`, its name, and a muted `ChevronDown`; no group name, no count. The active page is the longest-prefix match of the pathname against the items' urls and `alsoMatches` (`resolveActiveSectionUrl`, `@/lib/components/sectionNavActive`); when nothing matches the trigger reads the section's name and no row is current.
- **Menu:** `DropdownMenuContent` with `align="start"`, `sideOffset={6}`, `w-(--radix-dropdown-menu-trigger-width) rounded-xl shadow-lg`; capped to the viewport and scrolling inside itself (the primitive's `max-h-(--radix-dropdown-menu-content-available-height)`), and it opens with the current row focused and scrolled into view (`onOpenAutoFocus`, spread onto the content because Radix keeps that prop off its public types), so the arrow keys continue from it. Rows are `<Link>`s in `DropdownMenuItem asChild`, `gap-2.5 rounded-lg px-3 py-2 font-medium`, 44px tall under a coarse pointer, the current one `aria-current="page"` on `bg-primary/10 text-primary-text` with its wash held on focus and a `focus:ring-2` (see **Fitness Gear** in `docs/fitness-file-storage.md` for why `text-primary-text`). Groups keep their headings as small muted labels (`DropdownMenuLabel` naming a `DropdownMenuGroup` through `aria-labelledby`); a headless run after the first block gets a separator; headless runs are plain blocks, not unnamed groups. A badged row (Admin's Reports) shows `NotificationBadge` after its name with the sr-only "(N unresolved reports)". The footer cross-link (Settings → "Account & security", Account & security → "Settings for @handle") is a plain row with a muted chevron at the foot after a separator, then the `afterFooter` groups (Settings' "This profile": Moving and Delete this profile, a page link whose name and icon carry the destructive colour). When the danger item is the current page (`/settings/delete`), its dropdown row and the trigger use the normal current-row styling (primary), not the destructive colour. `menuOnly` groups (Settings' Edit profile) are in the menu but not in `SectionIndex`. Phones use the same menu under the full-width trigger; there is no sheet.
  - **Index routes (`/settings`, `/account`, `/admin`):** the three sections serve their index pages at every width — there is no dropdown row on the index. Groups display as framed lists (`FramedList`) in one column, capped at 680px and left-aligned, with descriptions visible from `lg` up and names only on phones. Blocks render in order: the non-`afterFooter` groups, then the footer cross-link card, then the `afterFooter` groups. The card above the list (Settings' profile card, Account's identity card) and the index loading skeletons share the same 680px left-aligned cap.
    - **Settings (`/settings`):** Profile card (desktop: avatar, name, handle, View profile / Edit profile buttons; phones: avatar and Edit profile row) followed by `SectionIndex` with Settings groups, the footer cross-link ("Shared across your profiles" → Account & security at `/account`), and the `afterFooter` "This profile" group ("Moving" at `/settings/moving`, then "Delete this profile" at `/settings/delete` in the destructive colour).
    - **Account & security (`/account`):** Reachable from the account menu at the bottom of the sidebar (as well as the tablet rail flyout and mobile drawer) and the Settings index footer card. Renders `AccountIdentityCard` (name, email, account photo) followed by `SectionIndex` with Account groups (Email & name, Password & sign-in, Sessions & apps, Profiles, Import and export), and the footer cross-link card ("Settings for @handle" → `/settings`).
    - **Admin (`/admin`):** Admin is the grouped index at every width: `app/(timeline)/admin/page.tsx` renders nothing and the layout renders `SectionIndex` (`indexUrl="/admin"`), the list sitting flush under the header (the index wrapper's top margin applies only when the page above rendered something). The stats page is `/admin/overview` ("Dashboard"). The groups (`app/(timeline)/admin/sections.tsx`) are Overview (Dashboard), then Moderation (Reports, Accounts, Hashtags, Server filters, Federation), Community (Announcements, Custom emojis), Server (Server settings at `/admin/instance`, Server rules, Posts & media, Network, Served domains at `/admin/domains`, Relays) and Maintenance (Queues, System). Admins see the unresolved report count, capped at 100, on Reports in both the dropdown menu and the index; resolving or reopening a report refreshes it.
- **The sidebar's Admin item** carries the unresolved report count for admins (`openReportCount` from `app/(timeline)/layout.tsx`, capped at 100, on the desktop row, the tablet rail icon and the drawer row with the sr-only "(N unresolved reports)"), as the Notifications item carries the unread count; resolving or reopening a report refreshes it through `router.refresh()`.
- **Shared longest-prefix active URL matching:** `resolveActiveSectionUrl` from `@/lib/components/sectionNavActive`.
- **Two tiers of header:**
  1. A **shared section header** at the very top (e.g. `Settings` / "For @handle") that uses the sticky chrome. Render a `PageHeader` **outside** `PageHeaderSectionProvider`.
  2. The **per-page title** ("Appearance", "Privacy", …) below it, rendered by each page's own `<PageHeader>` in **section mode**.
- `PageHeaderSectionProvider` from `@/lib/components/page-header` switches every descendant `PageHeader` into **section mode**: a plain, non-sticky, non-breakout in-panel title block (`mb-6 text-xl`) that sits at the top of the content column.

  ```tsx
  // app/(timeline)/settings/layout.tsx
  import { FC, ReactNode } from 'react'

  import { SectionLayout } from '@/lib/components/section-nav'
  import { getDatabase } from '@/lib/database'
  import { getServerAuthSession } from '@/lib/services/auth/getSession'
  import { getActorFromSession } from '@/lib/utils/getActorFromSession'
  import { isRealAvatar } from '@/lib/utils/isRealAvatar'

  import { getSettingsGroups, settingsFooter } from './sections'

  interface Props {
    children: ReactNode
  }

  const Layout: FC<Props> = async ({ children }) => {
    const database = getDatabase()
    const actor = database
      ? await getActorFromSession(database, await getServerAuthSession())
      : null
    const profile = actor
      ? {
          handle: `@${actor.username}@${actor.domain}`,
          username: actor.username,
          iconUrl: isRealAvatar(actor.iconUrl) ? (actor.iconUrl ?? null) : null
        }
      : null

    return (
      <SectionLayout
        label="Settings"
        title="Settings"
        description={profile ? `For ${profile.handle}` : undefined}
        indexUrl="/settings"
        groups={getSettingsGroups(profile)}
        footer={settingsFooter}
      >
        {children}
      </SectionLayout>
    )
  }

  export default Layout
  ```

- A **nested sub-nav that navigates** — one whose entries are other routes inside the section — renders as a small **in-content segmented control**, not a second dropdown or rail. Hand it to the closest section-mode `PageHeader` via `PageSubnavProvider` so it sits directly **below the per-page title** (header-first, like the non-nested pages) rather than above it. (The section layouts themselves use `SectionNavDropdown` above, not this nested pattern.)
- A nested sub-nav that switches a **view of the page you are already on** is a dropdown instead — the shared `SectionNavSelect` (`@/lib/components/section-nav-select`), described below. That is the design system's own call rather than a carve-out invented here: `ui_kits/web/GearKit.jsx` puts a `GKViewDropdown` on a gear's page below the stat tiles it re-renders, with the section's own "Gear ▾" dropdown still above it. The distinction is what the control does, not where it sits: a segmented control reads as "more of this page", which is wrong for something that replaces the page's whole body, and it carries no per-entry icon, which both of these designs do.

#### Section sub-nav in local state (`SectionNavSelect`)

- **`SectionNavSelect` is the state-driven twin of `SectionNavDropdown`**, and there is one implementation of each — do not re-inline either. Both render the same chrome: an outline trigger carrying the active tab's Lucide icon in `text-primary`, a sentence-case label and a muted `ChevronDown`, over a `rounded-xl` menu sized with `w-(--radix-dropdown-menu-trigger-width)`. They differ only in what a row does. `SectionNavDropdown`'s rows are `<Link>`s, its active row is resolved from `usePathname()` and marked `aria-current="page"`; `SectionNavSelect` takes `{ tabs, active, onChange }`, its rows are `DropdownMenuItem`s calling `onChange`, and the current one is marked with the **boolean** `aria-current` — nothing here is a page. `SectionNavSelect`'s menu has no groups, footer or list-page link; only the chrome is shared.
- The fitness activity page's recording picker (`FitnessRecordingPicker`) is not a third consumer but wears the same chrome — an outline trigger with a muted `ChevronDown`, a `rounded-xl` menu, `rounded-lg` rows and the current row on `bg-primary/10 text-primary-text` with the same focus ring, marked with the boolean `aria-current` — because the two menus sit within a screen of each other. Keep them in step.
- Its two consumers are a bike's gear page (Components / Activities) and the profile's Gallery tab (`ProfileGalleryTab`: Subjects / Recent / Albums / Map / Life list, limited to the subviews the viewer may open). With five profile tabs the tab list scrolls sideways below `sm` (`overflow-x-auto`, `justify-start`, `flex-none` triggers); with four or fewer it is unchanged. Do not hand-roll a third copy of that markup.
- **Both** active rows take `text-primary-text`, not `text-primary` — see the orange-text rule under **Fitness Gear** in `docs/fitness-file-storage.md`. That is the one place the pairing is load-bearing rather than cosmetic: the two dropdowns appear on one screen (a bike's page carries the fitness section's nav above its own view switcher), so a mismatch reads as a mistake, and `--primary` as a foreground is under the AA floor either way. Each keeps its wash on `focus:` and therefore also carries `focus:ring-2`, or a keyboard user watching the highlight move down the list would see it vanish on precisely the current row.

#### Sticky-header sub-nav (`PageSubnavProvider`)

- `PageSubnavProvider` remains available for sections that need horizontal tabs **inside** the sticky header: wrap the layout's `{children}` in it and pass the rendered tabs as `subnav`. The closest `PageHeader` renders the tabs directly under the title row, inside the sticky chrome. Do **not** render the sub-nav directly in the layout JSX above the header. No settings-style section layout uses this; the top-level Notifications page (`app/(timeline)/notifications/page.tsx`) uses it for its sticky-header filter tabs (sticky from `md` up; below `md` they sit in the content row under the compact bar and scroll with the page), and the primitive also backs the nested in-content segmented-control pattern.

  ```tsx
  import { PageSubnavProvider } from '@/lib/components/page-header'

  // const subnav = (/* tabs strip — desktop tabs + mobile dropdown */)
  // return <PageSubnavProvider subnav={subnav}>{children}</PageSubnavProvider>
  ```

#### Mobile chrome (below `md`)

- **One drawer, one trigger component.** `MobileNavigationProvider` owns the drawer's open state and wraps its children in the Radix Dialog root; `MobileNavigationTrigger` is the only button that opens it, in two looks: `bar` (start of the compact bar) and `floating` (the profile's round button). Both are `DialogTrigger`s under the same provider, so they open the same drawer and focus returns to whichever opened it. Render exactly one trigger per screen. The drawer shell (`MobileNavigationDrawer`: overlay, `min(320px, 100vw - 48px)` panel, close button, Escape/outside-tap close, no focus return after a navigation or a resize to `md`) belongs to the signed-in `MobileNav`, which renders `Sidebar variant="drawer"`, so registry order, More, account switching and gating stay in one place. The provider is mounted only by the signed-in `(timeline)` layout; every piece of this chrome renders nothing without it (see **Logged-out pages** below).
- **Counts live in the drawer, never on the menu button.** The trigger's accessible name is always "Open navigation"; the unread count shows on the drawer's Notifications row. The Drafts row's count pill lives there too.
- **Connection status strip (`ConnectionStatusStrip`).** While the app is not online, a `bg-info-surface` strip (52px minimum, taller when its title wraps) is a sibling right under the compact bar (`MobileCompactHeader` returns both and gives the strip the bar's own spacing class, and the bar drops its margin while the strip follows it, so a parent's `space-y-*` gap opens only under the pair: never under a strip that continues a `PageHeader` box, and under the strip, not between bar and strip, on a title-only page), sticky at 56px plus the top safe area, `z-30`, with `data-connection-strip`. `app/globals.css` keys `--status-strip-h` on it (`html:has([data-connection-strip])`, 52px), and the strip overrides that with its measured height (a `ResizeObserver` sets it inline on `<html>` while the strip shows and removes it when it goes); the variable is added to both `scroll-padding-top` rules and `--backdrop-top`, and pushes the compact bar's overlay slot (`data-compact-header-overlay`, the home "N new posts" pill) below it; the pill rule targets that data attribute, never the `top-full` utility class. The profile has no compact bar, so it has no strip. The strip is purely visual: `ConnectionAnnouncer` is the one live region.
- **Compact bar (`MobileCompactHeader`).** A 56px sticky row (a 55px content box plus its 1px bottom border, so the top safe-area inset is added on top), `bg-surface-chrome`, bottom border: the menu button and one truncating title (the full string stays in `title`). The bar's `pl-2` and the trigger's own 44px hit area, with no negative margin, put the 20px icon at x=20 and the title (`text-lg font-semibold`; this repo's `text-lg` is the design's 18/24, see `--text-lg--line-height` in `app/globals.css`) at x=60. No logo, subtitle, breadcrumb, badge or Back. The one exception is the `actions` slot after the title, used only by the home timeline's Refresh (`PageHeader`'s `actionsInMobileBar`); the bar's `pr-4` puts that 36px button on the 16px content gutter. `PageHeader` renders it for every top-level page; pages without a `PageHeader` render it themselves (status, the redirect card, the terms and privacy policy pages). Section layouts' bars carry the section name ("Settings", "Fitness", "Gallery", "Admin", "Account & security"); in `SectionLayout` (Settings, Account & security, Admin) below `md`, the section header box shows only on the index, so child pages open on the section row (the list-page link and the dropdown); in Fitness and Gallery the section's description, the dropdown and the child page's section-mode heading stay in the content.
- **Profile.** No bar at any scroll position: the cover is full-bleed and flush to the top, and the `floating` trigger is fixed at a 16px (+ safe-area) inset with a solid `bg-popover` surface, border, shadow and a two-part focus indicator: the `ring-2 ring-ring ring-offset-2` ring plus a 1px `outline-foreground` outline at offset 4, which keeps the indicator visible where the orange ring vanishes against an orange cover. Do not put `focus-visible:outline-hidden` on that button; it sets the outline style to none and cancels the outline. The button fades to `opacity-40` while the window is actively scrolling (a passive `scroll` listener; it returns `FLOATING_TRIGGER_SCROLL_IDLE_MS`, 200ms, after the last scroll event) so it does not sit over the text being read. It is never faded while the drawer is open, `focus-visible:opacity-100` keeps it opaque under keyboard focus, `motion-reduce:transition-none` drops the fade animation, and opacity never blocks the click.
- **Back goes in the content.** A parent-route Back is a `BackLink` (or `PageHeader`'s `back`) — a 44px row (`gap-2`, a 16px arrow on the 16px content gutter with no negative margin or padding, then a `text-sm font-medium text-muted-foreground` label at x=40); from `md` up it collapses to the 20px icon. The post page's history Back is the same row (`MOBILE_BACK_ROW_CLASS`), and its container carries `max-md:px-4` so the arrow lines up with the card's avatar. The post/activity page's Back is history-based: `router.back()` only when `InAppHistoryTracker` (root layout) has recorded an earlier, different page in this tab, otherwise a real link to the author's profile built from the handle parsed out of the URL — never from the raw path segment, which can decode to an off-site `//host` (`useInAppBack`; its server snapshot is `null`, so a direct entry renders the link on both sides of hydration and the history Back takes over after). The record is a pathname heuristic, not a guarantee: a new pathname is a push (so a link back to a page already visited still names the page just left), a `popstate` is a pop to the nearest earlier entry, and `lib/components/navigation-history/inAppHistory.ts` documents where it errs in each direction (a multi-step `history.go(-n)` over a repeated pathname, for one). In-pane Backs (message conversation, filter editor, gear detail, heatmap region) keep their own patterns, and gallery arrows and pagination are not navigation headers.
- **Back labels.** The visible text is "Back" everywhere — list and admin detail Backs, and the post page's history Back — except a Back whose destination is a profile, which reads "Back to profile": the signed-in followers/following Back, the post page's direct-entry fallback, and a history Back whose previous page was a profile. The accessible name always names the destination and contains the visible text (WCAG 2.5.3): "Back to lists", "Back to accounts list", and for a profile "Back to profile, <display name>" (the visible words come first, as written; `profileBack`/`profileName` in `lib/components/navigation-history/backDestination.ts`; the full `@user@domain` when there is no display name, and custom-emoji `:shortcodes:` are dropped from the name because it is spoken). The history Back names the page it returns to from that page's recorded pathname (`resolveBackDestination`), with registry labels from `nav-items.ts` where one exists:

  | Previous pathname                                                                                                                                     | Accessible name                                                                                                               | Visible         |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
  | `/`                                                                                                                                                   | Back to Timeline                                                                                                              | Back            |
  | `/notifications`, `/search`, `/explore`, `/messages`, `/favorites`, `/bookmarks`, `/fitness/*`, `/gallery/*`, `/settings/*`, `/account/*`, `/admin/*` | Back to Notifications, Search, Explore, Messages, Favorites, Bookmarks, Fitness, Gallery, Settings, Account & security, Admin | Back            |
  | `/lists`, `/lists/new`                                                                                                                                | Back to Lists                                                                                                                 | Back            |
  | `/lists/<id>/*`                                                                                                                                       | Back to list                                                                                                                  | Back            |
  | `/tags/<tag>`                                                                                                                                         | Back to #tag                                                                                                                  | Back            |
  | `/@user@domain`                                                                                                                                       | Back to profile, @user@domain (only the handle is known from a pathname)                                                      | Back to profile |
  | `/@user@domain/followers` · `/following` · `/fitness/*`                                                                                               | Back to @user@domain's followers · following · fitness                                                                        | Back            |
  | `/@user@domain/<status>`                                                                                                                              | Back to post                                                                                                                  | Back            |
  | anything else                                                                                                                                         | Back to previous page                                                                                                         | Back            |

  The desktop icon Back on the post page carries the same name when there is an in-app page to return to, and "Go back" otherwise (it calls `router.back()` either way). The name is only ever text: the history Back is a `router.back()` button, never a link built from the recorded pathname.

- **Logged-out pages keep the branded top bar.** This chrome is for signed-in viewers only. What a logged-out viewer gets of it is the same page content on the same kit surfaces, inside a different shell: profiles (the flat header with `ProfileCover`, the `counts` strip, the tabs and the post list frame), posts, followers/following (`FramedList`), hashtags (a `text-xl` heading over the post list frame) and their loading skeletons are the pages a signed-in viewer sees, with `PublicShell`'s 680px column and its own spacing, apart from the deliberate visual exceptions below. The terms of service and privacy policy pages (`/terms-of-service`, `/privacy-policy`, `app/(timeline)/(policies)/`) use `PublicShell footer={false}` for logged-out visitors, since the page prints its own footer (the other policy's link and the instance's contact); signed-in visitors get the page inside the nav chrome with `MobileCompactHeader` (title "Terms of service"/"Privacy policy") below `md` and a `md:pt-8` top gap from `md` up in place of the shell's `py-6`. The remote-actor redirect card and the shared heatmap (`/u/heatmaps/[token]`) keep their own layout (the shared heatmap's logo loads from the canonical-origin URL; every brand logo on these pages and the landing comes from `getBrandAssetSrc`, which keeps that absolute URL except in `next dev`, where it stays root-relative so the logo loads when the browser is on a host other than `ACTIVITIES_HOST`). What stays logged-out only is the chrome: `PublicTopBar` (logo, Sign in, and Create account only while registration is open) at every width, no compact bar, menu button or drawer. `PublicShell` mounts no `MobileNavigationProvider`, so `MobileCompactHeader`, `MobileNavigationTrigger` and `PageHeader`'s mobile split render nothing there; a page or skeleton shared by both viewers keeps its logged-out geometry by gating mobile-only classes on the provider (`ProfileCover`, `PageHeader`'s mobile split), on the session (the status page's inset cards), or on `group-data-[shell=public]/shell:` variants (skeletons). Embeds and the centred auth pages get no chrome.
- **A logged-out visitor never triggers a remote profile fetch.** `getRemoteProfileData` returns `null` when the viewer is not signed in, so `app/(timeline)/[actor]/page.tsx` shows the remote-actor redirect card when `getNonLocalActorRedirectTarget` finds a target and `notFound()` otherwise. A 404 for a remote profile while logged out is by design, not a federation failure.
- **Exception: the logged-out status page is inset cards below `md`.** A logged-out post or activity (`/@actor/<status>`) is the one logged-out page that does not look like `main` on a phone. Its media rows bleed to the card's inner edge, since the card is their owning frame there. Full-bleed there reads as the post bleeding out of the page, because the callout and footer around it are framed blocks. Below `md` the page's outer frame takes `MOBILE_INSET_STACK_CLASS` instead (`lib/components/posts/feedLayout.ts`): it stops painting its own frame and stacks two cards 24px apart, the thread (the post and its replies, or the activity, each a `rounded-lg border` frame) and the `SignInCallout`, both at `PublicShell`'s 16px gutter, the footer's inset. The 24px is also the gap under the top bar, which is `PublicShell`'s own `py-6`, so the thread starts one gap below the bar and the gap to the callout matches it. The first row of the thread keeps `rounded-t-lg` at every width (`StatusThread` resets its rows with `max-md:rounded-none` only for a signed-in viewer, since a logged-out thread is a card, not the surface); the activity's replies are inside its post, which is flush in the page card with no frame of its own, so they follow that card. Every class is `max-md:`-scoped: from `md` up a logged-out page is still one rounded card with the callout inside it, and a signed-in page (below or above `md`) keeps the full-bleed surface. The loading skeleton (`[status]/loading.tsx`) matches with `group-data-[shell=public]/shell:max-md:` variants that undo the feed surface on its single placeholder card (gutter back, radius, border) and no `-mt-6`; it has no callout placeholder.
- **Intro row and section spacing.** Below `md` a `PageHeader` whose bar already holds the title shows its description as `text-sm` text on a 20px line, flush with the box's 16px top padding. In `SectionLayout` (Settings, Account & security and Admin), below `md` the header box shows only on the index (`/settings` with "For @handle", `/account` with "Shared across your profiles · email", `/admin` with its description), where it renders flush (`pt-0`), followed by the top identity card (profile card or `AccountIdentityCard`) and `SectionIndex` (Admin's page renders nothing, so its list sits flush under the header box). On child pages below `md`, the header box is hidden (`max-md:hidden`), so the page opens on the section row 12px under the compact bar (`max-md:pt-3`), the child page's heading 20px below it (`max-md:mb-5`); from `md` up the row sits 16px (`pt-4`) under the sticky header, like Fitness. Admin's detail pages (an account, a report, a hashtag, a domain's page or its new form) keep their own Back link under the row. For content sections using `SectionNavDropdown` (Fitness, Gallery), the description is followed by `SectionNavDropdown` 16px below (the layout's `pt-4` is `max-md:pt-0`, so only the box's bottom padding separates them) and the child page's heading 20px below the dropdown (`max-md:mb-5`). The margin belongs to `SectionNavDropdown`, so the nested Fitness › Connections dropdown also sits 20px above its content below `md`. Each of these is `max-md:`-scoped; from `md` up the description stays `text-xs` and the 32px / 16px spacing is unchanged.
- **Z-order.** Desktop sticky `PageHeader` 20; mobile compact bar, the connection status strip, `PublicTopBar`, the floating profile button, scroll-to-top and the post reaction-picker backdrop 30 (the floating button renders first in the DOM, so a later same-z backdrop paints over it); in-content popovers 40 (the announcements panel is 30 inside the header's own stacking context, so post popovers paint above it); the drawer, dialogs, dropdowns, tooltips, `MediasModal` and the "Saved to Drafts" note 50. `app/globals.css` pads the scroll snapport under the mobile chrome so focus is never hidden beneath it.
- **Server-rendered components read chrome values from `lib/components/layout/chromeLayout.ts`** (`breakoutStyle`, the bar and back-row class strings) — `BackLink` when a server page renders it, the followers/following loading skeleton — never from the client components that use them — see **Server/Client Module Boundary**.
- **The desktop rendering (≥768px) is visually unchanged by the mobile chrome.** Mobile-only nodes (the compact bar, the floating trigger, Back rows) stay in the markup at every width but are `md:hidden`; mobile styles are `max-md:`-scoped and desktop chrome classes are `md:`-prefixed.

<a id="agents-fitness-overview-calendar"></a>

### Fitness Overview Calendar

The fitness overview (`app/(timeline)/fitness/`, with its calendar components in `lib/components/fitness/calendar/`) brings the patterns below. Reuse them rather than adding a second variant.

- **Header slots.** The Server Component page passes `OverviewHeaderSlot` elements (empty `contents` spans) as `PageHeader`'s `description` and `actions`; on a container of 600px or more the client dashboard portals the applied dates and the range picker, with a `RefreshButton` (`lib/components/refresh-button.tsx`, the home timeline's Refresh) at its end that re-reads the range and spins while loading, into them with `InOverviewHeaderSlot`, and on a compact one it keeps its own heading and leaves them empty. The slots are empty in the server's HTML on purpose: the dates are the viewer's local days, and only the client knows the zone. `PageHeader` cannot tell an empty slot from a filled one, so it still renders their wrappers.
- **Scoped heat and motion tokens.** Heat colours are the `--heat-0`…`--heat-4` fills, their `--heat-N-fg` numeral colours, `--heat-upcoming` and `--heat-out-of-range`, defined in `app/globals.css` under the `fitness-heat` class (light and `.dark`) that each calendar root carries. Never hard-code a heat colour, and do not move them to `:root`: green means intensity only inside the calendar. Durations are the `--fitness-t-*` tokens beside them. `--fitness-fade-start` and `--fitness-fade-end` are registered with `@property` so the annual scroller's edge-fade mask can transition; an unregistered custom property inside a gradient cannot.
- **Reload control.** A surface that can be reloaded in place puts the shared `RefreshButton` at the end of its header or section row (the home timeline and the fitness overview do), rather than a hand-rolled Refresh button; pass a `size-*` class to match the row's other controls.
- **One CSS module.** `lib/components/fitness/calendar/calendar.module.css` is the only `*.module.css` in `app/` and `lib/`. It holds only what Tailwind utilities cannot express: pseudo-element, mask, gradient and hit-band work such as the cell state marks and focus brackets, the slashed out-of-range cell, the skeleton cell, the edge-fade mask, the today marks, the legend swatch and the month-label hit band. Layout, spacing and type stay in Tailwind at the use site. State is read from data attributes (`data-level`, `data-state`, `data-loading`, `aria-pressed` and the like), never from extra classes, so tests assert a cell's state without knowing a hashed class name, and `calendar.module.css.test.ts` guards the selectors and tokens it relies on. Extend this module for calendar visuals rather than starting another.
- **Section primitives.** Fitness pages build on the app-wide surface kit (`lib/components/surface/`, see **Surfaces**): `Section`, `StatStrip` / `StatCell`, `Alert`, `EmptyState` and `TABLE_HEAD_ROW_CLASS`. Loading is the shared shimmering `.skeleton` bars (still `--skeleton` blocks under `prefers-reduced-motion`), never a centred "Loading..." line; the calendar's cells, which cannot carry `.skeleton`, sweep one viewport-attached band in `calendar.module.css` instead. The overview, Gear, a gear's page, Files, Heatmaps and Privacy use the kit; the Strava and Wahoo connection pages are `Section`s each holding a `Frame form` of `FormRow`s (a hidden file input behind an outline `Button` for the archive upload, a labelled `role="group"` around each visibility picker, a read-only URL row with Copy), with hand-built `SaveBar`-style footers (on the left an always-mounted polite `role="status"` line for the save result, swapped for a `role="alert"` line when there is an error (as `SaveBar` does), the Unlink / Disconnect / Connect / Save buttons in an `ml-auto` group with a spinner inside Save while it saves), failed imports as a `FramedList` with an `EmptyState`, and import status cards and their `Alert`s below the `Frame`, while a settings form's standing warnings sit above the `Frame` in the `Section`'s stack. A new fitness surface reuses the kit; there is no `Card` component to reach for.
- **Popover.** `lib/components/ui/popover.tsx` wraps `@radix-ui/react-popover` like the other `ui/*` primitives. The range picker uses it when the whole panel fits beside its trigger and falls back to a bottom sheet otherwise (`rangePickerPresentation.ts`); it renders in a portal at the dropdowns' layer (50). The calendar's own cell tooltip is not `ui/tooltip` but one shared `CalendarTooltip` per calendar; its header comment says why.

<a id="agents-surfaces"></a>
<a id="review-surfaces"></a>

### Surfaces (Shared Surface Kit)

Every page is laid out from one kit in `lib/components/surface/` (import each piece from its own file, for example `@/lib/components/surface/Frame`; `index.ts` re-exports the lot plus `RefreshButton`). Fitness, Gallery, Albums, Settings, Account, Admin, Notifications, Messages, Lists and the timeline pages (Home, Bookmarks, Favorites, hashtags, lists, profile, status, followers and following, Explore, Search) and the auth pages under `app/(nosidebar)/` use it, so a new surface reuses it instead of a `Card`, a `rounded-2xl` panel or a hand-coloured banner.

| Component                                                            | Use it for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Section`                                                            | A titled block: `text-base font-semibold` heading on the page (not in a card), optional `icon`, `meta`, muted `description` and `actions` at the row's end; `headingLevel` (default 2); `id` makes it an anchor and `headingId` names the heading for a control inside that is labelled by it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Frame`                                                              | The one flat surface, `rounded-lg border bg-background`, no shadow. `muted` tints it `bg-muted/40`, `divided` puts `divide-y` between a list's rows, `form` makes it one form's box (children wrapped in `py-1.5`, never divided; wins over `divided`), `footer` adds a bar under a top border, `stickyFooter` keeps that bar (`sticky bottom-0 z-10 rounded-b-lg bg-background`, safe-area padding) in reach on a long form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `FormRow`                                                            | One settings row inside `Frame form` (`px-4 py-2.5`, so two rows sit about 20px apart with no rule): label (`htmlFor`) and `hint` in the left third, control in the right two thirds from `sm` (`grid-cols-[1fr_2fr]`, so every form's controls start on one line), stacked on a phone. `inline` keeps a switch or checkbox on the label's row on a phone, `stacked` keeps label above control at every width (a narrow single column such as a dialog; the auth cards pass `className="p-0"` inside `AuthCardBody`). A render-prop child gets `describedBy` for `aria-describedby` and `labelledBy` for `aria-labelledby` (a radio group or `SegmentedControl`, which `<label for>` cannot name; also `formRowLabelId`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FormGroup`                                                          | An in-box group heading for one `Frame form` that spans several former sections (Profile and Privacy under one Save): `title`, optional `description`, `headingLevel` (2 default, 3, 4) as a `px-4 pt-5 pb-0.5` block (`pt-2.5` when first), a `text-base font-semibold` heading (as `Section`'s) and a `text-sm` muted description, over the group's rows in a `role="group"` named by the heading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SaveBar`, `SavedIndicator`                                          | A form's `Frame` footer: "Unsaved changes" (with a dot), "Saved" (with a tick) or a muted "No unsaved changes" on the left, the error in the alert colour, and a primary button labelled "Save" (the `create` variant uses its own label, and an `edit` footer may set `actionLabel` when the box shares its page with others and says what it saves, such as "Save terms and privacy"; `dirtyLabel` words the status while the form has changes ("You have unsaved changes"; "Unsaved changes" by default), `idleNote` replaces the muted "No unsaved changes" while the form is clean, for a line about what saving does, and Unsaved changes, Saved and an error still replace it; spinner inside while saving, disabled when clean). `submit` makes Save the enclosing form's submit button (the form's own `onSubmit` or `action` handles it, Enter included); `formId` names a form the bar sits outside of (a sticky footer drawn apart from the form), and Save submits that one. `actions` sets secondary controls (a Cancel link) beside Save, Save last. `disabledReason` keeps Save disabled and says why next to the status (a filter with no keyword). `SavedIndicator` is the quiet "Saved" tick for controls that save as they change; `announce={false}` drops its live region for a control that saves on every keystroke. `variant="create"` is the footer of a form that makes something new: no "Unsaved changes"/"Saved" status (only an error or the muted `disabledReason`), the form's own `actionLabel` and `actionIcon` on the button (`disabled`, `disabledReason` and `saving` still apply). |
| `AddBar`                                                             | The box that adds one short item (a hashtag, a rule, a relay inbox, a domain): a real `<form>` with the input and the Add button on one row, a visually hidden `<label>`, an optional `prefix` (`#`), a `hint`, and the `error` or notes (`children`) inside the box (a failed request is an `Alert` card above the bar, not inside it); `dropdown` hosts a suggestion list under the field. `action` for a server action, `onSubmit` for client state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RadioCard`                                                          | One explained choice inside a `RadioGroup`: radio on the left, optional small icon, title and hint, a tinted border and soft background when chosen. Used for visibility, the photo-save prompt and the filter action; keyboard and focus are the `RadioGroup`'s. Plain settings radios (Preferences) stay `RadioGroup` rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `StatStrip`, `StatCell`                                              | The hairline totals strip (1px dividers, 2x2 on a phone by container query, a dash for a missing value, a skeleton while loading). `variant` `chip` is the post-chip grid; `band` is the activity post's edge-to-edge figures band (hairline dividers like `summary` but with no frame of its own, 2 across, then all its cells in one row from 560px (4-up for the usual four), and the last cell of an odd count spans the row so the track never shows as an empty cell); `counts` is the same hairline strip for a few short integers (a profile's Posts, Following and Followers, a post's Boosts, Likes and Comments), which stays 3-up on a phone and stacks to one column only when the text is too large to fit, where `summary`'s `columns={3}` goes two over one for long totals like "35,670.2 km". A cell with `onSelect` / `selected` is a pressed-state button; one with `href` (and `prefetch={false}` for a per-user route) is a link, like a profile's Following and Followers counts. `columns` 1 to 5 sizes a strip of fewer than four cells.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `FramedList`, `FramedListItem`, `TableFrame`, `TABLE_HEAD_ROW_CLASS` | Lists and tables. A list is one `Frame` with `divide-y` rows (`px-4 py-3`, optional `href`); a table scrolls sideways in a frame under the muted `bg-muted/40 text-xs` header band.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `EmptyState`                                                         | A muted panel with the page's icon in a bordered tile, a bold line, a hint and an optional `action`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Alert`                                                              | Every message: `tone` `error` (default), `warning`, `success` or `info`, with an opaque tinted fill (`bg-<tone>-surface`), a tone-tinted outline, a 4px left rule and icon in the tone's colour, a title, a description and an `action` or `onRetry`; an optional `icon` replaces the tone's icon (the connection status bar's WifiOff and AlertTriangle). Every Alert is the same standalone card: it sits in the page or section stack beside the boxes, aligned with their left and right edges, never inside a `Frame` (a form's warning or error goes in the stack directly above its `Frame`; a danger zone is the Alert itself, with no box around it). Two places keep an Alert inside a box because the box is the page's surface: an `AuthCard` and the Messages chat panes (`MessagesPage`); `alertOutsideFrame.test.ts` allows only that file. Error and warning are `role="alert"`, success and info `role="status"`; `live={false}` drops the role for a standing message that is part of the page from the start (a danger zone).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SegmentedControl`                                                   | A range, filter or tab set in the Fitness calendar's segmented style: a radio group with arrow keys for in-page state, or `asLinks` for navigation (`aria-current="page"`). Sizes `sm` / `md`; scrolls sideways on a narrow screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SectionSkeleton`                                                    | The shape of a section route while it loads, for `loading.tsx`: the title line, then each `Section` as a heading bar and a `Frame` outline of rows (`sections={[3, 2]}`; an array entry such as `[1, [1, 5, 1], 1]` with `form` draws one form box of `FormGroup`s with a footer bar, `tallSections`, the indexes of sections whose rows hold a tall control such as a 16-row textarea, `title`, `headings`, `descriptions`, on by default, for the muted description line under each heading, `label`). Draws no text; one polite `role="status"` "Loading".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ScreenSkeleton`, `DescriptionSkeleton`, `StatStripSkeleton`         | The loading screen of a section's child page, for a `loading.tsx` under a layout that already draws the section header and dropdown: `ScreenSkeleton` is the page's own title block (the section-mode `PageHeader` with a bar for the title, `description` and `actions`) over whatever body the route draws, with `label` as the screen's one polite `role="status"` (leave `label` out when the body is a client view's own skeleton that already carries one). `DescriptionSkeleton lines={[phone, wide]}` draws the description's wrapped lines, so the content below starts where the loaded page puts it. `StatStripSkeleton` is the loaded strip's cells with a bar where each value goes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SkeletonBar`, `SkeletonRows`                                        | Shimmer placeholders drawn in the final layout's shape, for `loading.tsx` and in-view loading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RefreshButton`                                                      | The reload control for a list that can go stale (re-exported from `lib/components/refresh-button.tsx`). A server-rendered page that reloads with `router.refresh()` uses `PageRefreshButton` (`lib/components/page-refresh-button.tsx`), as the admin queues and Notifications do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Rules:

- **Radii.** `rounded-lg` frames and panels, `rounded-md` controls and media tiles, `rounded-full` only for avatars, pills and round icon buttons (the media-strip arrows, the profile's floating trigger), `rounded-xl` only for dialogs. Never `rounded-2xl`, and no shadow on a panel: shadows belong to popovers, menus, dialogs and map overlays.
- **Copy.** Sentence case for every heading, label and button.
- **Colour.** Theme tokens only. Say success, warning, info and error with `Alert` (an opaque `bg-<tone>-surface` fill and tinted outline besides the left rule and icon; a caller must not override the fill with its own `bg-*`) and the `success` / `warning` / `info` / `destructive` tokens (`bg-*`, `*-foreground`, and `text-*-text` for text, which clear WCAG AA in both themes; `app/globals.contrast.test.ts` recomputes it), a state label with a `Badge` tone, and a link inside rendered HTML with `--link-color` (`[&_a]:text-(color:--link-color)`). No `text-green-600`, `bg-yellow-50`, `text-neutral-400` and the like. A surface that must stay dark in either theme (the photo viewer's album menu and toast, the admin `.env` block) takes the `dark` class on its root, which re-resolves the tokens to their dark values for that subtree, instead of fixed greys. The one exception is data: a fixed colour that says WHICH series or category something is (the fitness chart series in `lib/components/fitness/palette.ts`) lives in a named palette module, one per domain, that the guard lists by path with a reason.
- **Translucent chrome uses `bg-surface-chrome`** (`--surface-chrome`: white at 72 % light, #141414 at 80 % dark) with `backdrop-blur`, never `bg-background/NN`: the sticky page header, the sidebar, the icon rail, the mobile compact bar, and the sticky bars of the public shell (`PublicTopBar`), the logged-out landing page's public-feed header, the shared heatmap page, the status page header and the gallery's stuck day headers (frosted only while pinned, through `data-[stuck]:bg-surface-chrome`). `lib/components/surfaceChromeUsage.test.ts` lists the bars.
- **A status or label pill is the shared `Badge`**, never a hand-copied `rounded-full bg-… px-2 py-0.5` span (the shared `Badge`'s `px-2.5` is 4 px wider across and it carries the design's dark tints). Its six tones: `gray` (the default; `#383838` fill and `#C2C2C2` label in dark, which the connected-app scope chips share), `primary` and `destructive` (the text token for the label and a lighter hue at 16 % for the dark fill, `#FA802E` / `#DF3A3A`), and `success`, `warning` and `info`, which are a `bg-<tone>/10` (light) or `/25` (dark) tint of the status colour behind its `-text` token, which clears AA on it in both themes (`Alert` does not use these tints; it has its own opaque `-surface` tokens). There is no `blue` tone; a "Sign-in" or other neutral-informational label is `info`. Do not hand-roll badge colours with fixed `hsl()` values — a pill that has no `dark:` variant renders as a light chip on the dark surface. Today's consumers: the Admin pill on the accounts list and detail, the report's Open / Resolved, the moderation panel's state labels, the passkey domain pill, the account's Verified mark, a filter's Expired pill and the admin relay states. A pill that is not a tone — the 10–11 px file-type and position tags, the filter context chips — stays its own element.
- **Palette tokens beyond the shadcn set** (the values live in `app/globals.css` and are guarded by `app/globals.contrast.test.ts`): `--control-off` (`bg-control-off`, the Switch track when off: #CCCCCC light, #545454 dark), `--surface-accent` (`bg-surface-accent`, the pale orange tile behind an accent icon: #FFF6F0 light, #271A11 dark; a selected tile keeps `bg-primary/20`), the four opaque tinted fills of `Alert` (`--destructive-surface`, `--success-surface`, `--warning-surface`, `--info-surface`), and the dark brand backdrop on `body` (#492812 top-left and #193543 top-right at 60 %).
- **Failures.** A request that fails is an `Alert` (error tone, `title` says what failed, `onRetry` where the action can be repeated, set above the box it belongs to, never inside it; the exceptions are an `AuthCard` and the Messages chat panes, which are themselves the page's surface), never a bare `text-sm text-destructive` line: in a page, a dialog or under a button alike. A message standing in a post that is rendered with it (a failed fitness import) passes `live={false}`; the failure of an action the reader just took announces itself. Field validation under one input is its own state (`fieldError`, never the form's request `error`) and stays a small inline `text-xs text-destructive-text` line with an `id` that the input names in `aria-describedby` (plus `aria-invalid`); a validation failure moves focus to the invalid input (the first one when several) so its described error is read; a rule about a group with no single input (an album needs a photo) is the same line with `role="alert"`. Text in the error colour names `text-destructive-text` (the `text-destructive` utility is aliased to it in `globals.css`, but `bg-destructive` is the fill and does not clear contrast as text). A row detail inside a list or table (a failed import's error in its row) is plain text in that row; a standing error read at load (Wahoo's last provider error) is an `Alert` with `live={false}`. A failure that surfaces only as an announcement from the page's own live region (an upload that failed in the composer) is spoken once, by that region, not by a second `role="alert"` on the tile. PostBox's failure to send or update is an `Alert` ("Couldn't send." / "Couldn't update.", with Retry, and "Your post is saved as a draft." when the draft saved) drawn after the composer card, as the design shows it: the home composer passes `frameClassName` so PostBox draws the card itself and the Alert follows it, never inside it; a locked create (the server kept the post) shows only the lock line. The exception is the composer's `warningMsg` line, which carries only rejected files and the reply box's request failures, as one inline `role="alert"` line.
- **Lists.** Every list, post lists included, is one frame with dividers (Home and the Fitness recent activities), never separate cards. The one exception is an admin account's actors: each is its own `Frame` (summary and moderation actions) with its moderation status `Alert` above it, `space-y-6` apart, because each actor carries its own status.
  - Exception: the profile fields on the profile page are an unframed inline line under the bio (like the software line), not a framed list.
- **Post lists.** Every list of posts (Home, Bookmarks, Favorites, hashtags, a list, the profile tabs, a status's replies, Explore and Search posts, the admin hashtag page, the logged-out landing feed) is `Posts` (or `TimelineFeed`) framed with `POST_LIST_FRAME_CLASS` (`rounded-lg border bg-background`, no shadow, `divide-y` rows) from `lib/components/posts/feedLayout.ts`; below `md` `MOBILE_FEED_SURFACE_CLASS` makes it full-bleed. A feed that can be empty shows an `EmptyState` with the page's icon (and an action where one is obvious: "Find people to follow" on Home, "Add people" on a list), a failed load is an `Alert` with Retry where the feed can refetch, and its `loading.tsx` draws `PostListSkeleton` (the frame with avatar-and-bars rows) under one `<span role="status" className="sr-only">` naming the wait (an `aria-label` on a plain `div` is not announced). Tabs on these pages are `SegmentedControl` (in-page state on Explore, Search and the profile, which switch panels without a route change).
- **Forms.** One form is one box: a form whose fields save together sits in ONE `Frame form` of `FormRow`s (and `FormGroup`s when it spans several former sections; `stickyFooter` on a long one), with no rules between fields, only spacing, and one rule above the action: the `SaveBar` footer, an auth card's action band, or a form dialog's `DialogFooter separated` (`-mx-6 -mb-6 border-t px-6 py-4`, edge to edge of the dialog, 16px under the content from the dialog's own gap; not used in yes/no confirmations, which have no fields). Controls that save as they change use `Frame form` with no footer and a `SavedIndicator`. Lists keep their dividers (`Frame divided`, `FramedList`, `TableFrame`, `DetailList`). A single-item add box is an `AddBar`, not a `Frame form` with a `SaveBar`; choice cards are `RadioCard`. Stacked on a phone. Field validation keeps its small red line; a page-level error is an `Alert`.
- **Native form controls are the shared primitives, never raw HTML.** A native `<select>` is the shared `Select` (`@/lib/components/ui/select`): 36 px, the design's 3 px focus ring, `shadow-xs`, the OS arrow hidden and the muted chevron painted in its place; a call site that needs a different width passes it as a `className` (`w-auto` for a select that shares a row with other controls), and the chevron class is private to the primitive, so there is no raw `<select>` to append it to. A checkbox is the shared `Checkbox` (`@/lib/components/ui/checkbox`): 16 px, radius 4, an orange fill and a white tick when checked, instead of the browser's blue control; it is still a real `<input type="checkbox">`, so a label that wraps it or points at it with `htmlFor` toggles it and a form posts it as before. `lib/components/ui/formControlUsage.test.ts` fails on a raw `<select>` or `<input type="checkbox">` outside the primitives; the fitness activity page's recording switcher is a menu, not a select (see **Several recordings of one activity** in [Fitness file storage](fitness-file-storage.md)).
- **The shared `Dialog`** is 440 px wide by default (a dialog that needs more sets its own `sm:max-w-*`, as the gear forms do at `sm:max-w-lg`), has a 16 px radius, and sits on `bg-card` in dark mode (`bg-background` in light) so it reads lighter than the dimmed page. The light `outline` Button is filled with `bg-card` (#FAFAFA); dark stays the translucent `bg-input/30`, except the scroll-to-top pill (`bg-popover`), the timeline refresh button (`bg-card`) and the announcements icon button beside it (`bg-card`), which are solid `#171717` with the `--border` hairline in dark. The `pill` Button variant likewise stays translucent except the floating pill that sits over posts ("N new posts"), which is solid `bg-popover` with `shadow-lg` in both themes so post text never shows through it; its up arrow is `text-muted-foreground`, not `primary`.
- **Dropdown menu rows** highlight with `--accent` in light and `--muted` (#2B2B2B) in dark, and a radio item's indicator is a 6 px dot. A row that paints its own `focus:` wash (the current row of `SectionNavDropdown` / `SectionNavSelect`, the visibility selector, the Strava gear menu) repeats it as `dark:focus:`: the shared item's `dark:focus:bg-muted` survives tailwind-merge unless the row names its own `dark:focus:` background, so the hovered row would turn grey in dark. Loading placeholders use the shared `.skeleton` utility rather than `bg-muted`, which sits almost on the card and is near-invisible.
- **Full-height layouts use the dynamic viewport unit `min-h-dvh`** (not `min-h-screen` / `100vh`), so mobile browser toolbars don't break centering.
- **Settings and Account.** Every Settings and Account page (`/settings/*`, `/account/*`, verify-email included) is built from the kit: one `PageHeader` h1 (the section layouts render a child title as h2), `Section`s of `Frame form` + `FormRow` (Settings uses `SectionLayout`: `/settings` is the index with a profile card and `SectionIndex` below it; focused pages like Appearance at `/settings/appearance` and Privacy at `/settings/privacy` use `Frame form` with `NativeFormSaveBar` and `returnTo`; the Edit profile page (`/settings/profile`) is one `Section` per box, each a `Frame form`, with a page-wide sticky `SaveBar` (`dirtyLabel="You have unsaved changes"`, Cancel in `actions`); Preferences' Posting & reading and Sidebar likewise; Account & security uses `SectionLayout` as well: `/account` is the index with `AccountIdentityCard` and `SectionIndex` listing Email & name, Password & sign-in, Sessions & apps, Profiles, and Import and export, and `/account?error=` redirects to `/account/email?error=`; `/account/email` handles Email & name with email, account name, account photo, and image upload 303s to `/account/email[?error=]`; `/account/security` handles Password & sign-in; `/account/sessions` handles Sessions & apps with active sessions, connected apps and the "Sign out" button; `/account/profiles` lists account profiles via `ActorsSection`; `/account/import-export` handles the archive export, the CSV exports and imports), a `SaveBar` footer for forms (`NativeFormSaveBar` for native-POST profile forms), a `Frame divided` only for lists, `FramedList` / `TableFrame` lists with `EmptyState`s, `Alert`s for errors and a danger-zone `Alert` card for destructive actions (Delete this profile at `/settings/delete`). Each route has a `loading.tsx` drawn with `SectionSkeleton`.
- **Admin.** Every Admin page (`/admin/*`) is built from the kit the same way: the Dashboard (`/admin/overview`) is a `SegmentedControl` time range over two `StatStrip`s whose selectable cells choose the chart; list pages (accounts, hashtags, reports, dead-lettered jobs) are `TableFrame`s with an `EmptyState` and the shared `Pagination` (`lib/components/admin/`); below `sm` a table keeps only its primary column and folds the rest into a muted second line (`lib/components/admin/adminTable.ts`), so no value or row action is left behind a sideways scroll, detail pages put a `DetailList` (label and value rows in one `Frame`) under a `Section` (an account's actors are one `Frame` each, summary and moderation actions, with the moderation status `Alert` above it; see **Lists**), and sort or status choices that navigate are `SegmentedControl asLinks`. Server settings forms are `Section` + `Frame form` + `SettingsField` (a `FormRow` that also shows the "Set by environment" lock) with a `SaveBar`; relays, federation, rules, announcements, filters and custom emoji are framed lists (`FramedList`, or `Frame divided` rows) next to an `AddBar` for a single-field add (relay inbox, rule, domain allow) or a `Frame form` with a `SaveBar variant="create"` footer for a multi-field one (domain block, announcement, custom emoji). A status carried in the URL (`?status=`) or a request failure is an `Alert` (with Retry for a load); a state label is a `Badge` with a tone (`success`, `warning`, `info`, `destructive`, `primary`, `gray`), never a hand-coloured pill. Each `/admin/*` route but `/admin` itself has a `loading.tsx` — `SectionSkeleton` everywhere except the Dashboard's own shape at `/admin/overview` — and the index deliberately has none, because its page renders nothing and a streamed loading boundary would turn the non-admin `redirect()` into a 200 with a skeleton (see Loading below) — and the admin page icons live in `lib/components/admin/adminIcons.ts` so the menu and the page share them.
  **Admin › Server filters** narrows the loaded list by action, any selected context, and expiry status, using dropdown chips on wider screens and a Filters sheet on phones; account Settings › Filters keeps its existing controls and list.
- **Notifications, Messages and Lists.** The timeline-side pages that are not post feeds use the kit too, keeping their `PageHeader` h1 (they are top-level routes, not section layouts). Notifications is the All / Mentions `SegmentedControl asLinks` in the header's sub-navigation slot, `MarkAllReadButton` in the header `actions` and `PageRefreshButton` in `mobileBarActions` (placing Refresh in the mobile compact bar below `md` and at the trailing end of the header actions row from `md` up, while Mark all read stays in the content row on mobile), one `Frame divided` of rows (the unread row keeps its primary left rule and tint), an `EmptyState` per filter (Mentions offers "Show all notifications") and, when marking rows read fails, an `Alert` with Retry that sends the still-pending ids again; the type badges are the `info`, `success`, `warning`, `destructive` and `primary` tokens. Messages is one flat two-pane `Frame` (the message bubbles keep their `rounded-2xl` tail shape on purpose): the conversation list is `ul` rows (`FramedListItem`) inside it with an unread dot plus a screen-reader "Unread", an `EmptyState` with a New message action when there are none, `MessageThreadSkeleton` instead of a spinner while a thread loads, the recipient results a `FramedList`, and an `Alert` for every failure, with Retry where the request can be repeated (thread, older messages, more conversations, mark read, recipient search, hide); these sit inside the panes, the one place an `Alert` lives inside a `Frame` besides an `AuthCard`. Lists is a `Section` of `FramedList` rows with an `EmptyState` carrying the create action. The list editors are a "Details" `Section` of `Frame form` + `FormRow`s with a `SaveBar` (Save stays off until a setting changes; new items are always dirty; Cancel is the bar's `actions`), a "Members" / "People" `Section` whose rows are a `FramedList` and whose empty state is an `EmptyState` (members save as they change, so they never make the form dirty), a "Danger zone" `Alert` card for delete, and an `Alert` beside whatever failed. Each of these routes has a `loading.tsx` drawn from the kit's skeletons (`EditorLoading` for the two editors).
- **Auth pages.** The standalone pages under `app/(nosidebar)/` (`auth/signin|signup|forgot-password|reset-password|two-factor|select-actor|confirmation|error`, `authorize_interaction`, `oauth/authorize`) keep their deliberate centred single column (the layout caps it at 28rem) and are not the section chrome. Each page is an `AuthCard` (`app/(nosidebar)/AuthCard.tsx`): the kit `Frame` look (`rounded-lg border bg-background`, no shadow) as the form's one box: the logo (`getAuthLogoSrc`, an absolute URL on the configured host, or root-relative in `next dev`; see `getBrandAssetSrc`), the page's one `text-xl` sentence-case h1 and a muted description in the header, then `AuthCardBody` (a `px-6 pt-6 pb-6 space-y-4` column of `FormRow stacked className="p-0"` fields, labels above controls, no inner `Frame`) and `AuthCardActions` (the card's one top border, `px-6 py-5`: the full-width primary submit button, a secondary action such as the passkey button, and the "Don't have an account? Sign up" line). A form page wraps both in its `<form>` so submit stays inside it (sign-in passes the passkey button and sign-up line to `CredentialForm` as `actions`; forgot- and reset-password take a `footer`); the card's `footer` prop is for a page with no form (today only `auth/error`; confirmation renders its own `AuthCardActions`, select-actor has none) and renders in an `AuthCardActions` band. The band keeps normal text colour and alignment (an `Alert` in it reads as everywhere else; only `AuthCardFooter` is centred and muted) and hides itself while empty. The OAuth consent card has no inner `Frame`: "Authorize as" is a stacked `FormRow` with a select-height actor trigger (avatar inside) and the permissions are plain checkbox rows. A missing or invalid field is the inline field-error line under its input (see Failures and Forms), never the page-level `Alert`; every request failure or confirmation is an `Alert` (`error` for a failed sign-in, passkey or code, `success` for a sent reset link or a reset password, `info` for the "passkeys aren't available" notice), and the confirmation page's verified or invalid result is an `Alert` with `live={false}` because it is page content at load, not the result of an action. `auth/error` is the failure page itself: the card's title, description and a single link in `footer`. A two-factor method switch is a `SegmentedControl`. `ui/card.tsx` is gone: nothing uses a shadowed `Card`, so a new surface starts from `Frame`.
- **Loading.** Skeleton bars in the final layout's shape under one polite `role="status"` with an `sr-only` label, never "Loading..." text. Every route that reads on the server has a `loading.tsx` (Settings, Account, Admin, Fitness, Gallery and Albums, Lists and every timeline route), drawn in the page's loaded geometry so nothing jumps at 390 or 1280px: a section page is `ScreenSkeleton` (or `SectionSkeleton` with the real section and row counts) under the layout's own header and dropdown, a feed is `PostFeedLoading` / `PostListSkeleton`, and a photo grid is `GalleryGridSkeleton` (`captions` where the loaded tile prints one). A page whose client view already has its own first-load skeleton (the gear lists, a gear's page, the Fitness overview) reuses that export, so the route's skeleton and the view's are the same shape. The one exception in the tree is `/admin` itself, the Admin index: it deliberately has no `loading.tsx`, because its page renders nothing and a streamed loading boundary would turn the non-admin `redirect()` into a 200 with a skeleton — the same reason the redirecting pages below have none. A screen announces its wait once: exactly one `role="status"`, never a second one from a nested skeleton. Pages that a signed-out visitor, a crawler or another server opens directly and that redirect or 404 (the auth pages, OAuth, the shared heatmap and its embed, the terms of service and privacy policy pages, which 404 while their document is unset) have no `loading.tsx`, because a streamed loading boundary turns `redirect()` / `notFound()` into a 200; signed-in section pages accept that trade. A spinner (`Loader2`) is for inside a pending button only: a map that has not drawn yet is `MapLoadingOverlay` (`lib/components/map/`, a shimmer block over the map with one "Loading map" status), an attachment that is uploading gets a shimmer over its thumbnail, and a task that is queued or generating shows a static `Hourglass`. A pending button's label is a present participle and an ellipsis character (`Saving…`, `Posting…`, never three dots); the label may also say what it is doing (`Loading more…`).
- **Guard.** `lib/components/surface/surfaceKitUsage.test.ts` counts `rounded-2xl` + `shadow-sm` panels, raw palette colour utilities (every Tailwind palette family with a shade, on any colour utility) and "Loading…" text in the `.tsx` and `.ts` files under `app/` and `lib/` (tests, `.d.ts` and the kit excluded) with comments stripped first, and **fails when any of the three is not zero**: a new copy is a regression, not something to baseline. It also counts an arbitrary hex (`bg-[#ff0000]`) and the palette variable (`text-(--color-red-500)`, `text-[var(--color-red-500)]`), and covers every family Tailwind ships, `mauve`, `olive`, `mist` and `taupe` included. The only skipped files are the fixed-colour files listed in that test, each by path with a one-line reason: `DATA_PALETTE_FILES` (today `lib/components/fitness/palette.ts`, the chart series colours, and `lib/components/photo-editor/histogramPalette.ts`, the photo editor histogram's channel colours and dark frame) and `DESIGN_HEX_FILES` (the two badge files that carry the design's hex fills; only the arbitrary hex is skipped there, a palette utility in them still counts); the test also fails if a listed file is missing or no longer holds a raw colour (for the badge files, a hex), so the list cannot go stale. Do not add a file for a colour that means success, warning, info or an error: use `Alert`, `Badge` or the tokens. `surfaceChromeUsage.test.ts` separately guards the translucent chrome bars. `alertOutsideFrame.test.ts` separately fails on an `<Alert` (or `ActorInfoBanner`, whose root is one) nested in a `Frame`, `FramedList` or `AddBar` in the same file (only `MessagesPage.tsx` is allowed); it cannot see an Alert passed in from another component.

### Accessibility

Contrast and screen-reader rules that hold across `app/` and `lib/`. The orange-text core rule lives under **Fitness Gear** in [Fitness file storage](fitness-file-storage.md), which points here for the exceptions.

- **Orange text uses `text-primary-text`, not `text-primary`** (see **Fitness Gear** in [Fitness file storage](fitness-file-storage.md) for the contrast rationale). The rule reaches every orange text node in `app/` and `lib/`: the `link` Button variant, the `primary` Badge tone, active nav labels, chips, "Hide replies"-style toggles, the highlighted stat value and text-bearing tiles (a rule number, a count) all use `text-primary-text` (and its `hover:`, `focus:` and `data-[state=…]:` variants). Icons, fills, borders and rings keep `primary`, so when one element colours both an icon and a label, put `text-primary-text` on the element and `text-primary` on the icon (the sidebar's active rows do this). Two things stay `text-primary` on purpose: icon-only controls (a toggle button holding just an icon or glyph, the collapsed rail) and the large display numeral on the 404/500 card, which the design draws in the brand orange. `app/globals.contrast.test.ts` guards the token values in `globals.css`, not whether a component used `text-primary-text` vs `text-primary`.
- **Destructive text and link labels use `text-destructive-text`** (the `text-destructive` utility maps to it; `bg-destructive` is the fill — see **Failures** under Surfaces). Variant modifiers such as `hover:text-destructive-text` and `focus:text-destructive-text` must use the `-text` suffix explicitly, as Tailwind v4 variant compilation targets theme tokens. Light `--destructive` (#EF4444) is for fills only — 3.76:1 as a foreground, never a text colour; light `--destructive-text` is #B7282E (6.26:1 on white). Dark `--destructive` (#7F1D1D) is tuned to preserve 9:1 white-on-destructive contrast for `bg-destructive` button and badge backgrounds but only reaches ~1.8:1 on dark surfaces, so dark mode lightens `--destructive-text` to #F87171 to meet WCAG 2.1 AA (4.5:1) on every dark surface. `app/globals.contrast.test.ts` guards the token.
- **The count beside a liked heart uses `text-like-text`** (`--like-text`: #B7282E light, #F87171 dark — the design's "Like Text", equal to the destructive text values but named separately so the like button never reads as a destructive action). The heart icon itself (the like button's and the "N likes" heart under a post) is `text-like-icon` (`--like-icon`, #FB2C36, the same in both themes).
- **The other post action icons have tokens of their own** rather than borrowing a status tone: `text-bookmark-icon` (bookmarked, and the hover on an unbookmarked post; amber-500), `text-repost-icon` (reposted or hovering; green-500) and `text-reply-icon` (hovering reply; blue-500), the same in both themes. A bookmark is not a warning and a repost is not a success, and the darker `-text` shades would blur "on" and "off".
- **The unread-count pill (`NotificationBadge`) is filled `#B7282E` in light** — the design's count-badge red, darker than the `#EF4444` `--destructive` token that white text only reaches 3.8:1 on — and `--destructive` (`#7F1D1D`) in dark.
- **When pairing a visible count with `sr-only` text, put only the noun (e.g. "boosts") in the `sr-only` span, not the number** — the visible digit is already announced, so including it double-reads (see `posts/read-only-stats.tsx`).
- **One `<main>` landmark per page**: don't render `<main>` in a `page.tsx` when an ancestor layout already provides one.

### Photo Editor (Client)

The editor is `lib/components/photo-editor/`, opened from `PhotoEditPreview` (the pill over the image in the media details dialog) as a full-screen dialog loaded with `next/dynamic`, so the engine ships only when someone edits. The server contract is wrapped by `lib/client/mediaEdit.ts` (`getMediaEdit`, `saveMediaEdit`, `revertMediaEdit`, typed `MediaEditError`). Photo editing uses client-side Look Presets instead of a remote enhance endpoint, applying curated adjustments across light, colour, and detail directly in the browser.

- **Engine** (`engine/`): geometry (crop, rotate, flip, straighten) is drawn with Canvas2D from `getGeometryTransform`; colour adjustments run in a WebGL2 shader that mirrors the CPU reference `applyAdjustments` (`adjustments.ts`, shared constants in `colour.ts`). Shadows, highlights, texture and clarity read low-resolution blurred copies of the image. Export renders in tiles with an 8 px halo (`tiles.ts`) and encodes JPEG at quality 0.95. WebGL is not available in jsdom, so tests cover the CPU reference and mock the GL layer; change the shader and the CPU reference together.
- **Editing state** is a recipe (the server's `normalizeRecipe` shape) plus `useEditorHistory` (past/present/future, 100 entries, slider drags and 500 ms of keyboard nudges coalesce into one step).
- **Saving** sends a fresh `save_id` per click and retries a network failure once with the same id; a 409 whose `edit.saveId` is ours counts as success. The "Update the post / Gallery only" choice appears when the photo is attached to statuses. A neutral recipe on an edited photo saves as a revert.
- **Masks** (`masks/`, the third tab, Adjust · Crop · Masks): up to four masks (subject, background, brush), each with its own adjustments (the global set without vignette) and a feather. Pixels live in source space at a long edge of at most 1024 (`maskRaster.ts`, carried through undo/redo on a Symbol key of the recipe object, so `snapshotsEqual` compares them by identity). The renderer takes one packed RGBA mask frame (channel i = mask i), each plane drawn through the recipe's geometry with the photo's own matrix (`maskFrame.ts`); the shader and `applyAdjustments` blend `mix(out, adjust(out, mask), m)` per mask after the global pass, feathered in GL by `feather/100 × 0.02 × long edge`. Select subject runs SlimSAM (`sam.worker.ts`, onnxruntime-web WASM in a module worker; `samPre.ts`/`samPost.ts` are the pure steps) with the model files that `capabilities.subjectModel` names: `modelCache.ts` downloads them once, checks size and sha256, keeps them in Cache Storage and drives the progress bar; a null `subjectModel` hides Select subject while the brush keeps working (a stored subject is then refined with the brush too). Closing the editor aborts the download and ends the worker at whatever step it is on (`useMasks.ts` checks a disposed flag after every await); `modelCache.ts` stops reading a body that passes the pinned size. A saved mask whose image cannot be read is left out of the edit with a notice (`loadMasks.ts` reports it, the owner can still adjust or revert), and a mask with no adjustment is not a render change on the client or the server (`getEffectiveMaskIds`). The onnxruntime WebAssembly is bundled by Next (`_next/static/media`, loaded by the module worker from this origin), so no `wasmPaths` override or `public/` copy is needed. The photo's focus point is the first positive point (`focusPoint.ts`); taps add green + / red − points and re-run the decoder. A save uploads a greyscale `mask_<id>` PNG (`pngCodec.ts`) only for a mask that is new or whose pixels changed; background masks have none; a mask with no adjustments is a neutral recipe. Change `shaders.ts`, `adjustments.ts` and `maskUniforms.ts` together.
- **Slider** (`lib/components/ui/slider.tsx`) wraps `@radix-ui/react-slider`; `bipolar` draws the fill from the centre, double-click or Delete resets. The stage colour is the `--photo-stage` token.

<a id="agents-settings-forms-client-components"></a>

### Settings Forms (Client Components)

- Settings forms that update user data (name, email, password, etc.) **must be client components** that submit JSON to the API — not plain HTML `<form method="post">` with server-side redirects (this breaks error feedback and can cause redirect bugs (307 re-POSTs instead of 303 GET)).
- Client component forms should:
  - Call a named function exported from `lib/client.ts` (which encapsulates the `fetch` call, method, headers, and body serialization), per the Client-Side API Calls section — do **not** call `fetch()` directly in the component
  - Show inline success and error messages (not raw error pages)
  - Manage loading state with `useState`
- Components should not call `fetch()` directly — they go through `lib/client.ts`, and the `agents/no-component-fetch` allowFiles list in `.oxlintrc.json` is empty and must stay empty; the lint rule blocks any new offender.
- The corresponding API route should return JSON via `apiResponse()`, not `Response.redirect()`.
- `GalleryPrivacySettings` (`/gallery/privacy`) follows this, lays itself out with the surface kit (a `Section` per group, `Frame form` of `FormRow`s with an inline switch or a select, and `GallerySettingsStatus` drawing load and save failures as `Alert`s and the saved state as a `SavedIndicator`), and auto-saves each switch and select on its own through `gallerySettingsForm.tsx` (`lib/components/settings/`), the load and per-key save logic it shares with `MediaDetailsSettings`. Hidden locations save through `PrivacyLocationsEditor` (`lib/components/privacy-locations/`), which `FitnessPrivacyLocationSettings` also wraps; a second consumer passes its own `mapIdPrefix` so the GL source and layer ids stay distinct. "Hide the place for threatened species" (`hideThreatenedPlaces`, default on) sits under the default precision as one more auto-saving switch; when `speciesLookupsAvailable` is false it carries a `ToggleRow` `notice` saying the server cannot check IUCN status, so places of photos with a species name stay hidden while it is on. `MediaDetailsSettings` (Settings → Media) is where the subject suggestion mode and confidence threshold are set.

<a id="agents-transactional-notification-emails"></a>
<a id="review-emails"></a>

### Transactional & Notification Emails

Every email the server sends goes through one shared skeleton, so a design or
copy change lands in one place. All active templates are on it; there is no
legacy shape left to copy.

- **One module per email** in `lib/services/email/templates/`, exporting a single
  `build<Name>Email(params): RenderedEmail` (`{ subject, text, html }`). **Never
  inline a subject or an HTML/text body at a call site.** The caller supplies
  `from`/`to` and spreads the result into `sendMail`.
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
- **An email carries the name of the domain it is for.** Every builder takes an optional `brand: { name, domain }` (`lib/services/email/brand.ts`) that `renderEmail` turns into the wordmark (`brand.name`, escaped; without a brand the literal "Activities", because `renderEmail` is synchronous and the server name is an async setting), the header host, and every link and copy line (`brandBaseURL(brand)`, `brandHost(brand)`) — the header logo is the one exception, see below. The brand is a `resolveDomainIdentity` result (`lib/services/email/sender.ts`: `resolveEmailIdentity(database, host)`, `resolveActorEmailBrand(database, actor)`): the visited domain for the password reset (`headerHost` of the request), the account's served domain (`getServedLinkDomain`) for the confirmation, email-change, actor-deleted and notification emails, so callers resolve it where they are already async (`lib/actions/*`, the fitness and delete jobs) and pass it in. `getEmailSender(identity)` picks the From: the primary keeps `ACTIVITIES_EMAIL_FROM` exactly as set, any served secondary domain (source `env` or `database`; a wildcard preview host is the primary) sends `{ name: getDomainDisplayName(identity), email: <bare address of ACTIVITIES_EMAIL_FROM> }` so one verified mailbox serves every domain. `sendNotificationAlerts` looks up the recipient actor's domain for it. `getAddressFromEmail` (`lib/services/email/address.ts`) normalises a display name once for every provider (`"` and `\` removed; CR, LF, other control characters and U+2028/U+2029 become spaces; whitespace collapsed), because domain names are admin text and must not inject headers. SES alone passes `encodeName: true`, which writes a non-ASCII name as RFC 2047 `=?UTF-8?B?…?=` words (each at most 75 characters), since its `Source` must be 7-bit ASCII; nodemailer encodes names itself and would quote an encoded-word, so SMTP gets the raw name.
- **Every `href`/`src` is absolute and built from `brandBaseURL(brand)`, except the quoted-actor avatar (see below) and the header logo.**
  That is `buildBaseURL` of the brand's domain, and `getBaseURL()` when no brand is passed or the brand
  is the primary (`toEmailBrand` leaves the primary's `domain` empty, so a configured host that
  carries a scheme keeps the link it always had). A
  root-relative URL is unresolvable in a mail client (note `convertMarkdownText`
  emits `/tags/x` for hashtags), and a hardcoded `https://${config.host}` is
  wrong under `ACTIVITIES_INSECURE_AUTH=true`. URLs are protocol-checked to
  http/https/mailto; anything else degrades to plain text rather than shipping a
  dead or dangerous link, since remote actors control `status.url`. The header
  logo, though, always comes from the configured host (`new URL('/logo-nav.png', getBaseURL())`, the same reasoning as `getBrandAssetSrc` for the web UI): an
  alias domain may redirect elsewhere and not serve the `public/` assets, while the primary host serves the image. Links, the header host text and the
  wordmark keep using the brand domain. The brand's
  domain is the account's own domain: every builder takes it through `brand`, and
  the confirmation and email-change links (`buildVerifyEmail`, `buildChangeEmail`)
  also take an optional `domain` for their verify link. Registration's first confirmation email
  passes the domain sign-up created the first actor on (the domain the visitor
  signed up on, see Served Domains below), so it links back there. A resend (`POST /api/v1/emails/confirmations`) and an email
  change (`POST /api/v1/accounts/email`) pass the selected actor's domain, and
  the link uses it when auth trusts that host. The caller gets that domain from
  `getServedLinkDomain` (`lib/services/domains/localDomains.ts`), which returns
  it only when `isOwnInstanceHost` accepts it — the primary host, an
  `ACTIVITIES_TRUSTED_HOSTS` entry (wildcards included) or an active
  Admin › Served domains row, the same set
  better-auth's trusted origins and `selectHeaderHost` use — and null (the
  primary host) otherwise, never for a `federation.allowActorDomains` entry
  alone, which can name a remote server. A template never takes a domain
  straight from a stored row.
- **The plain-text alternative is derived from the same block list**, never
  hand-written beside the HTML.
- **A local `vi.mock('@/lib/config', …)` in a test MUST include `getBaseURL`
  and `buildBaseURL`, for every email builder (each link goes through
  `brandBaseURL`, which calls `buildBaseURL` for a branded email).** It shadows the global mock from `test/setup/vitest.setup.ts`, and because most email call
  sites deliberately catch delivery errors, omitting it does **not** fail loudly:
  the template throws, the catch swallows it, and the test keeps passing while
  the email silently stops sending.
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
- **The quote's author row is one fixed-layout table with the name and handle in
  one cell.** The inset table and the row's table both carry
  `width:100%;table-layout:fixed`, because an auto-layout table never shrinks
  below its min-content width: with the display name and the handle in one cell
  each (the name `white-space:nowrap`, the handle an unbreakable
  `@user@domain` token), the row ran ~10px past the white card's right edge on a
  narrow screen (~390pt in iPhone Apple Mail). The single cell wraps
  (`word-wrap:break-word;overflow-wrap:anywhere;word-break:break-word`), the
  handle drops under the name only when the two do not fit on the row, and an
  over-long handle breaks rather than pushing the card wide. A quoted `<pre>`
  code block gets `white-space:pre-wrap` with the same break properties (its
  line breaks survive; a long code line wraps), and the headline `h1` carries
  `overflow-wrap:anywhere`, for the same reason. The stat card gets the same
  treatment: the outer table and its title, stats and map tables carry
  `width:100%;table-layout:fixed`, the timestamp column is an explicit 126px
  ("28 Sept 2026, 23:59" — en-GB medium, the widest month — measures about
  118px at 12px in WebKit with the system font, plus ~8px slack) with no
  `white-space:nowrap`, and the title and footnote carry the break properties.
  The header table is auto-layout: a normal wordmark and host keep their
  natural widths, so the 20px wordmark stays on one line even at a 320px
  viewport — it must never wrap mid-word — and
  only the host cell carries the break properties —
  `overflow-wrap:anywhere` lowers its min-content width, so a very long
  custom host can still make the header shrink instead of overflowing. The
  wordmark cell keeps only `word-wrap:break-word`: `overflow-wrap:anywhere`
  there would lower the wordmark's own min-content width too, and a long host
  at a 320px viewport would break the wordmark mid-word.
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
  Outlook's Word engine is the one that needs the `mso-` properties
  (`mso-padding-alt` on both the button cell and its anchor, `mso-hide:all`) and
  the MSO ghost table pinning the column to 600px, all load-bearing and
  invisible in a browser. Don't drop them as dead style.

<a id="agents-link-preview-cards"></a>
<a id="review-link-preview-cards"></a>

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
  blanks the card for **every** post linking that page (`getStatusLinkPreviews`
  filters on `completed`), and the negative cache then suppresses the retry
  that would repair it. A row that is already `completed` therefore keeps its
  content AND its status and records only the error; the refresh is deferred to
  the next window rather than retried against a host that just failed.
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
  **The shape of the function is the fix for four distinct failure modes.** Do
  not simplify it back toward
  `tags.reduce((t, tag) => t.replaceAll(tag.name, '<img …>'), text)`.
  1. It searches for a shortcode-shaped TOKEN and then looks the name up, rather
     than using the stored name as the search string. A name shaped like
     `<a href="…">` matches the post's own anchor and consumes it; escaping the
     output can never fix a bad search term.
  2. It is a SINGLE pass over the original text. Every replacement writes an
     `alt=":shortcode:"` of its own, so feeding each result into the next lets
     one tag match another's output and nest markup inside an attribute.
  3. It substitutes only in TEXT pieces, never inside tags. A `:` survives
     sanitization in an href, so blind substitution rewrites the very link a
     preview card was for — the reader gets a corrupted url while the card names
     the original. This one needs no hostile input: an ordinary custom emoji
     plus any link with a `:word:` path segment does it.
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
  to know what the reader sees, and a subset of the pipeline is not enough:
  walking marked's tokens misses hidden ancestors and entity-only link text;
  sanitizing but skipping the emoji step MEASURES TEXT THE RENDERER THEN
  DELETES (`sanitizeTrustedStatusText` serves emoji images over https only and
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
  document order. Reject all three ways of getting this wrong:
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
  case, and put new cases in `parserAgreement.test.ts`, which checks the
  extractor against a jsdom DOM rather than against hand-written expectations.
  Anchors that are mentions or hashtags are rejected by the markers the
  renderer itself emits (`rel="tag"` and the `mention`/`hashtag`/`u-url`
  classes).
  Do not "simplify" the local path back to walking marked's token tree: the
  tokens are the wrong shape for this job three times
  over — marked flattens raw inline HTML into flat SIBLING tokens, so a link
  inside `<span class="hidden">…</span>` has no ancestor to inherit hidden-ness
  from and beat the visible link below it; link text written as an entity
  (`[&#8203;](url)`) reads as non-empty in source while rendering to nothing;
  and a table cell carries its own `header` BOOLEAN, which crashes the walker
  and silently turns every post containing a table into "no links". Rendering
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
  only origin in `frame-src` (`default-src 'none'` blocks every iframe), and the poster comes from
  `https://i.ytimg.com`, which is an **unconditional** `img-src` source rather
  than one of `remoteMediaSources`, so narrowing (or emptying)
  `ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS` cannot blank the thumbnail of every
  video card. `test/next.config.csp.test.ts` pins that against the emptied allowlist.
  **Nothing loads from the player until the reader presses play** — a live
  iframe per row is a megabyte of player code and a Google request for every
  video that merely scrolled past — and **the card is mounted under a React
  `key` on the video id**, so a card replaced in place is REMOUNTED and cannot
  inherit the previous video's consent and autoplay something nobody clicked.
  Do not delete that key as redundant: the component also remembers which video
  was played, but that alone is insufficient — a remembered id is only ever
  compared against, never cleared, so it defends a change A→B and not a change
  back A→B→A, which re-enters the playing branch with no gesture. A remount
  clears it in both directions, so there is no painted frame of autoplay.
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
  as an indicator, not invisible.
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
  is not a box-shadow that is painted. Screenshot the WRAPPER, not the focused element, whenever the
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
  locked shut by the environment. It is checked both when scheduling and inside
  the job — a delayed job must not drain after an operator turns it off. It
  gates FETCHING only: the cleanup that drops
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
  still picks its branch from `isLocalActor` — but it does not matter here:
  marked leaves already-rendered HTML untouched, so a poll body run through the
  local branch renders to itself and yields the same URL the remote branch
  would. So this is a one-line change, and the thing to check
  before making it is not the parser but the ordering rule the note actions
  follow — schedule the sync AFTER the poll has published, or on the default
  in-process queue the author waits on a third-party fetch before their poll
  goes anywhere.

<a id="agents-status-delete-unboost-federation"></a>
<a id="review-status-delete-unboost-federation"></a>

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
  onto `loadStatusAndActor`**: after the hard delete there is nothing to load,
  the job bails on `!status`, and no unboost ever federates. Every delivery test in
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
  afterwards — never inline fan-out ahead of the commit, which makes the
  response wait on remote inboxes and lets inbox-resolution errors abandon the
  local deletion (a failing remote server alone is not that risk: the sender
  and `getActorPerson` swallow remote lookup and network failures). A
  post-commit publish failure is logged without reporting the
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
- Known gap: a cascaded reply subtree is deleted
  locally but only the top status's `Delete` federates.

<a id="agents-actor-profile-deletion-federation"></a>

### Actor Profile & Deletion Federation

#### Profile edits federate as `Update(Person)`

- **Every route that writes a published profile field queues
  `publishActorUpdate`** (`lib/services/actors/actorUpdate.ts`), which queues
  `SendUpdateActorJob` sending `Update(Person)`. The routes that do:
  `PATCH /api/v1/accounts/update_credentials`, `PATCH /api/v1/profile`, the
  web settings form `POST /api/v1/accounts/profile`, the profile editor's
  JSON save `PATCH /api/v1/accounts/profile`, and
  `DELETE /api/v1/profile/{avatar,header}`. A new route that writes `name`,
  `summary`, `iconUrl`, `headerImageUrl`, `manuallyApprovesFollowers` or
  `fields` (the profile links) must call it too, or remote servers keep the
  old profile until their own periodic re-fetch.
- **A save sends an Update only when something the federated Person carries
  changed.** The four save routes above (not the avatar and header deletes,
  which always send) save with `updateActorWithPrevious`, which returns the
  actor read under the save's own row lock (`before`) and the saved one
  (`after`), and compares the two with `hasFederatedProfileChange`
  (`lib/services/actors/hasFederatedProfileChange.ts`); a `before` read
  earlier, outside the lock, would let two interleaved saves each compare
  against a row the other already replaced and skip an Update remote servers
  need. A null `before` next to a saved actor cannot happen, since both are
  read in one transaction; the guard publishes as a defensive default. It
  compares the `getPersonFromActor` documents (emoji `updated` stamps aside),
  so the list of federated fields is whatever that document carries: a save
  of the post line limit, the profile tabs, image alt texts or any other
  setting remote servers never see sends no Update(Person), and a save that
  changes the profile sends exactly one.
- **Queueing is best effort and never fails the request** — the profile is
  already saved. The profile link check still queues whenever the links
  changed, whether or not an Update was sent, but only for an actor that was
  saved.
- **`updateActor` writes `name` and `summary` whenever they are not
  `undefined`**, so an empty string clears the display name or bio (profiles
  then show the username); a caller that must not wipe a stored value leaves
  the key out, as remote refresh does (`getPersistableProfile`).
  `PATCH /api/v1/accounts/profile` caps name at 255 and bio at 500 characters
  only when the value differs from the stored one.
- **The activity**: the object is `getPersonFromActor`, the same document the
  actor URL serves, and the audience is follower inboxes plus accepted
  relays, as in Mastodon. The activity id is
  `<actor>#updates/<updatedAt>`, with `updatedAt` carried in the job so a
  retried job resends the same Update.
- **Discovery flags are opt-in on the wire.** `getPersonFromActor` emits
  Mastodon's `discoverable` and `indexable` (declared as `toot:discoverable`
  and `toot:indexable` in `@context`, next to `toot`), read from the actor's
  settings (`update_credentials` `discoverable`/`indexable`). An unset flag
  federates as `false`, as Mastodon's ActorSerializer does (`discoverable ||
false`), so users who never opted in are not advertised to remote servers
  (the local Account entity keeps its own defaults). A non-empty
  `attributionDomains` setting (`update_credentials`
  `attribution_domains`, Mastodon 4.4+) is emitted as `attributionDomains`
  (declared `toot:attributionDomains` with `@type: @id` and
  `@container: @set`, in `@context` and in the inbound canonical context),
  keeping only valid hostnames.

#### Profile tabs and the Edit profile page

- **Profile tab visibility is presentation only.** A local actor's settings
  `showReplies`, `showMedia` (Mastodon's flag, reused for the Media tab),
  `showGallery` and `showFitness` (each shown unless `false`) decide which
  tabs `ActorTimelines` offers, to every viewer including the owner; Posts is
  always offered and a media-only profile whose Media tab is hidden falls
  back to the ordinary tabs, which open on Posts.
  - `getProfileData` skips the attachments, fitness and gallery queries of a
    hidden tab. Nothing else changes: the API, the gallery pages and the
    outbox still serve the same data, and saving the flags never calls
    `publishActorUpdate`.
  - The flags are written with `PATCH /api/v1/accounts/profile`
    (`updateProfile()` in `lib/client`) from the Profile tabs section of the
    Edit profile page.
- **The Edit profile page is `/settings/profile`, the first section of
  Settings.** `app/(timeline)/settings/profile/page.tsx` (server, with its
  `loading.tsx`) builds a `SavedProfile` from the stored actor
  (`database.getActorFromId`, never the session actor, which is partial: no
  tab flags, links or tags) and its settings, and hands it to the client
  `ProfileEditor` (`lib/components/settings/profile/`), which owns the name,
  bio, avatar and header (with their alt texts), the profile fields and the
  four profile tabs.
  - **Saving:** one Save sends only the changed keys as JSON through
    `updateProfile()` (never a form POST); `profileDraft.ts` compares the
    draft with the last saved profile (the `SavedProfile` the PATCH answers
    with, so the page is clean right after a save), builds that patch and
    maps a 422 message (`Invalid <key>`) to its field. A save sends a
    snapshot of the draft: what the person typed while it was in flight
    stays and keeps the page dirty (`reconcileDraft`), and Save waits for a
    picture upload. Enter in a field submits the form (the Save buttons
    are `type=submit` with `form=`), and a failed save moves focus to the
    invalid control or the form's `Alert`. A successful save shows
    `ProfileSavedToast` (in the shape of `GalleryAddedToast`, with the words
    also in an always-mounted polite region that carries the save's number,
    so a second save is announced again) and calls `router.refresh()`. The
    editor's own Cancel question closes when a save leaves the page clean,
    like the guard's.
  - **Photos** are chosen with a file picker and uploaded straight away
    through the composer's media upload (`uploadProfileImage` →
    `uploadAttachment`, the same type check, resize and instance size cap
    `ImageUploadField` uses); only the returned media URL joins the draft,
    and it is saved with the rest.
  - **Featured hashtags keep their own immediate save:**
    `FeaturedTagsSection` (one section with `id="featured-hashtags"`) sits
    outside the page's `<form>` because its add bar is a form of its own,
    and never makes the page dirty. `/settings/featured-hashtags` is a
    server redirect to `/settings/profile#featured-hashtags`.
  - **Switching profiles:** the page sets the `?switched=1` Alert ("Switched
    to @handle. You're now posting as this profile.") above the editor, for
    the button that switches to another profile you own:
    `EditOwnedProfileButton` (`app/(timeline)/[actor]/`) shows "Edit
    profile" on a local profile of the signed-in account that is not the
    active actor (and not pending deletion, found with
    `getActorsForAccount`, read only for such profiles), calls `switchActor`
    and `setActiveOfflineSession` like the actor switcher (the latter's
    failure ignored), and loads `/settings/profile?switched=1` with a full
    navigation; a failed switch shows an `Alert` and stays. The own
    profile's "Edit profile" button links to `/settings/profile`. The
    `?switched=1` notice (`SwitchedNotice`) has a Dismiss and goes after
    the first save.
  - **Unsaved changes:** `useUnsavedChangesGuard` holds back in-app link
    clicks to another path (a capture-phase click listener; the same path
    with another query is not leaving) and the browser's Back and Forward
    (the Navigation API's `navigate` event of a same-document traversal is
    cancelled before the URL or Next's router change, and Discard replays
    it with `traverseTo`; a traversal that only changes the query or hash
    never asks) behind a "Discard changes?" `ConfirmDialog`, and asks the
    browser through `beforeunload`. A browser without the Navigation API
    has only `beforeunload`, and Chromium lets a page cancel a traversal
    only after the person interacted with it since the last one, so a
    second Back before touching the page again goes through and loses the
    edits. The hook reads the dirty state when the event happens, and
    `allowNavigation()` lets one move through for Cancel's confirmed
    discard: it ends with the first navigation to another path, after 5
    seconds without one, or when a clean page becomes unsaved again. Once
    the person answers OK to the actor switcher's or the Add profile
    dialog's own "Discard changes?"
    (`confirmDiscardProfileChanges()`), the guard's `beforeunload` stands
    down with no time limit (creating a profile and switching can take
    longer than 5 seconds), and the confirmation is taken back
    (`revokeProfileUnloadAllowance()`) if the switch or creation fails.
  - **Actor check.** The editor sends the id of the profile it was loaded
    for with the profile PATCH (`actorId` in the body) and with every
    featured hashtag save (`actorId` in the `POST /api/v1/featured_tags`
    body, `?actorId=` on `DELETE /api/v1/featured_tags/:id`); when the
    session is on another profile by then (a switch in another tab), the
    route answers 409 `{ error: 'Actor changed' }` before any write.
    Mastodon clients do not send it and are unaffected. The editor shows
    one Alert for either 409 ("You switched to another profile, so this
    page is out of date", with Reload), moves focus to it, turns the Save
    bar to "Couldn't save your profile." and keeps Save off, since every
    retry would 409; the draft stays so the text can be copied.
  - **Layout:** when the editor is at least 860px wide (a container query
    on the editor's own width) a live preview column (`ProfilePreview`:
    avatar, header, name, handle, bio, the links through
    `ProfileFieldsBlock` with "+N more", the tab strip, and a "Set in
    Settings" card linking Who can follow you (`/settings/privacy`),
    Fitness privacy (`/fitness/privacy`) and Gallery privacy
    (`/gallery/privacy`)) sits beside the form; below `md` the bar is
    Cancel, "Edit profile" and Save, sticky under the settings mobile bar
    and the connection strip (and `scroll-padding-top` grows by its height
    while it is on the page), and the sticky bottom `SaveBar` is hidden.
    Settings are split into focused pages under `SectionLayout`: `/settings`
    is the index with a profile card and `SectionIndex`, appearance
    preferences live at `/settings/appearance`, and follower approval lives
    at `/settings/privacy`. Native form POSTs to
    `/api/v1/accounts/profile` use a hidden `returnTo` field allow-listed
    to `/settings/appearance` and `/settings/privacy` (defaulting to
    `/settings` for its 303 redirect).

#### Account migration (`Move`)

- **Moved accounts on the wire.** Inbound, `getPersistableProfile` stores a
  remote actor's `movedTo` and `alsoKnownAs` in the actor `settings` JSON (a
  refresh without them clears them). The Mastodon Account entity of a remote
  actor with `movedTo` carries `moved`: the target account, but only when the
  target actor is already stored (no remote fetch), and a target's own move
  is not followed. `moved` is hidden when the origin is suspended or the
  target is suspended or deleted/being deleted (Mastodon parity). Stored
  `alsoKnownAs` keeps only http(s) URLs, at most 20, and an inbound `movedTo`
  that is not an http(s) URL is dropped. Local aliases are supported via
  `GET/POST/DELETE /api/v1/accounts/aliases` (up to 10 aliases;
  `alsoKnownAs` is set through the aliases API; `movedTo` is set by the
  outgoing migration API, see the outgoing bullets below; both are edited on
  Settings → Moving at `/settings/moving`).
- **An inbound `Move` (account migration) goes to `MoveActorJob` from both
  inboxes, and nothing in its body is trusted beyond three ids.**
  `getJobMessage` queues it only when the HTTP signer, `actor` and `object`
  are the same account (the origin) and `target` is a different one; the job
  id is `getInboxJobId(activity.id)`, which only some queue backends dedupe,
  so the claim below is what makes a redelivery safe. The job
  (`lib/jobs/moveActorJob.ts`, Mastodon's `ActivityPub::Activity::Move` plus
  `MoveWorker`) ignores a local or suspended origin and a Move where either
  domain fails `canFederateWithDomain`. An inbound Move may target a local
  account (aliases verified from the stored row, no fetch; a local origin is
  refused, see the outgoing bullets below). It then works in this order:
  1. **The claim:** the job claims the origin with Mastodon's
     `move_in_progress:<account_id>` cooldown: `claimActorMove` stores
     `moveProcessing: { at, activityId, target }` in the origin actor's
     settings JSON (no migration), under a row lock, and any other Move of the
     same origin within 7 days is refused. Only a retry with the same activity
     id and the same target may claim again, so a reused activity id cannot
     move an account elsewhere. A failed verification releases the claim
     (`clearActorMove`: the target cannot be fetched, is not the fetched
     document, does not list the origin in `alsoKnownAs`, or is suspended or
     deleted/being deleted), so the 7-day limit applies to verified moves; a
     retry of the same Move is never blocked by itself. Once `movedTo` is
     recorded the claim is marked `verified` (`markActorMoveVerified`) and
     `clearActorMove` refuses to clear it, so a verified move holds the 7-day
     claim even if a later replay of the same Move fails verification. After
     every follower job was published (`markActorMoveQueued`) the claim is
     also marked `queued`, and a later run of the same activity returns without
     doing anything; the verification-skipping retry applies only to a verified
     claim that is not yet queued, and a claim older than 7 days is replaced
     whole, with neither flag.
  2. **The target** is fetched with a signed request when a federation signing
     actor is configured (a local target is read from storage without a
     remote fetch). Only then does the job store the origin's `movedTo`.
  3. **Carried relationships:** notes, blocks (federated only for remote
     targets via `SendBlockJob`, deterministic uri; a block carried onto a
     local target is not federated) and mutes (notifications flag and end
     time kept) are carried by `MoveRelationshipsJob`
     (`lib/jobs/moveRelationshipsJob.ts`, Mastodon's `MoveWorker` parity) with
     Mastodon's skip rules (already blocking/muting the target, or following
     it) and Mastodon's note texts, regardless of whether the target has
     itself moved. On retry or resume, `SendBlockJob` is re-published with the
     deterministic id for remote targets; deduplicating queues drop it and
     receivers treat duplicate blocks with the same uri as no-ops. A resume
     also repeats the rest of the block, per direction (`endFollowsForBlock`):
     the target's follow of the user is always ended while the block exists;
     the user's follow of the target is ended only if it predates the block,
     and one made after the carried block is left alone.
  4. **Follower jobs:** unless the target has itself moved (the `movedTo` is
     still recorded, but nobody is rewired, as Mastodon does not follow a moved
     account), the job publishes one `MoveFollowerJob` per accepted local
     follower of the origin, each with a deterministic id from the origin
     follow id and the target id. Cloud Tasks and NoQueue do not dedupe by job
     id (only some backends do), so the id only helps where the queue honours
     it; the follower job protects itself instead (below), and a retry or
     redelivery may run a follower twice without harm. Only accepted local
     followers are moved.
  - **`MoveFollowerJob`** (`UnfollowFollowWorker` plus `FollowMigrationService`)
    re-checks its own state and is safe to retry or to run twice at once. It
    stops if the origin follow is no longer `Accepted` or the origin's
    `movedTo` is not that target. It checks the target again (not suspended,
    not deleted, `canFederateWithDomain`, not itself moved) and leaves the
    origin follow if it is unavailable, or if the follower and the target
    block each other or the follower blocks the target's domain. The follow it
    makes has a deterministic id derived from `originFollowId/move/targetId`
    (a UUID), and `createFollowIfAbsent` inserts it with a conflict-ignoring
    insert on the primary key, so two concurrent runs cannot leave two rows.
    Only the run that inserted the follow notifies the local target, and a
    retry notifies only when no notification exists yet for that follow, so a
    duplicate notification needs a redelivery that lands in the short gap
    between one run's insert and its notification.
  - **Local targets:** an unsilenced local follower moving onto a local
    target is repointed directly (`Accepted` even when locked, the target
    gets a `follow` notification, no Follow over the network; the Undo to the
    remote origin is still sent). A silenced local follower moving onto a
    local target gets a follow request (`Requested` status and a
    `follow_request` notification, as in Mastodon's `FollowService`), even
    when the target is unlocked; the Undo to the remote origin is still sent.
  - **A leftover follow for a remote target:** only a follow with that id is
    the job's own leftover: if it is `Requested`, the Follow is sent again
    for that row (a failed send keeps the row, as Mastodon does, instead of
    undoing it, so a late Accept never leaves two Accepted follows); if it is
    `Accepted`, the move is finished. Any other follow of the target,
    `Requested` or `Accepted`, is the user's own: as in
    `FollowMigrationService` only `reblogs`/`notify`/`languages` are copied
    (a language filter the origin does not have is left alone), the target is
    added to the lists that hold the origin, and the origin follow and the
    origin in those lists are kept.
  - **Otherwise** the job creates a `Requested` follow (or `Accepted`
    directly for an unsilenced follower on a local target) with the origin's
    options (and stops if that row turns out to be ended already), sends the
    Follow (skipped for a local target), adds the target to the follower's
    lists that hold the origin, marks the origin follow `Undo` (which drops
    the origin from those lists in the same transaction, so an `Accepted`
    origin never leaves a list early) and only then queues `SendUndoFollowJob`
    (deterministic id). The flip must come first: `SendUndoFollowJob` does
    nothing unless the stored follow is already `Undo`, and NoQueue runs the
    handler inline inside `publish()`. This is the order `applyBlock` and
    `acceptFollowRequest` use. If it crashed before the flip the retry
    repeats the idempotent steps; if it crashed after, the retry only
    repeats the Undo job: when the origin follow is already `Undo`, `movedTo`
    is that target and the job's own follow exists, the lists were finished
    before the flip. A Follow that cannot be delivered keeps the origin
    follow and throws for a retry.
- **An outgoing move is `POST /api/v1/accounts/migration`, and it checks
  things in a fixed order.**
  - `app/api/v1/accounts/migration/route.ts` parses the body (`acct`, `kind`
    as `move` or `redirect`, and the optional `password`, `username` and
    `actorId`): bad JSON is 400 `Invalid request`, a body that fails the
    schema is 422, and an `actorId` other than the session's is 409 `Actor
changed`. Then `verifyChallenge` re-authenticates: when the account has a
    `passwordHash`, the password must match by bcrypt (`Invalid password`); a
    passwordless account must send its current username, compared
    case-insensitively (`Invalid username`); both are 422. Then `acct` (with
    a leading `@` stripped) is resolved: `invalid` is 422 `Invalid account`,
    `forbidden` is 403 `Federation with that server is not allowed` (the
    aliases route answers the same) and `not-found` is 404.
  - `performOutgoingMove`
    (`lib/services/accounts/migration/outgoingMove.ts`) then refuses, all as
    422: first an origin that is being deleted (`This account is being
deleted`; the route has already resolved the target, so an unknown
    target still answers first), then the account itself, a target that is
    suspended or being deleted, a target whose `movedTo` is set, and an
    account whose `movedTo` already equals this target (`Already moved to
this account`, whether by a started move or a redirect, except a retry
    of a `move` whose job was never queued, see below). For `move`, a user
    inside the 30-day cooldown that is not such a retry gets 429 at once,
    before the target is read.
  - For `move` only, it reads the target's `alsoKnownAs` and `movedTo` fresh
    (a stored row for a local target; for a remote one, the Person from its
    origin, signed when a signing actor is configured, never the cache). An
    unreachable target is 502 `Could not reach the new account, try again
later`; with no federation signing actor to fetch with it is 500 `This
server cannot fetch remote accounts right now` (logged); a reachable
    target that has moved is 422, and so is one whose aliases do not list the
    account (`Add this account as an alias on the new account first`). The
    30-day cooldown answers 429 with `cooldownUntil`; the check before the
    fetch is a shortcut, and the one made when the move is recorded, below,
    stays authoritative. `redirect` skips the fresh alias read (the target
    is still resolved and checked for being moved, suspended or deleted) and
    the cooldown check.
- **A move is recorded in one locked transaction, then published.**
  `recordActorMigration` (`lib/database/domains/actorMigration/queries.ts`)
  locks the actor row, checks the cooldown for a `move` (the newest `move`
  row less than 30 days old, else 429), then inserts the `actor_migrations`
  row (kind, `targetAcct`, the followers count) with explicit timestamps and
  sets `movedTo` in the actor's settings, all in one commit.
  - **Retry window:** a retry of a `move` returns the existing row instead of
    a new one only while every one of these holds: the newest row of any
    kind is that move, it names this target, its `startedAt` is null (the
    job was never queued), it is inside the cooldown and `movedTo` still
    points at the target. Any other `move` inside the cooldown is 429.
    Before that, `performOutgoingMove` answers 422 `Already moved to this
account` whenever `movedTo` already equals the target and the request is
    not such a retry, started row or not, and also after a redirect to that
    target (Mastodon's `AccountMigration` refuses `already_moved` the same
    way); a `DELETE` followed by a redirect to the same account cannot bring
    a cancelled move back, and a repeat of a successful move queues nothing.
  - **Publish:** after the commit, `publishActorUpdate` sends
    `Update(Person)`, and only for `move` is `SendMoveJob` queued with id
    `${migrationId}:start`, after which `markActorMigrationStarted` sets
    `startedAt` and closes the retry window. A failed queue publish is logged
    and answered with 503 `Could not start the move, try again later`, but
    nothing is rolled back: the row, `movedTo` and the Update stay, and
    `startedAt` stays null. Retrying the same POST publishes the same job id
    (the id is the migration's) and sends `Update(Person)` again, which is
    bounded to the failed attempts because the retry ends once the move is
    started, and completes the move.
  - **The cooldown still counts after `DELETE`**, because the rows stay. A
    move whose start failed (503) and was never retried keeps `movedTo` and
    still counts toward the 30-day cooldown, as Mastodon's cooldown counts
    every recorded migration; `DELETE` clears the pointer, not the cooldown.
  - **A superseded retry:** `performOutgoingMove` skips the alias read only
    for a retry that a newer migration row has already superseded (expected
    to answer 429); it then passes `aliasVerified: false`, and the
    transaction never creates a `move` row for it (answer `unverified`, 429,
    even if the cooldown ended meanwhile), while an unstarted retry of the
    same verified move still returns `existing`. A redirect that succeeds
    sets `movedTo` and sends `Update(Person)` and nothing more. `GET` returns
    `getMigrationState` (`movedTo`, the migrations, `cooldownUntil`,
    `followersCount`).
- **`SendMoveJob` (`lib/jobs/sendMoveJob.ts`, Mastodon's `MoveWorker` and
  `MoveDistributionWorker`) sends the Move.** The activity
  (`lib/activities/move.ts`) has id `${origin}#moves/${migrationId}`, type
  `Move`, `actor` and `object` set to the origin, `target` set to the new
  account, and no `to`, as Mastodon's `MoveSerializer` builds it.
  - **Authorization:** the job does nothing unless the origin is local with a
    private key and the job's `migrationId` names a `move` row for this
    origin and target (`isOutgoingMoveAuthorized`,
    `lib/jobs/isOutgoingMoveAuthorized.ts`). The row authorizes the work, not
    the live pointer, so a `DELETE` after the move started does not stop the
    fan-out (Mastodon never stops a performed move). `startedAt` is set only
    after the start job is published, so the first slice may run before it:
    until then `movedTo` must still name the target, and a `DELETE` in that
    window cancels the move (a small window remains: a `DELETE` that lands
    between the job's publish and `markActorMigrationStarted` can still let
    the start run, because the `POST` is still pending then). The job passes
    its `migrationId` in the data of every `MoveFollowerJob` and
    `MoveRelationshipsJob` it publishes (job ids unchanged).
  - **First slice:** it publishes one `MoveRelationshipsJob` per local
    blocker, muter and note author of the origin, for any target, local or
    remote, and fails the run if one cannot be queued. It also delivers the
    Move to every accepted relay inbox on that first slice only (Mastodon's
    `Relay.enabled`).
  - **Paging:** it pages the origin's followers 100 at a time by follow id,
    and after them the remote actors that block the origin
    (`getRemoteBlockers`, paged 100 at a time by block id; Mastodon's
    `account.blocked_by.inboxes`). Each distinct remote shared inbox (or
    inbox) gets one delivery of the activity, keyed on the migration id so
    one Move goes to each inbox across all continuations and both phases,
    even when a follower and a blocker share it. A target that is suspended
    or being deleted when the job runs does not stop the remote Move
    (Mastodon's `MoveDistributionWorker` does not re-check it); only the
    local rewiring skips it, in `MoveFollowerJob`. That one-per-inbox
    guarantee relies on the queue dropping duplicate job ids (the
    database-backed queue and QStash do); a queue driver that does not
    dedupe may deliver the same Move twice, which receivers treat as a
    no-op. Each local follower gets a `MoveFollowerJob`, but only when the
    target has not itself moved. Every job id is deterministic. A run stops
    after the page that crosses a 20-second budget and queues
    `${migrationId}:continue:<phase>:<cursor>` (`followers` or `blockers`,
    with `start` when the phase has no cursor yet). On a real queue a
    refused delivery fails the run for a retry; the in-process queue records
    the error and carries on.
- **`MoveFollowerJob` and `MoveRelationshipsJob` accept a local origin with
  a recorded `move` row for the target**, read by the `migrationId` in the
  job's data (`getActorMigration`; started, or `movedTo` still the target
  before the start; a job for a local origin without a `migrationId` is
  refused, so an old started move to the same target never authorizes the
  jobs of a newer move that was cancelled before it started; a remote origin
  still needs `movedTo` at the target).
  - The mute note on resume uses the migration row's `createdAt` as the claim
    time for an outgoing move (`moveProcessing.at` is only written for an
    inbound one), because the origin of an outgoing move is ours, and a
    `DELETE` after the start does not strand the remaining followers.
  - `MoveFollowerJob` then sends no `Undo` for the old follow (`publishUndo`
    returns for a local origin), so that follow simply ends locally. In a
    local-to-local move a request the follower already has pending to the
    target is authorized through `acceptFollowRequest` with `silent: true`,
    as Mastodon's `MoveWorker#rewrite_follows!` does
    (`follow_request.authorize!` sends no alert): no follow email or push
    goes to the target, and the target's pending `follow_request`
    notification is deleted. A silenced follower's request stays pending.
- **Clearing a move: `DELETE /api/v1/accounts/migration`** (`actorId` from
  the query or a JSON body; 409 on a mismatch) clears `movedTo`, publishes
  `Update(Person)`, and requeues the account's scheduled statuses that are
  already due.
  - Each replay job uses a deterministic ID scoped to the latest migration
    row (or a legacy fallback when no row exists), so concurrent or
    redelivered publishes within one replay de-duplicate on their queue IDs.
    A redirect set again during the replay scan cancels that replay; the
    next `DELETE`, scoped to the new migration, replays those posts. A
    partial queue failure can still leave due posts unpublished with no
    `DELETE` left to retry them: `PUT /api/v1/scheduled_statuses/:id` is the
    recovery path, as its minimum-ahead check is the only gate on
    rescheduling. Mastodon's `RedirectsController#destroy` clears the
    redirect.
  - It cancels a redirect, but a performed move is not undone and an
    in-flight one still completes: the queued `SendMoveJob` continuations and
    follower jobs go on, the followers already moved keep their new follows,
    and the `actor_migrations` rows stay.
  - **No new followers:** a moved local account (`movedTo` set) takes no new
    follower: an inbound `Follow` is answered with `Reject` (as for a blocked
    follower, like Mastodon's `reject_follow_request!`), and
    `POST /api/v1/accounts/:id/follow` answers 403 `Target account has moved`
    for a moved local or remote target without a follow already, as
    Mastodon's `FollowService` refuses it, and
    `POST /api/v1/follow_requests/:id/authorize` answers 422 `This account
has moved` (reject stays allowed).
  - **Posting is refused** while `movedTo` is set (`isMovedActor` in
    `lib/services/accounts/movedAccount.ts`), with 422 `This account has
moved` (`movedAccountResponse`): on `POST /api/v1/statuses` (the check
    runs first, so polls, replies and scheduled posts are refused too), on
    `POST /api/v1/statuses/:id/reblog`, and on the deprecated
    `POST /api/v1/accounts/outbox` and `POST /api/v1/accounts/repost`. A
    scheduled status whose author has moved when it is due remains queued
    without being published; clearing a redirect requeues already-due
    statuses for the publish job. Editing a status
    (`PUT /api/v1/statuses/:id`) and its interaction policy
    (`PUT /api/v1/statuses/:id/interaction_policy`) are refused the same way
    (see `app/api/v1/statuses/[id]/route.ts` and
    `.../interaction_policy/route.ts`).
  - **The other API write routes remain available to a moved author under
    their ordinary permission checks**: deleting its own statuses; rejecting
    follow requests; favourites, bookmarks, poll votes, reactions and quote
    revocation; following accounts that have not moved and unfollowing
    accounts regardless of whether the target has moved; media upload and
    update; lists, filters, reports, mutes, blocks, account notes, pins,
    featured and followed tags, endorsements, gallery and albums; fitness
    uploads and retries; settings and account deletion; and
    `PUT /api/v1/scheduled_statuses/:id`. CSV and archive export, migration
    GET/POST/DELETE, and timeline and notification reads remain available.
    Posting and follow-request refusals are explicit here. Mastodon's API
    base skips the inherited `require_functional!` gate except in limited
    federation mode, and its `require_user!` checks
    `User#nonfunctional_reason`, which does not include a moved account. Its
    signed-in web path checks `User#functional?`, which does exclude moved
    accounts; individual Mastodon API actions can have their own checks. The
    profile response (`lib/services/accounts/profile.ts`) carries
    `moved: true` while `movedTo` is set. `deleteActorData`
    (`lib/database/domains/actor/deletion.ts`) removes the account's
    `actor_migrations` rows with the rest of its data.
  - **Fitness imports while moved** retain the backing status needed to link
    activity data, but do not insert a new post in timelines, notify
    followers or federate it while the author is moved. Clearing the
    redirect does not publish a status created during the move: a text edit
    keeps it hidden, and only a visibility change whose audience differs from
    the current one clears the marker and makes it an ordinary post that
    merges with later imports like any other. Choosing `direct` on a
    still-hidden status with no mentions is the same audience and keeps it,
    so the status stays isolated; a change to `direct` clears the marker only
    when the status had another audience before, or when mentions are added.
    Such a status is marked `createdWhileMoved` (in the status content blob),
    because an ordinary `direct` import also has empty recipients; a later
    overlapping fitness import creates a separate published status rather
    than merging into a marked one that is still hidden, while unmarked
    statuses — including direct imports from an account that never moved —
    merge as before (`isIsolatedFromFitnessImport` in
    `lib/jobs/fitnessImportIsolation.ts`). A Wahoo revision of an
    already-imported workout is not a new recording, so it stays on its
    existing status across the move boundary instead of being isolated into
    a new one.
- **`actor_migrations` (migration `20261024131756_add_actor_migrations`) holds
  one row per move or redirect**: the target actor, `targetAcct`
  (`username@domain` at the time), `kind`, the followers count and `startedAt`
  (null until the Move job is queued). The cooldown
  reads only the newest `move` row (`getLastActorMove`), so a redirect never
  starts one.

#### Handle rename

- **A local actor can rename in place, and the `actor_handles` ledger is
  what makes that safe.** `actor_handles` (migration
  `20261025141323_add_actor_handles`) holds one row per handle the actor has
  ever had: the current row (`replacedAt` null) plus one row per replaced
  handle. A unique index on `(lower(username), domain)` means at most one row
  per handle across every actor, current or retired; a second index on
  `(actorId, replacedAt)` serves the history and cooldown reads. Domains fold
  at write and at read.
  - The migration backfills one current row per account-backed local actor
    (`privateKey` non-empty, keyset pages, the oldest of a case-colliding pair
    wins, idempotent through `WHERE NOT EXISTS` on the actor id);
    `createAccount` and `createActorForAccount` insert the current row inside
    their existing transactions, and a rename mints a missing current row
    lazily.
  - `isUsernameExists` consults the ledger too, so a handle any row holds —
    current or replaced, any actor — can never be registered again, and
    `getActorFromUsername` gains a ledger arm that resolves any
    `actor_handles` row for the folded handle, current or replaced, to its
    holder (a replaced row returns the actor that gave the handle up; a
    current row answers a casing miss with the handle's holder), so an old
    handle keeps working everywhere a handle resolves
    (`OnlyLocalUserGuard`, WebFinger, mentions, lookup, search). The arm runs
    after the exact actors match but BEFORE the case-folded one: a retired
    ledger row is the reservation that says who the handle is, so a legacy
    case twin still sitting in `actors` (a backfill's skipped younger twin)
    can never take over a renamed actor's old handle — the id path,
    WebFinger and mentions keep answering the renamed actor, and null once
    it is deleted, never the twin.
- **The rename itself is `recordActorHandleRename`
  (`lib/database/domains/actorHandle/queries.ts`), one transaction under a
  `forUpdate` lock on the actors row** (the actorMigration pattern; a no-op
  on SQLite). It refuses, as a discriminated result rather than a throw:
  - a missing or non-local actor (`not_found`); a moved or redirecting one
    (`moved` — `settings.movedTo` is written in the same transaction that
    records an outgoing migration, so the pointer is the active migration); a
    suspended or deleting one (`unavailable`);
  - an actor with no current row whose handle another actor's ledger row
    occupies, or any actor — with a current row or without — whose current
    handle another `actors` row folds to (either side of a backfill case
    pair, `cannot_rename`: retiring the handle would hand its folded lookup
    to the twin);
  - the same handle back, case-only renames included (`unchanged`); a rename
    inside the 30-day cooldown measured from the latest `replacedAt`
    (`cooldown`, answering `cooldownUntil`; backfilled and lazily minted
    rows have a null `replacedAt` and never trigger it); and a target held
    by another actor's live actors row or any of its ledger rows (`taken`) —
    including a concurrent claim that commits between the checks and the
    write: the folded unique index is what stops the double claim, and the
    collision reads as `taken`, never a thrown 500.
  - The actor's own replaced row for the target is the rename-back case and
    is revived (`replacedAt` back to null, under the target's exact spelling
    so the history never shows a casing the actor does not hold), never
    duplicated — the folded unique index would refuse a second row anyway.
    Otherwise a new current row is minted, the previous current row gets
    `replacedAt = now`, the actors row's `username`, `domain` (lowercased)
    and `updatedAt` are updated — `actors.id` never changes — and the search
    document is re-indexed in the same transaction, so search sees the new
    handle exactly when the actors row does. The result's `previous` is the
    locked actors row's stored spelling (what the status permalinks were
    minted from), and `renamedAt` is the rename's timestamp.
- **Deleting an approved actor keeps its handles reserved.** `deleteActorData`
  (`lib/database/domains/actor/deletion.ts`) keeps the username reserved:
  inside the purge transaction it sets `replacedAt = now` on the actor's
  current ledger row and deletes nothing from `actor_handles`, so the handle —
  and the username path inside the federated id — can never be re-issued on
  that domain, as in Mastodon.
  - A REJECTED never-approved sign-up is the exception:
    `rejectPendingAccount` (`lib/database/domains/moderation/queries.ts`)
    deletes those actors' `actor_handles` rows in the same transaction,
    because a never-approved account never federated and its handles were
    never observable.
  - The retired rows keep resolving only while an actor row exists — the
    deletion removes the actor, so the reservation is what survives, not the
    resolution.
- **`RenameStatusUrlsJob` (`lib/jobs/renameStatusUrlsJob.ts`) rewrites the
  renamed actor's status permalinks in the background.** `statuses.url` and
  its `urlHash` twin embed the handle the status was minted with
  (`https://<domain>/@<username>/<publicId>`; `createNote`, `createPoll` and
  the fitness imports all build it that way), so after a rename every url
  under the old profile prefix is rewritten to the new one and `urlHash` is
  recomputed, leaving `status_history` alone.
  - The job pages 200 statuses at a time by `statuses.id` (keyset), has a
    20-second budget checked between pages, and publishes a continuation
    when the budget runs out, under deterministic ids that embed the
    rename's timestamp (`${handleId}:${renamedAt}:statusUrls:start`, then
    `${handleId}:${renamedAt}:statusUrls:<lastId>`) — a rename back reuses
    the revived row's `handleId`, so without the timestamp its job id would
    collide with the earlier rename's and a deduplicating queue would drop
    the rewrite. The prefix keeps the stored domain's casing, because the
    mint paths build the url from `actor.domain` as stored.
  - Because both prefixes end in `/` and a username cannot contain `/`, a
    rewritten url can never re-match the old prefix, so a redelivery or
    retry re-runs the same page, matches no rows and changes nothing. The
    rename route queues the start job after the commit, best effort.
- **Old handles keep answering everywhere.**
  - **WebFinger** tries an http(s) resource as the immutable actor id first,
    then reads its path as a handle; a historical handle answers 200 with
    the CURRENT handle as the `subject`, the same actor id verbatim in both
    `self` links, and the requested old profile URL and `acct:` URI among
    the aliases — never 404, 410 or a redirect
    (`lib/services/wellknown/webfinger.ts`). The Person document
    (`lib/utils/getPersonFromActor.ts`) carries the FEP-2c59 `webfinger`
    property — the bare `username@domain` string, Mastodon's form — and
    adds `https://purl.archive.org/socialweb/webfinger` to `@context` as a
    plain context URL.
  - **On the web**, a profile page (or a nested status, followers or album
    path) reached under an old handle 308-redirects to the same page under
    the current handle: `getLocalHandleRedirect`
    (`app/(timeline)/[actor]/getLocalHandleRedirect.ts`) is a pure helper
    that returns the same path and query under the current handle and falls
    through unchanged for remote and unknown handles, and the actor layout
    calls `permanentRedirect` with it.
  - **The redirect headers:** the proxy is the only writer of the two
    request headers the helper reads (`x-activities-local-handle-path` and
    `-search`, constants in
    `lib/utils/http-headers/localHandleRedirect.ts`): it deletes a
    client-sent pair on every request the proxy runs on and sets them only
    on the branches that rewrite to the profile — the matcher skips
    multipart `/api/*` requests, which can fall through to the
    `[actor]`/`[status]` pages with the client's headers intact — and the
    helper itself refuses a captured path whose first segment is not the
    requested handle or that climbs with `..`, so a forged value can never
    steer the 308; that first-segment check is the backstop for the requests
    the proxy never runs on. `resolveStatusFromPath` builds the legacy
    status id from the resolved actor's immutable id, so `/@old/<id>` style
    paths keep resolving across a rename.
- **The domain admin refusal follows the rename too.** Turning a domain off
  (`setDomainStatus` with status `off`) or removing it (`removeDomain`) is
  refused with `has-profiles` while any local actor still uses it — by handle
  (`actors.domain`) or by id host (`actors.id LIKE 'https://<domain>/users/%'`,
  escaped), via `getLocalActorsOnDomain`
  (`lib/database/domains/servedDomain/queries.ts`) — so an actor renamed away
  from the domain still blocks it through its id, and one renamed onto it
  blocks it through its handle. The admin route answers 409 with the blocking
  actors listed (`{ id, acct }` each, the acct always fully qualified).
- **A remote actor's rename is followed only when WebFinger confirms it.**
  Mastodon has no REST rename either: it applies a remote account's rename
  when an `Update(Person)` changes the handle, verified by
  `check_webfinger!`. Here the refresh branch of `recordActorIfNeeded`
  (`lib/actions/utils.ts`) runs `confirmRemoteHandleChange` before the
  profile write.
  - The handle the document claims (`getClaimedActorHandle` in
    `lib/activities/confirmActorHandle.ts` — the FEP-2c59 `webfinger`
    property when it parses, else `preferredUsername` on the actor id's
    host, Mastodon's `extract_username_and_domain!`) is compared with the
    stored one, and when it differs `confirmActorHandle` must confirm it: a
    WebFinger `self` link must name the actor's id (normalized), the
    cross-domain question goes to exactly one domain (the one the property
    names, else the `subject` the id host answered with, Mastodon's subject
    redirect — never a second hop, the lookup does not follow cross-host
    redirects), and that domain's answer must carry the same handle as its
    `subject`.
  - On confirmation `updateRemoteActorHandle`
    (`lib/database/domains/actor/writes.ts`) rewrites the stored row in one
    locked transaction; another STALE REMOTE row still holding the handle is
    displaced with Mastodon's `invalidate_username!` tombstone (`!` + the row
    id tail, unmatchable by every lookup), while a LOCAL holder or a handle
    another actor's ledger row reserves refuses the write (null, nothing
    changed), and both rows' search documents are re-indexed. A claim that
    does not confirm aborts the whole refresh — the stored profile is never
    written under an unconfirmed handle.

#### Profile links (`fields`) storage and formatting

- **Profile links (`fields`) are plain text in storage and HTML everywhere
  they leave.** `formatProfileFieldValue`
  (`lib/utils/text/formatProfileFieldValue.ts`) is the one formatter, a
  deliberate subset of Mastodon's TextFormatter: only a value that is exactly
  one http(s) URL becomes a link (what `rel="me"` verification needs; URLs,
  mentions and hashtags inside other text stay plain text), in Mastodon's
  link markup (the link has `rel="nofollow noopener me"`, the scheme and
  `www.` sit in a leading `invisible` span, an address over 30 characters is
  cut with `ellipsis`), anything else is HTML-escaped text.
  - `getPersonFromActor` emits the result as `PropertyValue` attachments
    (and the `schema`/`PropertyValue`/`value` terms in `@context`, only when
    there are fields), and the Account entity uses it for a local actor's
    `fields[].value` (a remote actor's stored HTML is sanitized instead;
    `source.fields` stays raw). The profile page reads the attachments for
    local and remote actors alike and renders them through
    `ProfileFieldsBlock`, which sanitizes.
  - **Local caps:** both the settings form (`parseProfileFieldsForm`) and
    `update_credentials` cap them at four rows, label 255 and content 2047
    characters. Both drop a row whose label and content are both blank;
    `update_credentials` keeps a half-filled row (as Mastodon does), which
    the settings form refuses and flags on load.
  - **Remote caps:** a remote actor's fields are capped where they are read
    from its document, `getActorProfileFields`
    (`lib/utils/activitypubActor.ts`), which both the stored row
    (`getPersistableProfile`) and the profile page use, with Mastodon's
    remote numbers: the first 50 attachments typed `PropertyValue`
    (`MAX_PROFILE_FIELDS` in `ActivityPub::ProcessAccountService`; other
    attachment types do not count), any whose name or value is not a string
    dropped, and each name and value trimmed (`String#trim`) and cut to
    2047 characters (`Account::Field::MAX_CHARACTERS_COMPAT`, counted in
    code points). The value is the remote server's raw HTML, so a cut can
    end inside a tag; every surface sanitizes it before showing it, which
    closes or drops the broken markup. A row stored before the cap keeps
    its old fields until the actor is refreshed.

#### Profile link verification (`VerifyProfileLinksJob`)

- **Profile links are verified with `rel="me"`, as on Mastodon, by
  `VerifyProfileLinksJob` (`lib/jobs/verifyProfileLinksJob.ts`).** A field is
  checked only when its value is a single https URL: the raw value for a
  local actor, and for a remote actor the href of the one `<a>` whose text
  equals its href (or a bare URL), as Mastodon's `extract_url_from_html`
  reads it (`getVerifiableFieldUrl`, `lib/services/profile-links/html.ts`).
  - **The fetch:** the job fetches the page through `verifyProfileLink`
    (`safeRemoteFetch`: HTTPS only, SSRF guard, 5 s connect + 5 s read per
    hop, 1 MiB body that fails rather than truncates, `200` and `text/html`
    or `application/xhtml+xml` only, two redirects, which are followed for
    the page itself) and tokenizes it with `htmlparser2`'s `Parser` (linear,
    no tree) looking for an `<a>` or `<link>` whose `rel` has the token `me`
    and whose `href` equals, case-insensitively, the profile URL
    (`https://<domain>/@<username>`, `getActorProfileUrl`), the actor id, or
    the profile URL of any REPLACED handle in the actor's `actor_handles`
    ledger, so a page linking to the previous profile keeps its verification
    after a rename. The link back itself is never fetched or resolved.
    Every failure is just "not verified". A remote actor's own `url` is not
    stored, so its profile URL is derived the same way (`/@username`) plus
    its id, and at most four fields are checked.
  - **Storage:** `verifiedAt` (epoch ms) on each entry of `settings.fields`
    (a JSON column, so no migration). `updateActor` keeps it for a field
    whose value is unchanged and drops it for a changed value
    (`carryOverFieldVerification`, `lib/utils/profileFieldVerification.ts`),
    so every write path gets "edit the link, lose the check" for free; a
    `verifiedAt` in the incoming fields (for example in
    `update_credentials` JSON) is ignored, only the stored row decides. The
    job writes through `markActorProfileFieldsVerified`, which re-reads the
    row under a lock and stamps only fields that still hold a checked
    value, and leaves `updatedAt` alone (it is the remote refresh clock).
    `updateActor` re-reads `settings` under the same lock inside its
    transaction and builds the result on that row, so a mark that committed
    meanwhile is not overwritten. The job also stamps `linksCheckedAt` (epoch
    ms, in `settings`) on every run, whatever the outcome; `updateActor`
    carries it over. Like `verifiedAt` it is local state:
    `getPersonFromActor` never emits it (a test pins this), and it is not in
    the API. Receiving servers verify for themselves.
  - **When:** `queueProfileLinkVerification`
    (`lib/services/profile-links/queueProfileLinkVerification.ts`) queues
    the job, best effort like `publishActorUpdate`, whenever any field is
    verifiable (`getVerifiableFieldUrl`, with the local or remote flag) and
    has no `verifiedAt` after the stored check is carried over. A changed
    verifiable value is always unverified, so this also covers a changed
    list; it is Mastodon's `requires_verification?` test in `check_links`. So
    saving the same link again after adding `<a rel="me">` to the site
    re-checks it, while a profile whose links are all verified, empty, plain
    text or http queues nothing.
    - It is called after the settings form, `update_credentials` and
      `PATCH /api/v1/profile` (the last two share `updateCredentialsHandler`)
      save links, and after a remote actor is created or refreshed
      (`recordActorIfNeeded`, `getProfileData`). `getProfileData` runs on
      every render of a remote profile, so there the call passes
      `renderCheckedAt` (the actor's `linksCheckedAt`; `updatedAt` moves on
      every render, so it cannot be the gate) and nothing is queued while
      the last check is newer than 1 hour for a changed value, or 3 days
      for an unchanged unverified one. That bounds the fetches even when a
      hostile remote serves different values on every request. The local
      saves and `recordActorIfNeeded` (inbox `Update(Person)`, real
      refreshes) ignore the stamp and always queue.
    - The job id is a hash of the actor id, the sorted field values and a
      30 second window, so concurrent queues of the same state collapse
      (the database queue ignores a second job under a taken id, and QStash
      deduplicates by id) but a save a minute later runs again. A verified
      link is never checked again until its value changes.
    - `http:` links are not verifiable, as in Mastodon (`Account::Field`
      accepts only `https`), and `safeRemoteFetch` refuses plain http
      anyway, so they get no status in Settings or on the profile and are
      never queued. On `NoQueue` the job runs inside `publish`, so the
      request that saved the links waits for the check (about 30 s per link
      with two redirects, and up to four links run at once), and for a
      remote actor it also runs inside the `getProfileData` render that
      created or refreshed it, so that page waits for the check too
      (`NoQueue` does not deduplicate).
  - **Where it shows:** `fields[].verified_at` and
    `source.fields[].verified_at` of the Account entity (ISO time or
    `null`); `ProfileFieldsBlock` (the profile page passes `profileFields`
    from `getProfileData`: a local actor's stored field, or a remote
    document's field matched by name and value to the stored row); and the
    "Profile fields" editor on the Edit profile page (`ProfileFieldsField`,
    `lib/components/settings/`), which shows a green "Verified" or a muted
    "Not verified" under each row whose current content (trimmed) equals a
    saved https value, matched by value and not by position because rows
    can move (nothing for an empty, text or http row, and nothing once the
    content was edited to something unsaved, because the status describes
    the saved value), wired into the content input's `aria-describedby`.
    - The editor's "On your profile" preview renders the filled rows
      through `ProfileFieldsBlock` with `verifiedAt` only for such saved
      values, and each row's icon comes from `chooseProfileFieldIcon` on
      the same sanitized value the profile uses, drawn from the one
      `PROFILE_FIELD_ICONS` map (`profileFieldIcons.ts`).
    - The editor always submits four `fields[i][name]`/`fields[i][value]`
      pairs in row order, padding unused slots with empty hidden inputs,
      because `parseProfileFieldsForm` keeps the stored fields when a form
      has no `fields[...]` key and emptying the list must clear them.
      Reordering or relabelling keeps `verifiedAt`, since
      `carryOverFieldVerification` matches by value.
    - The Edit profile page uses the same field with `showLinkChecks` and
      no inline preview (it has its own live preview column), and its rows
      are reported to the page through `onRowsChange` and the saved values
      come back from the PATCH, so it submits JSON instead of the four
      hidden pairs. With link checks on, an https value that is new,
      changed or just saved without a check mark reads "Checking for a
      link back to your profile…" (client state only; the server does
      not say when a check runs, so the label lasts until the page loads
      again).

#### Actor deletion federation

- **Account deletion sends `Delete(actor)` from `deleteActorJob` itself,
  inline, while the row is still `scheduled`: after the due-time checks and
  BEFORE `startActorDeletion`.** The Delete must be signed with the actor's
  key, and `deleteActorData` removes the row that holds it, so a queued
  `DeliverActivityJob` would find no actor on retry and discard itself. Do
  not move the sends after the data delete or onto the queue. Do not move
  them after `startActorDeletion` either: a worker that dies mid-fan-out is
  retried, and a retry of a row already marked `deleting` stops at the
  status check, which would leave the account in `deleting` with its data
  never removed.
  - The job re-reads the status after the sends so a cancel that landed
    meanwhile still keeps the account locally; the Deletes already sent
    cannot be recalled, so remote servers that processed one have dropped
    the account's copy and its follows there.
  - The sends share a wall-clock budget
    (`ACTOR_DELETION_FEDERATION_BUDGET_MS`, under QStash's 30s job limit)
    and each uses a short timeout (the request layer never retries a POST):
    a hosted queue cuts the job off at its deadline and retries from the
    top, so a fan-out that never fits would keep the account from ever being
    deleted. Inboxes not reached in time are skipped. Inboxes of LOCAL
    followers (`getLocalFollowersForActorId`) are left out: delivering there
    would run the inbound actor delete (`deleteObjectJob` →
    `database.deleteActor`) on the row the job is still emptying. Sending is
    best effort and never stops the local deletion.

#### Inbound actor profile updates

- **An inbound `Update` whose object is an actor (an actor type, or a bare id
  equal to the activity's actor) goes to `UpdateActorJob`, which re-fetches the
  profile from its origin through `recordActorIfNeeded({ forceRefresh: true })`
  and never reads the activity body.** `getJobMessage` accepts it only when the
  signer, the activity's `actor` and the object id are the same actor. The job
  refreshes only a stored remote row: an actor never stored has nothing to
  refresh, and a local row is never rewritten from the network.

#### The `sensitive` flag federates both ways

- **`sensitive` federates both ways.** Outbound notes always carry it as a
  boolean (both `getNoteFromStatus` and `toActivityPubObject`), as Mastodon does.
  Omitting `false` would leave an un-marked post sensitive on any receiver that
  keeps the stored flag when an edit omits the key, which is what this server's
  own `updateNoteJob` does. Inbound `createNoteJob` and the on-demand fetches in
  `fetchRemoteStatusJob` store the flag, and
  `updateNoteJob` applies it only when the edit carries a boolean. A
  non-boolean value parses as absent (`.catch(undefined)` on the schema) rather
  than rejecting the note.

<a id="agents-better-auth-plugin-guidelines"></a>

### Better-auth Plugin Guidelines

- **Do not register a better-auth plugin unless its required database tables exist** in the migrations. The custom `kyselyAdapter` (`lib/services/auth/kyselyAdapter.ts`) does not auto-create tables; missing tables will cause runtime errors.
- **On any better-auth upgrade, diff the schema better-auth declares against ours — do not reason about which new fields are "reachable".** `kyselyAdapter.create` inserts whatever a plugin put in the record: it creates no tables and filters no columns, so a field a plugin writes and the schema lacks is a failed INSERT, not a degraded feature — and better-auth swallows the driver error into a 500. A plugin can start writing a field no migration added at any time (`oauthConsent.requestedUserInfoClaims` is written as `[]`, not `undefined`, so the factory's `transformInput` does not drop it), and a green suite does not catch it. `lib/services/auth/schemaCompleteness.test.ts` asks `getAuthTables(auth.options)` — the real plugin set, with our `modelName`/`fieldName` overrides applied — and diffs it against the committed schema dump of the backend it runs on (`migrations/schema.sqlite.sql`, or `migrations/schema.sql` in the PostgreSQL test shards), so an upgrade that omits a column fails a test instead of an OAuth login. Take that list as the migration's contents. **The schema drift checks in the first PostgreSQL test shard cannot catch this**: they regenerate the dumps FROM the migrations, so a migration that omits a column still produces a perfectly matching dump.
- **`lib/services/auth/oauthProviderFlow.test.ts` is the only thing that drives better-auth's real OAuth endpoints** (sign-in → authorize → consent → token exchange, against a database built from the committed dump). `app/(nosidebar)/oauth/token/route.test.ts` mocks `getAuth`, so it asserts our proxying and nothing about better-auth. Keep the flow test running all the way to an access token — each step is there for the rows it writes, and stopping at the first 200 skips exactly the INSERTs that break.
- When adding a new plugin (e.g. `sso()`, `dash()`), first create the necessary migration with `yarn migrate:make <name>`, then register the plugin.
- Plugins that expose admin or dashboard endpoints must be configured with explicit access control (e.g. `adminCredentials` or `adminRole`). Never register `dash()` without authentication gating.
- **Account identity is the mapped provider key `(provider, providerId)`, not `issuer`.** better-auth 1.7.3 restores the 1.6 lookup semantics: in `lib/services/auth/auth.ts`, better-auth's `providerId` maps to this table's `provider`, and its `accountId` maps to `providerId`; the adapter and the account domain (`lib/database/domains/account/`) resolve and link rows by that pair. Direct writes therefore omit `issuer`. `account_providers.issuer` remains a nullable compatibility column; retain it and the 1.7.0–1.7.2 migrations/backfills, but do not make new code depend on or populate it. OAuth, JWT, and two-factor issuer settings are separate and remain active.
- **Preflight the real database before a 1.7.3 rollout.** The committed schema already has a nullable `issuer` and no issuer-based unique index, but a deployment that was manually migrated through 1.7.0–1.7.2 may still carry the old constraint or index. Drain and remove every 1.7.2 auth-serving instance before 1.7.3 accepts writes or authentication traffic: 1.7.3 can write `NULL` `issuer`, which 1.7.2 sign-in cannot read, so route this as a coordinated cutover with no overlapping auth traffic. Inspect the actual constraints and indexes, and check for duplicate mapped provider keys `(provider, providerId)` before new pods serve traffic; resolve ambiguous rows before deployment because better-auth rejects lookups with more than one match. If the preflight finds a constraint or duplicate, stop the rollout and keep the current release serving until the data and schema change is complete and reversible. Keep operational SQL in the deployment runbook, not this guide.
- **Plan rollback separately.** A package-only rollback to 1.7.2 after 1.7.3 has written rows with `NULL` `issuer` can leave those rows unreadable by 1.7.2 sign-in. Preserve the nullable column for compatibility, and if rollback is required, restore issuer values for rows written while 1.7.3 served before handing traffic back; keep duplicate-key checks and constraint state aligned with the target release. Dropping the column is optional cleanup and should wait until rollback no longer matters.
- **`kyselyAdapter` must implement `consumeOne` and `incrementOne` natively, even though better-auth 1.7.3 supplies guarded fallbacks.** Both are race-safe primitives better-auth relies on for correctness, not speed: `consumeOne` backs single-use credentials (verification tokens, OAuth authorization codes, device codes) and `incrementOne` backs guarded counters (2FA failed attempts, rate limits, an authorization code's remaining uses). The factory fallback relies on conditional `deleteMany` or `updateMany` mutations guarded by the selected row's identity and snapshot values, plus an accurate affected-row count. That fallback is safe only when those adapter methods preserve those guards atomically. Keep the native methods so the caller's predicate is enforced in the mutating statement; they also return `null` for an empty predicate rather than consuming or mutating an arbitrary row.
- **The adapter runs on the application's Kysely instance (`getKysely()` in `lib/database/index.ts`) and keeps what better-auth stores exactly as before.** better-auth hands it `Date`s for its date fields and, on SQLite (`supportsBooleans: false` there), 0/1 for its booleans; SQLite stores those as INTEGER epoch milliseconds and 0/1, PostgreSQL as `timestamp with time zone` and `boolean` — the representations the rest of the app reads and orders by. Never let ISO text reach a SQLite timestamp column (better-auth's built-in Kysely adapter writes ISO strings there, which is one reason this one exists). `lib/services/auth/kyselyAdapter.storage.test.ts` pins every date and boolean column of every better-auth table on both backends.
- **Dates are hydrated by better-auth's field type, not by column name.** The Kysely driver reads every timestamp as epoch milliseconds, and the factory hands date values to better-auth unchanged (it turns strings into dates only for an adapter with `supportsDates: false`, which this one is not), so the adapter converts each column the schema declares `type: 'date'` into a `Date` — including the ones without an `…At` suffix: `oauthAccessToken.revoked`, `oauthRefreshToken.revoked`, `oauthRefreshToken.authTime` and `twoFactor.lockedUntil`. Refresh-token rotation revokes the old token with an `incrementOne` guarded by `{ field: 'revoked', operator: 'eq', value: null }`; the adapter renders `eq null` as `IS NULL` (and `ne null` as `IS NOT NULL`), because `= NULL` matches nothing.
- **The adapter's own rules stay in the adapter:** `accounts.email` is lowercased on every write and lookup, a new `passkey` row gets the serving host's rpID, a new session records the weekly login, `contains` / `starts_with` / `ends_with` escape `%`, `_` and `\`, and every session delete (sign-out, revoke, `consumeOne`) goes through `deleteSessionsWithTokenDetach` (`lib/database/domains/account/sessions.ts`), which detaches the session's OAuth tokens first so PostgreSQL's `sessionId` foreign keys do not reject the delete (23503).
- **`experimental.instrumentation` was introduced in better-auth 1.7.4 for OpenTelemetry distributed tracing and defaults to enabled.** This app disables it by default (`experimental: { instrumentation: { enabled: config.auth?.enableInstrumentation ?? false } }`) to prevent unexpected span creation and tracing overhead on authentication requests unless explicitly opted into via `ACTIVITIES_AUTH`.

<a id="agents-better-auth-database-joins"></a>

### Better-auth Database Joins

- **`advanced.database.joins` is ON (`lib/services/auth/auth.ts`), and answering every join is `kyselyAdapter`'s job — the fallback is a slower path, not a free one.** The flag lived at `experimental.joins` until better-auth 1.7 moved it here. On 1.6.x the factory forwarded `join` to `findOne`/`findMany` and read the related rows straight off what the adapter returned (`data[tableName]`), with no capability check and no fallback, so an adapter that ignored a join shape handed back a session with no user and **silently logged out every signed-in user**; 1.7's fallback turns a missing join into a per-request extra statement. Nothing in the adapter's own unit tests catches either — they call the adapter directly, so they never see the factory's transform. `lib/services/auth/sessionJoins.test.ts` drives the real better-auth instance against a real database and asserts the single statement; keep it passing.
- **A join key is the joined TABLE name, and the returned row must nest under exactly that key.** For this instance's model mapping, `join: { user: true }` on a session arrives as `{ accounts: { on: { from: 'accountId', to: 'id' }, limit: 1, relation: 'one-to-one' } }` — the columns are already resolved, so the adapter uses them as given.
- **Joined columns must be aliased before they are selected.** `sessions` and `accounts` both have `id`, `createdAt` and `updatedAt`; selecting both tables unaliased overwrites the session's own id with the account's, which is a worse bug than the missing join. The adapter selects each joined column as `__j<n>_<column>` and re-nests it — the prefix is short on purpose, because PostgreSQL truncates identifiers at 63 bytes and a truncated alias merges two columns into one.
- **Only `one-to-one` is folded into the base statement; anything else gets a follow-up query.** A `one-to-many` join carries a per-parent `limit` that plain SQL cannot express without window functions, and on `findMany` it would multiply the base rows and break `limit`/`offset`. The follow-up path is also the fallback for a table better-auth's schema does not describe — that path is always correct, so prefer it over a half-working join.
- The joined table's column list comes from better-auth's own schema, which is lossless: the factory's output transform reads only the model's schema fields plus `id` and drops everything else, so selecting exactly those matches what a `SELECT *` would have produced while keeping app-only columns out.
- **Session lookups run `WHERE token = ?` on every authenticated request** — `sessions.token` is indexed (`sessions_token_idx`) for exactly that reason. The older `(accountId, token)` composite cannot serve it: a B-tree led by `accountId` leaves a bare-`token` predicate to a sequential scan. Don't drop the single-column index on the grounds that the composite already mentions `token`.
- **`experimental.joins` was removed in 1.7 in favor of `advanced.database.joins` — it is not a compatible alias for the new key.** better-auth's options type accepts unknown keys, so a stale `experimental: { joins: true }` neither fails to compile nor warns; it just stops requesting joins, and every authenticated request quietly costs a second statement again. Check the option's location against the installed version's `advanced.database` on any better-auth upgrade.

<a id="agents-better-auth-session-refresh"></a>
<a id="review-better-auth-session-refresh"></a>

### Better-auth Session Refresh

- **A session may only slide forward where its cookie can be written.** A better-auth refresh does two writes together: it extends the `sessions.expireAt` row and re-issues the session cookie with a fresh `Max-Age` (`session.expiresIn`, 7 days by default). Server Components cannot set cookies, and route handlers that call `auth.api.*` directly drop the `Set-Cookie` the call produced, so a refresh in either place lands only the database write.
- **That is why `getServerAuthSession` passes `query: { disableRefresh: true }`.** Without it, every page render can refresh the row behind the cookie's back: the database keeps extending while the browser cookie keeps the `Max-Age` it got at sign-in, and the user is signed out when the cookie lapses, with nothing left to re-issue it.
- **Refreshes happen only inside better-auth's own `/api/auth/*` handler** (`app/api/auth/[...all]/route.ts`), which returns the cookie with the refreshed row so the two stay in step. Any endpoint there that resolves a session can do it (`/get-session`, authorize/consent, passkey, two-factor, …); the one the app relies on is `/get-session`, called by `SessionKeepAlive` (`lib/components/session-keep-alive.tsx`, via `refreshAuthSession` in `lib/client/session.ts`). It is mounted in the signed-in branch of `app/(timeline)/layout.tsx` and refreshes on mount, then at most once per `SESSION_REFRESH_INTERVAL_MS` while the tab is visible — on a timer, because the layout stays mounted across client-side navigation and a window that is never hidden fires no `visibilitychange`, and when the tab becomes visible again.
- Don't add a server-side session read that refreshes. That covers every `auth.api.*` call that resolves a session — not only `getSession`, but any endpoint behind better-auth's `sessionMiddleware` / `getSessionFromCtx` (e.g. `auth.api.getOAuthConsent`, `auth.api.listPasskeys`), which refreshes a due session the same way. Called outside better-auth's handler, such a call passes `disableRefresh: true` where the endpoint accepts it, or runs in a route handler that returns better-auth's `Set-Cookie` to the browser (`asResponse` / `returnHeaders`); a Server Component can do neither, so it must use `getServerAuthSession`. `lib/services/auth/sessionRefresh.test.ts` drives the real instance and checks both halves: a server-render read leaves a due session untouched, and `/get-session` extends it and re-issues the cookie.

<a id="agents-oauth-client-registrations"></a>

### OAuth Client Registrations

- **Never delete or expire rows in `oauthClient`.** Registrations created through `POST /api/v1/apps` are durable. Mastodon-API clients (Phanpy, Elk, Tusky, …) persist the `client_id`/`client_secret` they get from that endpoint indefinitely and only re-register when their stored copy is **missing** — so deleting a registration permanently wedges every client still holding it: it keeps presenting a `client_id` this server no longer knows and has no way to learn it must register again. A time-based cleanup does not help, because any finite TTL eventually deletes a live cached client; a client whose registration was deleted surfaces as `invalid_client` / `client_id is required`. The trade-off is that abandoned registrations accumulate: `createApplication`'s per-source throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so a default deployment does not bound them. Accept that, or add a guard that **rejects writes** — never one that deletes registrations.
- **A registration must write `oauthClient.clientCredentialsScopes`, and that is not the same column as `scopes`.** better-auth 1.6 validated a `client_credentials` request against the client's registered `scopes`; 1.7 moved the decision to this separate, server-owned column and denies the grant outright when it is missing or empty — `400 unauthorized_client` / `client has no authorized client_credentials scopes`. A native Mastodon client asks for an app token **before** it offers to sign a user in (with the credentials `POST /api/v1/apps` just handed it), so a registration without the column blocks login at that 400 in the token proxy's log. `createApplication` writes the column through `toClientCredentialsScopes` (`lib/services/oauth/clientCredentialsScopes.ts`); that module documents the derivation rule, why its reserved-scope filter is the only thing enforcing it on this path, and how it differs from 1.6 — read it there rather than re-deriving it, and do not simplify the filter away. Fixing the write path is **not sufficient on its own**: registrations are never deleted and clients cache their credentials indefinitely (see the bullet above), so every client already installed would stay wedged — the `20260828000000_backfill_oauth_client_credentials_scopes` migration (one of the migrations the baseline stands for) repaired the existing rows, with two gates of its own that refused public clients and clients not registered for the grant. This grants no new authority: an app token has no user, so only `OAuthAppGuard` accepts one — `apps/verify_credentials` and Mastodon's API account registration, itself gated on `registrations.open` — and every other guard requires an actor that an actor-less token never resolves.
- **An app token lives one hour, not the 7-day sliding window `accessTokenExpiresIn` configures.** It does not slide either (see [OAuth Access Token Sliding Expiry](#agents-oauth-access-token-sliding-expiry)). `createUserTokens` reads `m2mAccessTokenExpiresIn` for a grant with no user and this server does not set it, so better-auth's 3600s default applies. Unrelated to the scope ceiling above; it is the other thing about app tokens that reads wrongly from `auth.ts`.
- **An unknown `client_id` must fail at `/oauth/authorize`, not be forwarded to Better Auth.** Better Auth's authorize endpoint answers an unregistered client with `invalid_client` — before 1.7.10 with **`client_id is required`**, the same message it uses for a genuinely absent `client_id` and so very hard to read, and from 1.7.10 with `client not found` — and then redirects to the error page, so the failed login reads as if it silently did nothing (see **Auth Error Page** below). `app/(nosidebar)/oauth/authorize/page.tsx` validates the client (and its `redirect_uri`) up front and returns `notFound()`; keep that check ahead of the Better Auth delegation. Per RFC 6749 §4.1.2.1 an invalid `client_id`/`redirect_uri` must be reported to the user rather than redirected to the requested `redirect_uri`.

<a id="agents-oauth-access-token-sliding-expiry"></a>
<a id="review-oauth-access-token-sliding-expiry"></a>

### OAuth Access Token Sliding Expiry

- **A user's opaque access token lasts as long as its client keeps using it.** better-auth issues it with `accessTokenExpiresIn` = `OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS` (7 days, `lib/services/auth/constants.ts`), and every bearer guard — `OAuthGuard`, `OAuthGuardAnyScope`, `OptionalOAuthGuard` and `OAuthAppGuard` — slides `expiresAt` to now + that window when it accepts a request (`extendAccessTokenIfDue` in `lib/services/guards/OAuthGuard.ts`). The token lapses a full window after its last slide — so between 6 and 7 days after its last accepted request, because a request inside the once-a-day slide interval below does not write.
- **The slide is the only thing keeping any OAuth client signed in.** This server cannot issue refresh tokens: better-auth mints one only for the `offline_access` scope, which is not in this server's scope vocabulary. Mastodon clients would not use one anyway — Mastodon's own tokens never expire, so Ivory, Ice Cubes, Tusky, Phanpy, Elk and the rest store the token once. A fixed lifetime therefore signs every client out on schedule: the first request after `expiresAt` is a `401` (`token_expired`), which a client reads as "this account is gone". Don't remove the slide.
- **The `refresh_token` grant is neither advertised nor served.** `OAUTH_GRANT_TYPES` (`lib/services/auth/constants.ts`) is the single list behind better-auth's `grantTypes` (so `POST /oauth/token` answers `grant_type=refresh_token` with `unsupported_grant_type`), the `grantTypes` a new `POST /api/v1/apps` registration records, and `grant_types_supported` in both `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`. Advertising a grant no client can ever be issued sends discovery-driven clients after a token that never comes. Registrations written before the change still list `refresh_token` in `oauthClient.grantTypes`; leave them (see [OAuth Client Registrations](#agents-oauth-client-registrations)) — better-auth checks a client's `authorization_code`/`client_credentials` grant per request, which those rows still list, and the only path that re-validates a stored registration against the server list (its update-client endpoints) is unreachable for them. Supporting refresh tokens means adding `offline_access` end to end — scope vocabulary, consent, the reserved-scope filter in `clientCredentialsScopes.ts` — and adding the grant back here, not just re-advertising it.
- **Only a request the guard accepts slides the token.** `resolveTokenContext` checks the row, expiry and scope and hands back what the slide needs; each guard applies it only after its actor, moderation and confirmation checks pass. A token refused for scope or expiry, one whose actor no longer exists, and a suspended account's client polling into `403`s are never extended — otherwise the token would outlive the suspension.
- **Only user tokens on the opaque path slide.** App (`client_credentials`) tokens have no `userId` and keep better-auth's one-hour `m2mAccessTokenExpiresIn`; a JWT access token's `exp` is signed into the token and cannot be moved.
- **It writes at most once a day per token.** The guard only updates a row that has been in use for `OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS` since it was issued or last extended, through `database.extendOAuthAccessToken` (keyed on the token hash). A failed write is logged and the request still succeeds; the row is still due, so the next request retries.
- **Deleting a token is what ends it.** Signing an app out in Account & security → Sessions & apps (`/account/sessions`) and `POST /oauth/revoke` delete its rows, so a slide racing a revoke matches nothing. better-auth's soft revocation — the `revoked` column its session-delete hook stamps on tokens minted from a web session that is signed out or expires — is deliberately not honoured, by the guard or by the slide: as on Mastodon, signing out of the web does not sign apps out (see `deleteSessionsWithTokenDetach`). Honouring it would sign every client out when its user's web session lapses.
- **Every path that mints a user token uses the same window.** better-auth's grants read it through `auth.ts`; `issueAccessToken` (the token `POST /api/v1/accounts` hands back) reads it directly.

<a id="agents-auth-error-page"></a>
<a id="review-auth-error-page"></a>

### Auth Error Page

- **Failed auth/OAuth requests land on our own `/auth/error`, never better-auth's `/api/auth/error`.** `lib/services/auth/auth.ts` sets `onAPIError.errorURL` to `AUTH_ERROR_PATH` (`lib/services/auth/constants.ts`), and `app/(nosidebar)/auth/error/page.tsx` renders it. Better-auth's built-in page is a development affordance: in production it does not render at all — it 302s to `/?error=...&error_description=...`, dropping a failed sign-in on the home timeline.
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
- **A handler asks whether a token is an APP token by reading `userId`, never `currentActor`.** `OAuthAppGuard` leaves `currentActor` null in two unrelated cases: a genuine `client_credentials` token that has no user, and a user-delegated token whose actor it merely FAILED to resolve — the grant recorded no `referenceId` (see the fallback above) and `resolveAccountActorId` found no selectable actor, which happens when every actor the account owns is pending deletion (`selectAccountActor` skips those). Gating on `currentActor || !client` (as `registerViaApi` did) accepts that user as an app, letting them mint accounts and tokens. The guard therefore forwards `userId` on the handler context, and the route requires `userId === null`; a genuine app token has neither a user nor an actor. Do not re-derive "is this an app token" from the actor.

<a id="agents-an-unconfirmed-account-may-not-act"></a>
<a id="review-unconfirmed-accounts-app-tokens"></a>

### An Unconfirmed Account May Not Act

- **An account whose confirmation e-mail has not been clicked is refused with 403 on every surface behind the OAuth guard family, `AuthenticatedGuard`, and `AdminApiGuard` — bearer and cookie alike — and `isActorConfirmationPending` (`lib/services/guards/OAuthGuard.ts`) is the check.** This is Mastodon's `require_user!` rule ("Your login is missing a confirmed e-mail address"), and it matters because `POST /api/v1/accounts` hands out a real 7-day user access token the moment an account is registered. `POST /api/v1/apps` is unauthenticated and its throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so without this an anonymous party could script fully usable accounts — posting, uploading, following, federating — for addresses nobody has proven they control. **The gate exists only where `config.email` does:** with no e-mail configured `registerAccount` mints no `verificationCode` and `createAccount` writes the account pre-verified, so registration still hands out a working token exactly as before. That is inherent — an instance that cannot send mail cannot demand confirmation — but it means this mitigation is conditional on an optional setting. The token is still issued, exactly as Mastodon issues it; what changes is that it is not a working credential until the address is confirmed. `OAuthGuard`, `AuthenticatedGuard`, and `AdminApiGuard` enforce `isActorModerationBlocked` and `isActorConfirmationPending`, answering 403 when an actor is suspended or its account is disabled or unconfirmed.
- **Confirmation is read from `verificationCode` AND `emailVerified`, never from `verifiedAt`, and none of that is a style choice.** `verificationCode` says a code is outstanding; `emailVerified` is better-auth's own column, which `requireEmailVerification` has gated credential sign-in on since 2026-03-20. An account better-auth already treats as verified is not held pending here either — that grants nothing new and is what grandfathers the cohort the buggy backfill created (below). `accounts.verifiedAt` originally carried `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`, dropped in `drop_accounts_verifiedat_default`), so `createAccount` could not leave it unset by omitting it: the database stamped `now()` on every pending registration, and `canCreateSessionForAccount`'s `verifiedAt` test has consequently **never fired**. A check keyed on `verifiedAt` is a no-op that reads as a working gate — `serializeAdminAccounts`' `confirmed` field reads the predicate for the same reason, never `verifiedAt`. `createAccount` now writes an explicit `verifiedAt: null` for a pending registration, so that column is accurate for anything created from here on — but rows written before that still carry the default, so `verifiedAt` covers nothing on its own and the other two columns carry the whole answer. `verificationCode` is set once at registration, cleared to `''` by `verifyAccount`, and never set at all on an instance with no e-mail configured.
- **The credential sign-in path was never open FOR AN ACCOUNT REGISTERED AFTER 2026-03-20, which is why this is mostly a token-path fix.** better-auth's own `emailAndPassword.requireEmailVerification` reads `accounts.emailVerified` — a different column, which `createAccount` correctly leaves false — and answers `403 EMAIL_NOT_VERIFIED`. **Older accounts are the exception, and it is not a small one:** `20260320072514_better_auth_columns` populated that column with `whereNotNull('verifiedAt')`, and `verifiedAt` was non-null for every row because of the same default, so the backfill declared EVERY account of that era verified — pending ones included. Those accounts have been signing in with a password ever since. That cohort is grandfathered by the predicate itself, which reads `emailVerified`, so the guard never refuses an account that better-auth already admits. `20260828140000_clear_stale_verification_codes` then brings the two columns into agreement so a reader of the row is not misled — it is a TIDY-UP, not the mechanism, and its bound decides only whether a stale row is tidied, never whether anyone keeps access. A repair keyed on when a migration ran is not the mechanism (a filename timestamp no deployment coincides with; a batch comparison that is also true whenever the migration is merely first in a new pass) — the predicate carries the bound instead. Do not read the sentence above as covering the whole account table. Both columns are on the domain `Account`, and the guard reads both — that pairing IS the mechanism, not an accident to be simplified away. Removing `emailVerified` from either the schema or the predicate re-locks out the cohort with no way back, which is why this is written as an instruction rather than a description.
- **`unconfirmedAccount: 'allow'` is the one carve-out that lets an unconfirmed account act AS ITSELF, and it exists for exactly one endpoint.** `POST /api/v1/emails/confirmations` resends an account's own confirmation e-mail, so refusing it for being unconfirmed makes the state unrecoverable for a client that lost the message — Mastodon carves out the same controller (`Api::V1::Emails::ConfirmationsController` never calls `require_user!`). It relaxes the confirmation test and **nothing else**: `isActorModerationBlocked` still runs, so a suspended actor or a disabled account is refused there too, and the handler applies `isAccountConfirmationPending` itself. That handler check must be the PREDICATE, never the raw `verificationCode` column: the two disagree for the backfilled cohort, and because this route is bearer-reachable with `write` while the flow that proves an address is cookie-only, reading the raw column let a client token re-point a confirmed account's address and take the account over. The guard admits any account here; the handler alone decides, on the signal every other surface uses. Do not add a second consumer without the same argument.
- **`allowModerationBlocked` is the carve-out on `AuthenticatedGuard` for restrictive session and connected-app revocations.** `DELETE /api/v1/accounts/sessions`, `DELETE /api/v1/accounts/sessions/[id]` (keyed by `sessions.id`, never the session token, which is the cookie credential and must not reach a URL, a trace or the browser), and `DELETE /api/v1/accounts/connected-apps/[clientId]` pass `allowModerationBlocked: true` so a legitimate account owner can terminate attacker sessions and revoke authorized OAuth apps during compromise containment even if the account is disabled or an actor is suspended. Revocation only ever _reduces_ capability (destroying sessions and tokens) and cannot post, follow, or federate on the platform. It relaxes `isActorModerationBlocked` only; CSRF same-origin proof and `isActorConfirmationPending` remain strictly enforced (unconfirmed accounts are still refused with 403).
- **Account-level actor endpoints (`actors/switch`, `actors/cancel-deletion`) authenticate the session's account directly rather than fronting an arbitrary `currentActor`.** `POST /api/v1/actors/cancel-deletion` operates on the target `actorId`, so gating on the session's selected actor would 403 whenever another actor on the same account is suspended (and fail if the only active actor is pending deletion). Like `switch`, it validates same-origin CSRF proof, resolves the account via `getAccountFromSession`, enforces `isAccountConfirmationPending`, and checks that the account owns `actorId`. It also refuses (403) when the **target** actor is suspended: the admin hard delete (`DELETE /api/v1/admin/accounts/:id`) requires suspension, marks the actor `scheduled` and only then enqueues the job, which exits if the status is no longer `scheduled` — so a suspended owner cancelling would win that race and undo the moderator's decision. A disabled account, or a different suspended actor on the same account, does not block it.
- **`OptionalOAuthGuard` neither refuses nor accepts such a token — it DOWNGRADES it to the anonymous path** (`unconfirmedAccount: 'anonymous'`), which is a third answer and not a second use of the carve-out. Both alternatives are wrong there. Refusing made presenting a valid token FAIL a public read — `timelines/public`, `statuses/:id`, search — that succeeds with no `Authorization` header at all; a token must never make a request worse than sending none. Accepting the actor hands an unverified account real capability rather than "just public reads": `canActorReadSingleStatus`'s `isDirectRecipient` lets it read direct messages addressed to it, and `search`/`accounts/lookup` gate `resolve=true` on a non-null actor, so it can drive outbound WebFinger and signed remote fetches from this instance. **Mastodon is not a precedent for granting those** — its search controller applies `require_user!`, so an unconfirmed account never reaches `resolve` there, even though `authorize_if_got_token!` is otherwise the model for this guard. Suspension stays global on the same guard, so `isActorModerationBlocked` still refuses.
- **The check costs no query.** `verificationCode` is already on `actor.account` in both resolution paths — `getActorFromId` loads the account row for the bearer path and `getActorsForAccount` does for the cookie path — which is the same reason `isActorModerationBlocked` can read `account.disabledAt`. An actor with **no** account is left alone, the direction `isActorModerationBlocked` also fails in; the only accountless local actor is the federation signing actor, which never authenticates.
- **`Account.verifiedAt` is `.nullish()`, not `.optional()`, and `SQLAccount.verifiedAt` is nullable to match.** Both row-to-domain mappers hand the column through as a literal `null` (`getActor` writes one explicitly; `toDomainAccount` spreads the raw row, whose conditional override is a no-op for null), so `.optional()` makes `Actor.parse` throw the moment the column really is null — the first request by an unconfirmed actor 500s rather than loading. The column default is what hides that.
- **Existing accounts are grandfathered by the PREDICATE — `isAccountConfirmationPending` reading `emailVerified` — not by the migration and not by leaving `verifiedAt` alone.** Nothing backfills `verifiedAt` — so on its own the `verificationCode` half of the check still reaches every legacy pending account, and for the pre-2026-03-20 cohort described above that meant losing a working password login with no way back (the resend endpoint needs a credential, which is what is being refused). `isAccountConfirmationPending`'s `emailVerified` half is what actually grandfathers them; the migration only tidies the row. For an account registered after that date, the only tokens the gate withdraws are ones minted through the hole being closed — `registerViaApi` is the sole path that mints a user token for an unconfirmed account, since credential sign-in is refused and the authorize flow needs a session.
- **The `verifiedAt` column has no default (the `drop_accounts_verifiedat_default` migration, one of the migrations the baseline stands for, dropped it; on SQLite it rebuilt the table).** All **seven** tables carrying a foreign key to `accounts` on both backends (`actors`, `oauthClient`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `passkey`, `twoFactor`) and all four indexes on `accounts` survived the rebuild (`lib/database/testing/schemaInvariants.test.ts` pins the missing default, the foreign keys and their delete rules, and the indexes on both backends). Count these referencing tables by matching case-insensitively and on both quoting styles: `actors` is emitted as `CREATE TABLE IF NOT EXISTS "actors"` with uppercase `REFERENCES`, so a grep written for backticks and lowercase silently reports six. Existing rows were deliberately NOT backfilled: accounts created before the explicit-null fix keep their defaulted value so confirmed status is not altered retroactively.

- **A re-point clears every proof about the old address, in the same write.** `repointUnconfirmedAccountEmail` writes the rotated code, `emailVerified: false`, `verifiedAt: null` and `emailVerifiedAt: null` together, because each proves control of the address it was set for and none may outlive it. The state change is a predicate on the UPDATE statement (`verificationCode` non-empty, `emailVerified` false/null) rather than a decision taken from a read in front of it, and the method re-reads the row to return `Account | null` so the caller distinguishes "no such account of yours" (404) from "no longer pending" (403). Clearing the code alone is not enough for the backfilled cohort: those rows are not pending (the predicate reads `emailVerified`), so a re-point moved their address to an arbitrary one while they stayed verified, and BOTH OIDC surfaces then asserted a verified address to any relying party that links accounts on the claim. They did so by different routes, and the difference is the whole reason clearing the flag works: the id_token (`lib/services/auth/auth.ts`) reads `emailVerified` and asserted it directly, while `/oauth/userinfo` admitted the request because such a row is NOT pending (`Boolean(code) && !emailVerified` is false while the flag stands). Clearing the flag closes both: it makes the account pending, and `isActorConfirmationPending` then 403s before the serializer runs. The confirmations route writes before it sends and answers 500 on a send failure, so a genuinely pending account whose mail fails at that moment must resend to recover. (A backfilled-cohort account cannot reach that write at all — the handler 403s it — so this cost is not theirs.) And `verifyAccount` restores `verifiedAt`, `emailVerified` and `emailVerifiedAt` when the new address is confirmed, so an account that re-points an unconfirmed address recovers every verification proof — including the `/account/email` "Verified" badge — upon confirmation.

<a id="review-runtime-vs-build-time-configuration"></a>

### Runtime vs. build-time configuration

- CSP sources that follow runtime config are computed per process in
  `lib/utils/http-headers/csp.ts` from `getSecurityHeaderConfig()` and added only
  while the feature is on. The photo editor's subject model
  (`ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL`, `lib/config/photoEditor.ts`) adds its
  download origins to `connect-src` (by default `https://huggingface.co` and
  `https://*.hf.co`, the CDN its `resolve` URLs redirect to; a self-hosted base
  adds its own origin only) and `'wasm-unsafe-eval'` to `script-src` for the
  onnxruntime WebAssembly, the same keyword Apple MapKit needs (listed once when
  both are on); `off` adds neither. `proxy.ts` builds the CSP in the Edge
  runtime, so these config modules are imported by sub-path and must not import
  Node APIs or the logger: `lib/config/photoEditor.ts` reports an invalid value
  through a callback, and only the `@/lib/config` barrel's
  `getPhotoEditorConfig` logs it.

The summary rules live in
[AGENTS.md → Runtime Configuration Guidelines](../AGENTS.md#runtime-configuration-guidelines).

<a id="review-logging"></a>

### Logging

- The `console.*` ban is lint-enforced in `app/` and `lib/`.

The full rules live in
[AGENTS.md → Logging Guidelines](../AGENTS.md#logging-guidelines).

<a id="review-post-media-layout"></a>

### Post media layout

#### Feed framing below `md`

- **Feed framing is breakpoint-scoped and owned by the element that renders the
  feed's outer frame**, through `MOBILE_FEED_SURFACE_CLASS` in
  `lib/components/posts/feedLayout.ts`. Below `md` that element spans the
  viewport, cancels the enclosing shell's horizontal padding, and drops only
  its outer border and corner rounding; the post separators
  (`divide-y`), the article's `px-4` text inset, and the borders of nested
  content-warning, quote, link-preview and fitness cards all stay. Apply it to
  the frame owner — the feed, its loading skeleton, its empty state, and the
  home composer — and to it alone: `Posts` always draws the frame. The margin
  is deliberately `calc(50% - 50vw)`, not a fixed `-mx-4`: the shared `/` loading boundary renders under both the signed-in
  `px-4` column and the raw logged-out landing branch with no padding, so a
  fixed gutter overflows the viewport in the second one. `max-md:w-auto` is
  load-bearing — with `width: 100%` the negative margins only shift a `w-full`
  frame left instead of widening it. Explore and Search do not wrap their posts in a
  card: the posts frame is the post list frame itself, with no `backdrop-filter`
  (which would make it the containing block for the `max-md:fixed` edit-history
  panel) and no `overflow-hidden`, so embedded posts' non-portalled overlays
  escape. `PublicShell` and its top bar and footer drop
  their 680px reading-column cap below `md` (`max-md:max-w-none`) so the page's other
  content and chrome stay aligned with the full-bleed feed below `md` (the
  frame margin already reaches the viewport edges either way).

#### Strip layout and alignment

- A status's media is **one attachment at its own size, or a horizontally
  scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
  this for every surface that renders a post. The media row is never narrowed
  to achieve alignment: a lone picture keeps its own aspect ratio and sizes
  naturally at `min(100%, Npx)`, scaled by WIDTH — a wide one spans the message
  column, a narrow one keeps its own width on the text's left line — and the
  strip keeps its item widths, gaps and snapping. No ancestor may clip the row.
- **A visual attachment scroller bleeds out to the owning feed frame's inner edges at every
  breakpoint so cards can scroll beneath the avatar mid-scroll, but at rest and initial scroll position, the media aligns with the post text's left line.** `Attachments` pulls the
  row out by `--post-media-bleed-left` / `--post-media-bleed-right`, whose
  defaults (`4.25rem` / `1rem`) describe the 40px avatar, 12px gap and the
  article's 16px inset. Below `md` the owning frame is the screen edge (except
  a logged-out status page, whose frame is its inset thread card); from
  `md` up it is the feed card's inner edge. (The logged-out landing feed is a
  framed feed like the others: a `rounded-lg border` card in the column's
  `md:p-5` gutter, full-bleed below `md`.) **The media column tracks the message column, not the avatar and not
  the frame edge**: the same `--post-media-bleed-left` and
  `--post-media-bleed-right` that pull the row out are also the strip
  scroller's `padding-left` / `scroll-padding-left` and `padding-right` (and
  the lone picture row's both paddings), so the first card rests on the text's
  left edge, any card that snaps settles onto it — `x proximity` only snaps
  when the reader stops near one — and the scroll can only reach until the last
  card's right edge meets the text's right edge. The full-bleed row still lets
  cards travel out to the frame edge,
  beneath the avatar, mid-scroll. A nested override and the column are two
  sides of the same variables: the content-warning card's `px-3` override
  carries the cards to its own inset text column. Captions align with their own card — the card
  already sits on the text line. The strip's overlay arrows are positioned
  against the media row itself, not the text column, so they sit at the row's
  frame edges.

#### Corner rounding

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

#### Strip chrome: captions, arrows and the position counter

- The gallery uses 240px image boxes, 12px gaps, aspect-ratio-based card widths
  with a 160px minimum and 78% maximum, and `scroll-snap-type: x proximity`.
  Captions sit below their images, preserve line breaks and custom emoji, and
  clamp independently to three lines. While the strip overflows (two or more pictures), the strip has
  overlay chrome rather than a row beneath it: a 40px circular arrow in a 44px
  hit area sits over each edge (6px in from the row's edge, `Previous media` on
  the left, `Next media` on the right), each over a 64px gradient scrim that
  fades the media under it. A scrim is drawn only on a side that has more
  content. A position counter `N / M` sits at the top right, `aria-hidden`
  because the strip's group label already names the count. Both arrows stay
  mounted while the strip overflows. An arrow at its edge is `aria-disabled`,
  invisible (`opacity-0`, `pointer-events-none`) and removed from the tab order
  (`tabIndex={-1}`), and its click is a no-op. If the focused arrow reaches its
  edge, focus moves to the opposite arrow so keyboard focus is never dropped to
  `<body>`. The arrows unmount only when the strip stops overflowing (for
  example after a resize), and that case does not hand focus off. Each click
  advances exactly one adjacent card — landing it on the text line through the
  `scroll-padding-left` inset — using the first boundary in the requested
  direction when the user is between cards, and clamps at either end. While layout is still pending and no card boundary
  exists yet, a press falls back to one visible width (`clientWidth`) in the
  requested direction. Scrolling stays smooth unless reduced motion is
  requested.
- The counter names the 1-based card the strip is on. At the end of the strip
  it is the last card, so it reads `N / N` exactly when the forward arrow is
  disabled. Otherwise it is the first card whose left edge has reached the
  viewport's left edge, within a 4px tolerance; a card still partly scrolled
  off to the left counts as passed. It re-reads on scroll, on resize, and when
  the item widths change without a scroll event.

#### Lazy loading and the eager first image

- **There is no item cap and no `+N` overlay** — scrolling reaches everything —
  so anything the strip renders unboundedly needs a deferral: images pass
  `loading="lazy"`, videos `preload="none"` (`loading` is image-only) — but only
  a video carrying a `poster`. A posterless one shows nothing at all when
  deferred, since its only pre-playback frame comes from the `#t=0.01` fragment,
  and federated video never has a poster. A lone picture or video is
  deliberately eager, being the post's largest element. Re-adding a cap hides
  media the post actually carries.
- **One image per page is the exception: the first visible media is revealed
  immediately (`revealImmediately`) and, where it would otherwise be lazy,
  loads eagerly; everything else stays lazy.** It is the likely largest
  contentful paint, and only one image per page may claim it.
  `Posts` takes `prioritizeFirstMedia` (default `false`) and the surface whose
  list is its first visible content opts in: the landing feed, the hashtag
  page, and the profile Posts tab only when the profile has no cover image
  (the cover is then the LCP). The prioritized image
  is the first ordinary image (not a video or animation, not behind a content
  warning) among the list's first three rows. A `focused` status (the status
  detail page) always prioritizes its first image. A public album page
  reveals its hero cover; `GalleryGrid` gets `prioritizeFirst` only when
  the album has no cover. `loading="eager"` is set only where the image would
  be lazy (the first tile of a multi-attachment strip, grid tile 0); a single
  image keeps the browser default. Search, gear, fitness and other pages with content
  above the list never opt in. `revealImmediately` on `Media` (and
  `fetchPriority="high"`, used by the activity map preview) skips its
  opacity-until-hydration gate: the real LCP win is that paint gate, not fetch
  order. Do not add `fetchPriority="high"` to post or album images: those are
  already eager with a preload link, so it brings no fetch speedup, and it makes
  Lighthouse's simulated LCP count the large image, inflating modeled mobile
  LCP. The landing hero watermark is likewise `loading="eager"` only.

#### Media types: filtering, video and unknown dimensions

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
  visual attachment, videos included. The sensitive-content gate applies:
  `ContentWarning` mounts nothing while collapsed, so no `<video>` exists, and no
  request is made, until it is expanded.
- **A stored dimension of `0` means "unknown", not "zero pixels"** — several
  media-storage paths persist `metaData.width ?? 0` — so every read goes through
  `getMediaGeometry`, which also clamps pathological shapes and falls back to a
  4:3 box so blurhash has something to reserve.

#### Focus indicators and scroll plumbing

- **A media button's focus indicator is an `outline` with a NEGATIVE offset,
  never an outset ring.** The strip's own `overflow-x-auto` clips an outset
  ring, and the media box can still reach the frame's inner edge — a wide lone
  picture's right edge, and every strip card while it is being dragged — where
  `main`'s `overflow-x-clip` cuts the ring's outer edge off below `md`. An
  inset `box-shadow` does not work either — it paints beneath content and the
  button's only child is an opaque image. `Attachments` uses one spelling for
  both shapes; it is pinned by a test.
- `useMediaStripScroll` measures the strip's own container, never a viewport
  breakpoint, through a **callback** ref because the strip is conditional. Its
  `contentKey` must describe item WIDTHS, not their count: the observer watches
  the container, which does not resize when an edit swaps a panorama for a
  portrait.
- `no-scrollbar` belongs only on a row that carries its own overflow affordance.
  The utility is defined in `app/globals.css` for exactly those rows; the emoji
  and reaction pickers' category rows carry no such affordance, so they keep a
  plain scrollbar.

#### Composer attachment tiles

- The composer's attached-media tiles (`composer-attachment-tiles.tsx`) are
  never a grid either: one horizontally scrolling row of fixed-width
  (`w-36`/`sm:w-40`) `flex-none` tiles. The row carries the status strip's own
  affordances, which is the only reason it is `no-scrollbar`: it uses
  `useMediaStripScroll` and the shared `MediaStripEdges` (edge fades and the
  Previous/Next media arrows, the same tab-order rules), and snaps like the
  strip (`snap-x snap-proximity`, `snap-start`). Its `contentKey` is the tile
  count, which is right only because the tiles are fixed width. The scroller
  clips both axes, so it pads its top and right by 12px (`pt-3 pr-3`, with
  `scroll-pr-3` so a focused tile leaves room): the Remove button sits 8px
  outside its tile's top-right corner and its focus outline needs the other
  4px. The top padding is also the 12px gap above the row (no margin). The
  tile's focus indicator is an inset outline
  (`outline-2 -outline-offset-2 outline-ring`), for the same clipping reason
  as `MEDIA_FOCUS_CLASS`. The list is `role="list"` named `Attached media`
  however many tiles it holds. A new upload (uploading, uploaded with a client
  key, or failed) scrolls the row to the end without moving focus; an edit's
  media, which load after the first render with none of those, leave it at the
  first tile. `scroll-pl-16` keeps a snapped tile clear of the left fade and
  Previous arrow, as the status strip's `scroll-pl` inset does.

<a id="agents-offline-first-pwa-launch-timeline-caching"></a>

### Offline-First PWA Launch & Timeline Caching

- **Network-independent launch shell at `/app` with legacy root fallback.** The standalone Progressive Web App entrypoint is configured in `app/manifest.ts` with `start_url: '/app'` and `scope: '/'`. Navigating to `/app` renders `app/(nosidebar)/app/page.tsx` (`OfflineAppShell`), which is completely decoupled from initial server-side timeline fetching and mounts a client-driven timeline viewer directly from IndexedDB. When navigating to `/` with an existing active account in IndexedDB (`activities_offline_v1`), the Service Worker (`public/sw.js`) serves the pre-cached `/app` shell to allow instant offline startup without waiting for an SSR response.
- **Service Worker atomic shell staging, static asset caching, and RSC bypass.** `public/sw.js` stages shell resources atomically under `activities-shell-<buildId>`, caching the shell document and required pre-rendered bundles during installation before swapping the active cache on activation. All Next.js static assets (`/_next/static/*` and subpath-prefixed `/activities/_next/static/*`) are handled via a Cache-First strategy. To prevent caching transient React Server Component payloads or corrupting App Router navigation states, the Service Worker strictly bypasses caching for any request carrying the Next.js RSC header (`RSC: 1`) or query parameter (`?_rsc=`). The worker itself (`/sw.js`) is served with `Cache-Control: no-cache, no-store, must-revalidate` injected by `proxy.ts` so updates are discovered immediately on browser checks. Same-origin avatar and media images are cached separately in a bounded LRU cache (`activities-media-v1`) capped at 150 entries. The worker ignores every cross-origin request (remote avatars, federated attachments, link preview images): a `fetch()` from the worker is checked against the worker's own CSP `connect-src`, which does not list remote hosts, so re-fetching them there would block them all. The browser loads them directly under the page's `img-src`.
- **Service Worker navigation fallback.** Every other same-origin GET navigation that is not `/app` or `/` goes network first: `event.preloadResponse` (navigation preload, enabled on activate) or `fetch(request)`. Only a rejected fetch falls back; an HTTP error or a redirect is returned as it is. `/api/` and RSC navigations are never cached or stood in for, but are still answered from the preload (else one `fetch`), because a navigation left to the browser after preload is requested twice and a one-time OAuth callback must reach the server once. The cached app shell stands in for `/drafts` (and `/drafts/`) alone, and only when `hasActiveOfflineSession()` and a cached shell exist (`OfflineAppShell` then renders the drafts list). Every other path, `/auth/*`, `/oauth/*`, `/admin/*`, settings and status pages included, gets `offlinePageResponse()`: a static "Not saved for offline" page sent with `Cache-Control: no-store`, with links to Drafts and Home, that carries no personal data and never shows app chrome (inside the shell, an in-app link to such a page shows the same notice in the shell's chrome). Only the shell's unavailable view reloads into the real page once the connection returns (it probes once on mount, as the store starts out online and would otherwise never see a server that is down while the device says online): the timeline and Drafts views are drawn in full (Drafts from this device), so they stay put and send the queue, and a reload there would only cut off a send it had started. A send cut off by the unavailable view's reload resumes after its lease under the same key. The worker caches no HTML other than the staged shell. A future Background Sync sender would run inside the worker, so it would need the storage origin in the worker's `connect-src` (the worker's fetches are checked against its own CSP, which names only our own and storage origins today).
- **IndexedDB schema, partitioning, bounded retention, and cleanup.** Offline persistence uses IndexedDB (`lib/client/offline/offlineDb.ts`) under database name `activities_offline_v1` across four stores: `meta` (active actor pointer, client configuration, and schema version), `bootstrap` (cached actor profile, instance metadata, and user preferences from `GET /api/v1/accounts/bootstrap`), `statuses` (normalized status records keyed by canonical ActivityPub URI `status.id`), and `timelines` (ordered status id lists partitioned by `[actorId, timeline, filterKey]`). Retention is strictly bounded: the offline cache keeps at most 200 statuses per timeline (trimmed only when saving, by `trimSegmentsToMax`, which also moves the cut segment's cursor to the last post it keeps; the on-screen list is not capped, so infinite scroll keeps loading older posts past 200), and metadata is preserved for at most 3 recently active actors. Logging out via `SignOutDialog` (invoking `useSignOut`, shared by the account menu's Sign out and the Sessions page's `LogoutButton` / "Sign out of this device") triggers a full wipe of `activities_offline_v1` via `clearAllOfflineData()` to ensure no private account or status data persists across user sessions.
- **Contiguous segment tracking, gap resolution, and scroll restoration.** Timelines are assembled from contiguous status segments using `lib/client/offline/mergeTimelineSegments.ts`. Non-contiguous segments render a `TimelineGapRow` that lets users fetch missing slices. To prevent browser scroll jump during offline hydration and dynamic segment insertion, automatic scroll restoration is disabled in favor of manual management (`history.scrollRestoration = 'manual'`). When the reader is in the top zone above the feed (the first post's `top > 80`, sitting below the sticky header even if scrolled slightly into the composer), `scrollAnchor` is recorded as `null` ("top-zone snap") so reloading or reopening at the top refreshes at the top without anchoring the old first post and pushing new posts off-screen above the viewport. A saved scroll anchor is restored only if the cached statuses hold it and it is not a top-of-feed anchor (`getOfflineTimeline` returns `scrollAnchor: null` otherwise), and is cleared after the reader loads more or jumps back to the top, so a reload after scrolling past post 200 starts at the top of the cached posts. Background and foreground reconciliation uses `POST /api/v1/statuses/reconcile` to batch-verify cached status states (re-checking deletions, boost counts, and favorites against the server) and `GET /api/v1/accounts/bootstrap` to keep actor and instance metadata synchronized.

- **On-device drafts (`activities_drafts_v1`).** What a reader types in a composer is saved on this device, in its own IndexedDB database (`lib/client/drafts/`, imported from the `@/lib/client/drafts` sub-path, never the `@/lib/client` barrel, so the explicit `@/lib/client` mocks in composer tests keep working). Three stores: `drafts` (indexed by actor and by account), `blobs` (attachment bytes, indexed by draft) and `meta` (one sign-out epoch per account).
  - **A separate database, on purpose.** `clearAllOfflineData()`, the 3-actor LRU and `public/sw.js` never open it, so a session expiry (401) or a cache wipe keeps the drafts. Nothing in the module calls `deleteDatabase`: a failed, blocked or slow (over 5 s) open is a `DraftsUnavailableError` and the next call retries, because deleting the database to recover would delete the drafts. Schema upgrades only add stores or indexes.
  - **Revision and epoch.** Every save is one transaction that checks `expectedRevision` (a stale tab, or a draft deleted elsewhere, gets `DraftConflictError`). The tab then stops: it shows "Not saved, copy your text" with "Copy text", stops autosaving that draft, blocks Post (the checkpoint below cannot be written), never writes the other tab's record and never makes a copy, so it can neither overwrite a newer save, resurrect a deleted draft nor send a post twice under a new key. Emptying the composer (no text, attachments, CW, poll choice or fitness file), Discard or Cancel unlocks it: the composer lets go of the draft without touching the other tab's record, its bytes or the server media it uses (removing a photo or fitness file that this tab's last stored revision holds deletes nothing on the server until a later save of this tab lands without it, `deferServerDelete()`, so after a conflict it is never deleted, since the other tab's record or the post it sent may still need it; one uploaded since that save goes through the guarded delete below at once), and its next content starts a new draft that posts under a new key (`onUnlock` drops the composer's key, also when the emptying save is the one that finds the newer revision). A composer's deletes are checked the same way (`deleteDraftIfRevision`): emptying the composer, `release()` after a send and Discard delete only the revision this tab saved, so a newer revision another tab saved stays (an emptied composer leaves it to that tab and starts a new draft with its next content). Saves also check the account's epoch (`DraftSignedOutError`: a debounced save that lands after sign-out deleted everything is refused inside the transaction). `BroadcastChannel('activities-drafts')` carries `changed`, `signing-out` and `sign-out-cancelled` between tabs; without it, tabs re-read on `visibilitychange`. Tests stub `BroadcastChannel` (`lib/testing/fakeBroadcastChannel.ts`) because Node's is shared across worker threads.
  - **Composers.** `useComposerDraft` (PostBox and StatusReplyBox) debounces autosave (800 ms), flushes on `visibilitychange` to hidden, `pagehide`, unmount and close, and is a no-op without a `DraftsProvider` or while editing a published post. The pre-fill of a reply is not text worth keeping. Closing a reply or quote that has text keeps the draft and shows the "Saved to Drafts" note (`SavedToDraftsNote`, `role="status"`, hides after 6 s) whose Discard deletes it; Discard refuses (and says "Changed in another tab") when the stored revision is no longer the one that was kept, because another tab edited the draft. When the close cannot keep the draft (storage full or blocked, a draft another tab saved, locked or deleted, another tab signing out, or a reopened draft whose bytes are still loading), the note reads "Couldn’t save to Drafts" instead (`NotSavedToDraftsNote`, `role="alert"`, imported statically so it renders offline) with "Copy text", and stays until dismissed, so closing never drops the text silently: a second failure adds its text to the same note, and a later "Saved to Drafts" note waits until it is dismissed. A draft whose record saved but whose photo bytes did not is kept (the inline status already says so). The home composer also shows "N drafts · Open".
  - **Drafts keep their attachment bytes until the post is sent or the draft is deleted.** Bytes are stored as `ArrayBuffer` + MIME type (never a live `File`/`Blob`, because of WebKit's Blob-in-IndexedDB bug), and stay after the upload id exists (`hasBlob` stays true) as the draft's own copy of the attachment. A reopened draft reuses the uploaded media id as it is while the server still has it (keeping the submit key), and rebuilds an attachment from the bytes only when it has no media id; noticing a server copy that has gone missing is the job of the pre-flight attachment check, not of a re-upload. Only a confirmed send (`release()`) or Delete removes them. A storage quota problem is never silent: the line under the text area reads "Not saved, copy your text" with a "Copy text" action (`DraftSaveStatus`; the only state that is announced, as a newly inserted `role="alert"`), and it covers a failed blob write too. A draft owns only the media its composer uploaded (`owned`); leaving the composer with a saved draft skips the unmount cleanup that would delete the media, every composer delete of media goes through `deleteUnpostedMedia` and of a fitness file through `deleteUnpostedFitnessFile` (`?if_unposted=true`), so the server keeps (422) anything a post uses, such as a draft another tab sent; removing an upload the stored draft holds (one a reopened draft came with, say) defers the same guarded delete (a removed fitness file clears from the composer at once, and its deferred delete is silent). The delete runs on the next save of this tab that lands without the upload (a send's checkpoint counts as such a save), because a tab holds the newest revision only after its own save succeeds (until then another tab may have saved a newer revision that still holds the upload, and composers do not follow other tabs' saves), and from then on a copy of the draft in another tab conflicts at its next save or checkpoint, so it can never post what was removed. Discard and Delete instead remove the stored record's own media with `deleteUnpostedMedia` (the server refuses media a status uses) and a fitness file with `deleteUnpostedFitnessFile` only if no create was ever attempted, through `deleteDraftAndOwnedMedia`. A conflict, a sign-out, or finding the record already gone (another tab sent or discarded it, and may still be attaching the upload) deletes nothing. These deletes are best effort: if the tab closes before the save lands, or a delete fails, the upload stays on the server and can be deleted from Settings → Media (or Fitness → Files for an activity file); Gallery never lists it, as it has no attachment and no `galleryAddedAt`. A locked draft's media belongs to the post the server kept.
  - **Checkpoint before send.** Before a create goes out, the composer writes `attemptedAt` and the `Idempotency-Key` in use (`submit: { key, fingerprint }`) to the draft, and awaits it. A lost response plus a lost key would otherwise send the same post again under a new key after a reload. A conflict on that write (another tab saved, locked or deleted the draft) stops the composer as above and the post is not sent ("This draft was changed in another tab, so nothing was sent. Copy your text, then clear the box to start a new draft."); it can be sent once the composer is emptied and the post written again as a new draft. The conflict Alert has no Retry (trying again can only block again) and clears once the composer is emptied. If that write fails the post is not sent and the composer shows "Couldn't send." with the reason and Retry (the one exception: storage itself unavailable and nothing was ever saved, so no older revision could be resurrected). A 503/409 lock persists `lockedMessage` as well, so a draft reopened from `/drafts` comes back locked with the same key and replays rather than duplicating a post the server already holds.
  - **Drafts page (`/drafts`).** Lists this actor's drafts (`DraftsList`, `DraftRow`) and opens one in the composer it was written in (`DraftEditor`: `PostBox` for a post or quote, `StatusReplyBox` for a reply, both given `draft` and `key={draft.id}`). The editor collapses when the draft is sent, cancelled or discarded (the list re-reads on `changed`). Both composers get `keepWhenEmpty` from the editor: emptying the text never deletes the saved draft (it saves an empty one), and the draft is deleted through `deleteDraftAndOwnedMedia` only when the editor closes (Close, or unmount by navigating away) with nothing worth keeping (no text, attachments, CW, poll choice or fitness file); a `DraftConflictError` there keeps it. A row's failed Delete is an `Alert` ("Couldn't delete draft") that `DraftsList` draws above the list, with Retry unless another tab changed the draft (then the list re-reads it), and clears on that row's next delete that works. Retry deletes only the revision whose delete failed: a newer save since then (an edit in the editor or another tab) is treated as a conflict, and a draft already gone clears the error. Nothing is saved or discarded while a reopened draft's attachment bytes are still loading (`isSeeding`), and the unmount discard waits a tick and is skipped if the composer remounts (React StrictMode). Queued posts are listed first, under "Waiting to send" (oldest `queuedAt` first; the rest are under "Drafts on this device"). Each queued row has a chip for its state ("Waiting for connection", "Paused", "Sending", "Checking whether it posted", "Needs review", "Couldn't send") with the queue's `reason` under it, and reads "Queued … ago". A `waiting` row offers Edit, and a `paused`, `needs_review` or `couldnt_send` row offers Review; a `sending` or `checking` row offers neither, and only `needs_review` and `couldnt_send` rows can be deleted. A row paused by the reader has Resume (`resumeQueue`, which resumes the whole queue and asks `DraftsProvider` for a drain), and a row paused by a 401 has Sign in (a full page load of `/auth/signin`). Edit and Review take the post out of the queue first (`unqueueDraft`) and open the editor on the record that comes back, so the post then lives under "Drafts on this device"; a draft that was attempted keeps `submit` and opens locked under the same key, so it never posts again under a new one (except after a 410, below). A post found `sending` or `checking` (`DraftBusyError`) is not opened: the list shows "This post is being sent now." until it settles, and a failed Edit or Resume shows "Couldn't update this post". A drain that could not run (storage, or the sender's code failed to load) shows "Couldn't send queued posts" above the list, an error `Alert` with Retry, until the next drain works. While a post is paused for sign-in or a profile switch, an info `Alert` ("Sending is paused") says the rest of the queue waits for that too. `/drafts` is in the nav registry (a gray count pill on the Drafts row, a solid `bg-muted-foreground` one over the tablet rail icon for contrast, never on the mobile menu button) and is disallowed in `robots.txt`.
  - **Sign-out and shared devices.** Drafts, including direct-message text and FIT file GPS, stay on the device until an explicit sign-out; a 401 keeps them on purpose. The sign-out flow is unified in `useSignOut` and `SignOutDialog` (`lib/components/sign-out/`), used by both the account menu's "Sign out" and the Sessions page's "Sign out of this device" (`LogoutButton`). `SignOutDialog` is loaded lazily by the account menu the first time Sign out is chosen, which keeps the auth client and the drafts code out of every page's sidebar bundle; it always confirms before signing out ("Sign out?" / "You will be signed out on this device. Other devices stay signed in.", with Cancel / Sign out). Each time it opens, `countDraftsByState` checks for unsent posts for the active account, splitting queued posts (`waiting`) from plain `drafts`; the confirm button stays disabled until that count is in, so a quick tap cannot sign out past a warning it has not shown yet (a count that fails reads as none). If unsent posts exist on the device, the dialog adds a standalone error `Alert` ("N posts on this device have not been sent. X are waiting to send and Y are drafts. …") with a "Review drafts" link (`/drafts`), and switches the confirmation action to destructive "Sign out and delete". When confirmed, `useSignOut` broadcasts `signing-out` across tabs via `postDraftsMessage` (halting active autosaves), clears offline caches via `clearAllOfflineData()`, and calls `authClient.signOut()`. Account drafts are purged (`purgeAccountDrafts`) only after the server confirms the sign-out; a failed or offline sign-out keeps the drafts (the offline timeline cache is already cleared), broadcasts `sign-out-cancelled` to resume normal operation, and displays an inline error in the dialog. Because deletion can fail (storage blocked, a tab closed mid-delete), the account is first recorded in `localStorage` (`activities-drafts-pending-purge`, every access in try/catch; `pendingPurgeMarker.ts`, which is loaded statically before lazy drafts code) and cleared once `purgeAccountDrafts` succeeds. Once the server confirms the sign-out, the redirect to `/auth/signin` always follows, whatever the deletion does; `DraftsProvider` retries every pending purge when it mounts on next load, before reading the epoch (the purge bumps it), until it succeeds. If the database cannot be opened at sign-out the drafts cannot be counted either; the purge still runs on the next load.
  - **Storage durability.** After the first successful save the composer asks the browser for persistent storage (`requestPersistentOfflineStorage()`, best effort). Safari evicts a non-installed site's storage after 7 days without use (a use-based limit, not a size cap).
- **Send queue (`lib/client/drafts/sendQueue.ts`).** "Send when online" (`OfflineSubmitButtons`) stores a draft with a `queue` object (`DraftQueueState`), and `drainQueue` posts the queued drafts of the active actor, oldest `queuedAt` first, through `createNote` or `createPoll`.
  - **States (`DraftQueueStateName`).** `waiting`: never POSTed, due at `nextAttemptAt` (a pre-flight, upload or network failure before the POST backs off 5 s to 5 min, `SEND_BACKOFF_MS`, by its own count `retries`; an upload refused with a status the upload helpers do not surface counts apart, in `uploadRetries`, so an outage before it never spends its tries, and is tried `UPLOAD_RETRY_LIMIT` (6) times, about 8 minutes, then settles as `couldnt_send`; the checkpoint and Resume reset both). `sending`: claimed by one tab under a lease (`CLAIM_LEASE_MS`, 90 s, renewed by a heartbeat). `checking`: a POST may have landed (a network error, an abort, a 5xx or a 409), so only the same key is sent again, on a backoff. `needs_review`: waits for the reader (older than 24 h, a video, a reply or quote target that is gone, hidden or edited since, a quote no longer allowed, a missing description when the instance requires one, a 410 meaning the post was sent and then deleted, which also drops `submit`, `attemptedAt` and `firstAttemptAt` so Review reopens it unlocked under a new key, or no answer after 6 days). `couldnt_send`: the server refused it (another 4xx); waits for the reader. `paused`: `pausedBy` is `user` (Pause), `auth` (401), `actor` (the `Activities-Expected-Actor` mismatch below) or `rate_limit` (429, which retries by itself at `nextAttemptAt`, from `Retry-After`, else 60 s); the other three wait.
  - **Drains run only while the app is open.** `DraftsProvider` starts one on mount (after it lifts the `auth` and `actor` pauses, so a reader who signed in again retries once per load), when the connection is restored (`onConnectionRestored`), when the tab becomes visible, and from one timer for the earliest `nextAttemptAt` or lease end (`claim.until`) of a queued item. An item already due (a fresh one, which another tab may have queued while it could not drain, one past its time, or one another tab's sender lock turned this tab's pass away from) sets that timer to `RETRY_SOON_MS` (2 s) from now, only while this tab can drain, so it never polls offline. It never spins either: the items a pass found due and could not move (it failed, or claimed none of them) wait for the next trigger or a change to them, while a new or changed item is still tried soon. While an item is paused for sign-in or a profile switch, the drain stopped there, and no pass, rerun or trigger sends anything until the next load lifts that pause, so nothing else posts into the same 401 or 409. `drainQueue` checks again on the list it reads under the sender lock, so a pass another tab began before the pause was written stops too (without Web Locks, a pass already claiming may still send one more, which the server refuses). A `changed` message reschedules only for a queued draft or a bulk change, and a drain that finds nothing due loads neither the sender's code nor the lock. There is no Background Sync, and a closed app sends nothing. The slot says "Back online" and "Sending N of M posts" while it runs, then the counts (`getSlotMessage`, `SendQueueProgress`); a Pause that fails turns it to "Couldn't pause sending." in the error tone, with Pause to try again.
  - **Deadlines.** A post is checked against 24 h from `queuedAt` (`MAX_QUEUE_AGE_MS`) before its first POST only; an older one goes to `needs_review`. Once an attempt was made (`firstAttemptAt`), 6 days from it (`CHECKING_GIVE_UP_MS`) is when the queue stops resending and sends the reader to check their profile.
  - **Correctness is the claim, not the lock.** `withSenderLock` (`senderLock.ts`, Web Locks `activities-drafts-sender`, `ifAvailable`) only keeps tabs from doing the same work, and runs the drain anyway without Web Locks. Exactly-once comes from `claimQueuedDraft`, one transaction that checks the sign-out epoch and `isQueueClaimable` and writes `state: 'sending'` with `claim: { tabId, until }`; every later write is revision-checked in `draftsDb`. A `sending` item is claimable again only once its lease ran out. An abort (sign-out, unmount) writes the claimed item back (`waiting`, or `checking` once `firstAttemptAt` is set) and clears the claim, so a lease is never left to expire.
  - **One key and fingerprint with the composer.** `buildSubmitRequest` in `submitRequest.ts` builds the request and the `fingerprint` for the composers and the queue, so the same content reuses `submit.key` whichever of them sends it. Before every POST the queue writes `submit`, `attemptedAt`, `firstAttemptAt` and `attempts`, and sends nothing if that write fails. A sent draft is deleted with `deleteDraftIfRevision`; if that fails, a later drain replays the key and gets the original status.
  - **`Activities-Expected-Actor`.** Every queued POST carries the id of the actor the draft was written as (see docs/mastodon-api-compatibility.md), and so do the queue's uploads (the media and presigned-upload routes and `POST /api/v1/fitness-files`), which refuse a mismatch with the same 409 before storing anything, so a stale tab never turns one profile's photos or activity into another's. The route's 409 (`EXPECTED_ACTOR_MISMATCH_ERROR`) is read before any other 409 and pauses the queue as `actor`, so a post is never created as another profile.
  - **Pause never recalls a request.** `pauseQueue` turns every item that would retry on its own (`waiting`, `checking`, and a rate-limit pause, whose "trying again" reason it drops) into `paused` (`user`). A `sending` item's request may already be on the wire, so Pause only marks it (`pauseRequested`, written without a revision bump, as a lease renewal is, so the claim owner's write still lands). If the mark is there when the send reaches its checkpoint (still in pre-flight or uploads), nothing is posted and the item is paused; if that request settles into a retry, a drain abort hands it back, or another tab takes over its expired lease, it is paused instead; a final outcome (sent, Needs review, Couldn't send) stands. A 401 or profile-switch pause stands too but keeps the mark (Pause also marks an item already held that way), so the next load's lift leaves it paused by the reader. Resume clears the mark.
  - **Review and Edit unqueue.** `unqueueDraft` removes `queue` and keeps `submit`, `attemptedAt` and `lockedMessage`, so a draft that was attempted opens locked under the same key (a 410 already dropped them: the post the key made is gone). It refuses with `DraftBusyError` while an item is `sending` (live or expired lease) or `checking`: only the same key may settle those.
  - **A 400 to a POST locks the draft.** The route answers 503 for any failure after this request saved the post, so a 400 to a first attempt means nothing was kept, but the queue still treats it as a 503 or 409: it sets `lockedMessage` and `owned: false` on its media, and the draft reopens locked under the same key, as Review does for any attempted draft. A 4xx before any POST (a pre-flight failure) does not lock.
  - **Attachments.** Photos and an activity file upload from the stored bytes (`uploadAttachment`, `uploadFitnessFile`), and each id is persisted (`updateQueuedDraft`) before the next upload and before the checkpoint, so a retry reuses it and never uploads twice. A write that fails because another tab owns the draft deletes the upload it just made. An abort (sign-out, unmount) stops waiting on an upload, so a hung one never holds the sender lock; one that lands later stays as unposted media. Video is never queued: "Send when online" is unavailable for it (`queueDisabledReason`, "Videos stay as drafts"), and a queued draft with a video that has no media id goes to `needs_review`.
- **Connection status.** `lib/client/connection.ts` is one module-level store (`online` / `offline` / `unreachable`) read through `useConnectionStatus()`. Browser `online`/`offline` events and failed requests are only hints: `reportRequestFailure` (a `TypeError`, `AbortError`/`TimeoutError`, or a 502/503/504) and the events trigger a probe, and the probe decides: `GET /health` with `cache: 'no-store'` and an 8 s timeout, retried with a 5 s to 60 s backoff only while the tab is visible. A 400 or a 503 the server kept (a locked create) never flips the state by itself. `onConnectionRestored` refreshes the home timeline. The status slot renders from one pure function (`getSlotMessage`): `ConnectionAnnouncer` is the single live region (title only, never the countdown), mounted once in the layout and in `OfflineAppShell`; `ConnectionStatusBar` (desktop, an info `Alert` with `icon`, `live={false}`, in the error tone only for a failed Pause) and `ConnectionStatusStrip` (phone) are visual only and render nothing while online. Home adds "Showing saved posts" under "You're offline." `getSlotMessage` also takes the queue's progress, which wins over the connection message while a drain runs or has just finished.
- **Offline-disabled actions.** Like, boost and follow (`like-button.tsx`, `repost-button.tsx`, `follow-action.tsx`, the follow-back button in `FollowNotification.tsx`) are marked `aria-disabled` while `useIsOffline()` is true, which is the `offline` state only: with `unreachable` each action keeps its own error path. They stay mounted and focusable, wrapped in `OfflineTooltip` ("You're offline", `actionButtonShared.tsx`), so going offline never drops focus.
