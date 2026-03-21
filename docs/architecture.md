# Architecture Overview

This document describes the high-level architecture of Activity.next, an ActivityPub server built on Next.js.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Clients                                    │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────────────────┐  │
│  │  Web      │   │ Mastodon     │   │ Remote ActivityPub         │  │
│  │  Browser  │   │ Client Apps  │   │ Servers (Mastodon, etc.)   │  │
│  └─────┬─────┘   └──────┬───────┘   └─────────────┬──────────────┘  │
└────────┼────────────────┼──────────────────────────┼────────────────┘
         │                │                          │
         │ HTML/SSR       │ Mastodon API             │ ActivityPub
         │                │ (OAuth 2.0)              │ (HTTP Signatures)
         ▼                ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Next.js Application                            │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    App Router (app/)                            │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐  │ │
│  │  │  Pages &     │  │  API Routes     │  │  Federation      │  │ │
│  │  │  Layouts     │  │                 │  │  Endpoints       │  │ │
│  │  │              │  │  /api/v1/*      │  │                  │  │ │
│  │  │  (timeline)/ │  │  /api/v2/*      │  │  /api/users/*    │  │ │
│  │  │  (nosidebar)/│  │  /api/auth/*    │  │  /api/inbox      │  │ │
│  │  │              │  │  /api/oauth/*   │  │  /.well-known/*  │  │ │
│  │  └──────────────┘  └─────────────────┘  └──────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Core Library (lib/)                          │ │
│  │                                                                │ │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐ │ │
│  │  │ Services   │ │ Activities │ │ Jobs     │ │ Components   │ │ │
│  │  │            │ │            │ │          │ │              │ │ │
│  │  │ • auth     │ │ • create   │ │ • send   │ │ • post-box   │ │ │
│  │  │ • guards   │ │ • follow   │ │ • delete │ │ • posts      │ │ │
│  │  │ • medias   │ │ • like     │ │ • poll   │ │ • settings   │ │ │
│  │  │ • oauth    │ │ • announce │ │ • import │ │ • profile    │ │ │
│  │  │ • email    │ │ • update   │ │ • fetch  │ │ • timeline   │ │ │
│  │  │ • fitness  │ │ • delete   │ │          │ │ • ui (Radix) │ │ │
│  │  │ • queue    │ │ • undo     │ │          │ │              │ │ │
│  │  └──────┬─────┘ └────────────┘ └────┬─────┘ └──────────────┘ │ │
│  └─────────┼───────────────────────────┼─────────────────────────┘ │
│            │                           │                           │
│            ▼                           ▼                           │
│  ┌────────────────────┐  ┌────────────────────────────────────┐    │
│  │ Database Layer     │  │ External Services                  │    │
│  │ (lib/database/)    │  │                                    │    │
│  │                    │  │  ┌──────────┐  ┌───────────────┐   │    │
│  │ Knex Query Builder │  │  │ Storage  │  │ Queue         │   │    │
│  │                    │  │  │ (S3/FS)  │  │ (QStash)      │   │    │
│  │ ┌───────┐ ┌─────┐ │  │  └──────────┘  └───────────────┘   │    │
│  │ │SQLite │ │ PG  │ │  │  ┌──────────┐                      │    │
│  │ └───────┘ └─────┘ │  │  │ Email    │                      │    │
│  └────────────────────┘  │  │(SMTP/SES)│                      │    │
│                          │  └──────────┘                      │    │
│                          └────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
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

| Directory             | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `app/(timeline)/`     | Main app pages with sidebar (home, profile, notifications, settings)      |
| `app/(nosidebar)/`    | Authentication pages without sidebar (login, signup, OAuth consent)       |
| `app/api/auth/`       | Authentication endpoints (better-auth)                                    |
| `app/api/v1/`         | Mastodon-compatible API v1 (statuses, timelines, accounts, notifications) |
| `app/api/v2/`         | Mastodon-compatible API v2 (instance info, media, search)                 |
| `app/api/users/`      | ActivityPub actor endpoints (inbox, outbox, followers, following)         |
| `app/api/oauth/`      | OAuth 2.0 provider endpoints (authorize, token, userinfo, revoke)         |
| `app/api/well-known/` | Federation discovery (WebFinger, NodeInfo, OAuth metadata)                |

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

Knex migration files that define the database schema. Migrations are designed to work with both SQLite and PostgreSQL.

## Key Design Decisions

### Database Abstraction

All database operations go through the `lib/database/` layer using [Knex.js](https://knexjs.org/) as the query builder. This enables support for both SQLite (development/small instances) and PostgreSQL (production) without changing application code.

### Mastodon API Compatibility

The `/api/v1/` and `/api/v2/` routes implement a subset of the [Mastodon API](https://docs.joinmastodon.org/api/), allowing users to connect with Mastodon-compatible client applications (Ivory, Ice Cubes, Tusky, etc.).

### Authentication

Authentication is handled by [better-auth](https://www.better-auth.com/), which provides:

- Local email/password authentication
- GitHub OAuth sign-in
- Session management stored in the database
- JWT tokens for API access

The application also acts as an **OAuth 2.0 provider** (using better-auth's OAuth provider plugin), allowing third-party applications to authenticate users and access the API.

### ActivityPub Federation

The server implements the [ActivityPub](https://www.w3.org/TR/activitypub/) protocol for federation:

- **Inbox** (`/api/inbox`, `/api/users/:username/inbox`) — Receives activities from remote servers
- **Outbox** (`/api/users/:username/outbox`) — Lists activities by a local actor
- **WebFinger** (`/.well-known/webfinger`) — Actor discovery
- **NodeInfo** (`/.well-known/nodeinfo`) — Instance metadata
- **HTTP Signatures** — All outgoing requests are signed; incoming requests are verified

### Background Jobs

Long-running operations (sending activities to remote servers, processing file uploads) are dispatched to a background queue. Supported backends:

- **Upstash QStash** — Managed HTTP-based message queue (recommended for production)
- **Synchronous** — Jobs execute inline (default, suitable for small instances)

### Media & File Storage

Media files (images) and fitness files (.fit, .gpx, .tcx) support multiple storage backends:

- **Local filesystem** — Files stored in a local directory
- **S3** — Amazon S3
- **Object storage** — Any S3-compatible service (MinIO, DigitalOcean Spaces, Cloudflare R2, etc.)

## Database Schema (Simplified)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   accounts   │────▶│    actors     │────▶│    statuses      │
│              │     │              │     │                  │
│ id           │     │ id           │     │ id               │
│ email        │     │ accountId    │     │ actorId          │
│ passwordHash │     │ username     │     │ type (Note/Poll) │
│ createdAt    │     │ domain       │     │ text             │
└──────────────┘     │ name         │     │ reply            │
                     │ iconUrl      │     │ createdAt        │
                     │ publicKey    │     └────────┬─────────┘
                     │ privateKey   │              │
                     └──────────────┘              │
                            │                      │
                ┌───────────┼───────┐    ┌─────────┼────────┐
                ▼           ▼       ▼    ▼         ▼        ▼
         ┌──────────┐ ┌────────┐ ┌────────────┐ ┌───────┐ ┌──────────┐
         │followers │ │ likes  │ │attachments │ │ tags  │ │timelines │
         └──────────┘ └────────┘ └────────────┘ └───────┘ └──────────┘

Other tables: sessions, notifications, medias, fitness_files,
              recipients, counters, poll_choices, applications,
              oauth_access_tokens, oauth_authorization_codes
```

## Technology Stack

| Layer                | Technology                    |
| -------------------- | ----------------------------- |
| **Runtime**          | Node.js 24                    |
| **Framework**        | Next.js 16 (App Router)       |
| **Language**         | TypeScript (strict mode)      |
| **UI Library**       | React 19                      |
| **Styling**          | Tailwind CSS                  |
| **UI Components**    | Radix UI primitives           |
| **Database**         | Knex.js (SQLite / PostgreSQL) |
| **Authentication**   | better-auth                   |
| **Logging**          | Pino                          |
| **Testing**          | Jest (with SWC transforms)    |
| **Code Quality**     | ESLint + Prettier             |
| **Package Manager**  | Yarn 4.12.0                   |
| **Containerization** | Docker (Alpine-based)         |
| **Observability**    | OpenTelemetry (optional)      |
