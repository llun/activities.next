# Inventory: docs/

Factual inventory of the 10 files in `docs/`. Sizes via `wc -lc`; outlines via `grep -nE '^#{2,3} '`.

### docs/architecture.md
- bytes / lines: 528,641 / 4,032
- audience: human contributor, operator/self-hoster, agent rules
- purpose: High-level architecture of Activity.next (boundaries, request flows, design decisions, tech stack) that grows into a long per-subsystem contributor rules and review-check manual.
- outline (43 `###` — listed compactly under their `##`; >40 headings total):
  - L5 `## System Architecture`
  - L34 `## Request Flow` — `###`: 36 Web Browser Request, 44 Mastodon API Request, 54 Incoming ActivityPub Message, 67 Outgoing ActivityPub Message
  - L79 `## Directory Structure` — `###`: 81 `app/` — Next.js App Router, 101 `lib/` — Core Business Logic, 115 `migrations/` — Database Schema
  - L119 `## Key Design Decisions` — `###`: 121 Database Abstraction, 125 Mastodon API Compatibility, 129 Public Identifiers, 172 Authentication, 185 Served Domains, 196 ActivityPub Federation, 257 Background Jobs, 379 Account data export, 571 Account data import, 778 Link Preview Cards, 806 Route Heatmap Tiles, 868 Media & File Storage, 1047 Offline-First PWA Launch & Timeline Caching, 1051 Browser Web Vitals
  - L1063 `## Database Schema (Simplified)`
  - L1118 `## Technology Stack`
  - L1139 `## Contributor rules` — `###`: 1183 Server/Client Module Boundary, 1193 Instance Limits in Client Components, 1202 Date Serialization in Server Components, 1211 Client-Side API Calls, 1221 Outbound Server-Side HTTP Requests, 1245 Link prefetching in feeds, 1255 Navigation Customization, 1280 Page Header & Sub-Navigation, 1436 Fitness Overview Calendar, 1449 Surfaces (Shared Surface Kit), 1490 Photo Editor (Client), 1502 Settings Forms (Client Components), 1515 Transactional & Notification Emails, 1644 Link Preview Cards, 1982 Status Delete & Unboost Federation, 2049 Actor Profile & Deletion Federation, 2803 Better-auth Plugin Guidelines, 2821 Better-auth Database Joins, 2833 Better-auth Session Refresh, 2842 OAuth Client Registrations, 2851 OAuth Access Token Sliding Expiry, 2864 Auth Error Page, 2876 OAuth Grants Must Resolve an Actor, 2887 An Unconfirmed Account May Not Act, 2905 Review: Runtime vs. build-time configuration, 2948 Review: Client components & data flow, 3254 Review: Page chrome, layout & accessibility, 3459 Review: Surfaces, 3472 Review: Logging, 3493 Review: Auth error page, 3523 Review: Better-auth session refresh, 3542 Review: OAuth access token sliding expiry, 3564 Review: Unconfirmed accounts & app tokens, 3643 Review: Emails, 3684 Review: Post media layout, 3877 Review: Status delete & unboost federation, 3908 Review: Link preview cards, 4003 Offline-First PWA Launch & Timeline Caching
- notes: A 528 KB file; the "Contributor rules" section (L1139–4032, ~72% of the file) is agent-style rules plus many "Review:" headings (L2905–4003) that read like accumulated review/plan text. "Link Preview Cards" (L778, L1644) and "Offline-First PWA Launch & Timeline Caching" (L1047, L4003) each appear twice — the L4003 copy sits after the rules index and duplicates the earlier topic.

### docs/environment-variables.md
- bytes / lines: 97,218 / 537
- audience: operator/self-hoster, human contributor
- purpose: Reference of all `ACTIVITIES_*` / `OTEL_EXPORTER_*` environment variables, including database-backed server settings and their env → database → default precedence.
- outline:
  - L11 `## Database-backed server settings (env → database → default)`
  - L130 `## Core Configuration`
  - L146 `## Proxy Configuration`
  - L152 `## Database` — `###`: 156 Full JSON Configuration, 162 Individual Variables (SQLite), 169 Individual Variables (PostgreSQL), 183 Unsupported clients
  - L187 `## Authentication`
  - L193 `## Email` — `###`: 224 SMTP, 234 Resend, 240 AWS SES
  - L246 `## Translation`
  - L258 `## Alt Text Generation`
  - L268 `## Gallery Lookups`
  - L288 `## Photo Editor`
  - L298 `## Media Storage`
  - L335 `## Fitness File Storage` — `###`: 364 Fitness map provider
  - L401 `## Account Import`
  - L410 `## Queue (Background Jobs)`
  - L432 `## Push Notifications`
  - L440 `## Domain Controls` — `###`: 451 Which domains are local
  - L496 `## Request Configuration`
  - L505 `## Observability` — `###`: 518 Browser Web Vitals
  - L531 `## Build & Runtime`
- notes: Dense but well-scoped reference; intro states root `config.json` is ignored (migration note, L9–11). Long prose paragraphs inside the database-backed settings section (L11–130) read as accumulated behavioral spec.

### docs/features.md
- bytes / lines: 64,294 / 158
- audience: end-user features, human contributor
- purpose: Feature roadmap listing implemented (✅) and planned features.
- outline:
  - L5 `## Current Features` — `###`: 7 Core, 34 Authentication & OAuth, 46 Timelines & Notifications, 62 Storage & Media, 109 API Compatibility, 142 Infrastructure
  - L152 `## Planned Features`
  - L156 `## Feature Requests`
- notes: Changelog/roadmap-style checklist document with checkmarks; 64 KB in only 158 lines means very long bullet lines. "Planned Features" (L152) and "Feature Requests" (L156) are plan text.

### docs/fitness-file-storage.md
- bytes / lines: 192,917 / 1,556
- audience: operator/self-hoster, human contributor, agent rules
- purpose: Fitness file upload, processing, import (Strava/Wahoo), gear, heatmap, and display pipeline documentation.
- outline:
  - L5 `## Overview` — `###`: 13 Wahoo cloud imports
  - L26 `## Configuration`
  - L53 `## Storage Implementations`
  - L59 `## Database Schema` — `###`: 88 Pre-parsed route data cache, 102 Route heatmap tile pyramid
  - L266 `## Gear Tracking`
  - L301 `## API Endpoints` — `###`: 303 Upload and Retrieval, 313 Account Fitness Data, 332 Settings and Imports, 345 Gear, 357 Map Provider Tokens
  - L363 `## Processing Pipeline` — `###`: 379 Several recordings of one activity
  - L395 `## User-Facing Features` — `###`: 404 The activity page
  - L421 `## Maintenance Scripts`
  - L449 `## Security and Privacy`
  - L464 `## Contributor rules` — `###`: 478 Fitness Stat Strips, 518 Apple Maps Basemap, 566 Fitness Activity Dates, 623 Fitness Route Heatmap Pyramid, 925 Fitness Gear, 1471 Review: Apple Maps basemap, 1491 Review: Fitness route heatmap pyramid
- notes: 193 KB; extremely dense prose (intro paragraphs run hundreds of words). "Contributor rules" section (L464–1556, ~70% of file) mixes agent rules with two "Review:" headings (L1471, L1491).

### docs/maintenance.md
- bytes / lines: 261,261 / 1,720
- audience: operator/self-hoster, human contributor, agent rules
- purpose: Catalog of maintenance/administrative scripts (backups, backfills, queue worker, mock data) plus a Knex→Kysely migration handover guide.
- outline (31 `###` — listed compactly under their `##`; >40 headings total):
  - L5 `## Upgrading past the Knex handover`
  - L31 `## Bundle Size Report`
  - L50 `## Database Queue Worker`
  - L65 `## Media Storage Cleanup` — `###`: 69 What it does, 80 Usage, 96 Options, 102 Storage Support, 110 Requirements, 118 Examples, 158 When to Use, 167 Safety
  - L178 `## Production Snapshot Backup and Restore` — `###`: 182 Downloading a Production Archive, 209 Restoring a Production Archive into Local Development
  - L251 `## Actor Archive Export` — `###`: 290 Usage, 304 Options, 355 Archive layout
  - L381 `## Repairs that stay with v1.192.34` — `###`: 392 Public ID Backfill, 401 Media Sort Date Backfill, 413 Notification ID Rewrite
  - L423 `## Gallery Lookup Backfill` — `###`: 427 When to Use, 438 Usage, 455 Options
  - L464 `## Search Index Rebuild`
  - L484 `## Fixing Attachment URLs` — `###`: 488 Usage, 503 Options
  - L509 `## Other Scripts` — `###`: 511 Create Mock User, 521 Create Mock Statuses, 531 Create Mock Fitness Data, 541 Create Mock Fitness Calendar Data, 555 Create Web Vitals Fixtures, 578 Render Email Previews, 622 Admin Role Management, 631 Fitness, Strava, and Wahoo Maintenance
  - L919 `## Import Remote Status` — `###`: 923 When to Use, 927 Usage, 937 Examples
  - L943 `## Docker Image Verification` — `###`: 947 What it does, 957 Usage
  - L973 `## Related Documentation`
  - L982 `## Contributor rules` — `###`: 995 Media Details, EXIF and Gallery Settings, 1043 Deleting Media a Post Uses, 1118 Security & Configuration Tips, 1223 Composite Index Column Order on `statuses` (PostgreSQL 18), 1234 Database Compatibility Guidelines, 1283 Review: Uploaded file names, 1316 Review: Unique constraints (TOCTOU), 1331 Review: Database & migrations, 1530 Review: Stored media, 1711 Review: Served domains (Admin › Served domains)
- notes: 261 KB — largest file in docs/. "Upgrading past the Knex handover" (L5–31) and "Repairs that stay with v1.192.34" (L381–423) are release/changelog-scoped text tied to a specific version. "Contributor rules" (L982–1720) ends with five "Review:" headings (L1283–1711).

### docs/mastodon-api-compatibility.md
- bytes / lines: 250,968 / 1,978
- audience: end-user features, human contributor, agent rules
- purpose: Durable reference of intentional divergences from the Mastodon API, endpoints not planned, and extensions.
- outline:
  - L18 `## Intentional divergences`
  - L465 `## Not planned`
  - L489 `## Extensions`
  - L1096 `## Contributor rules` — `###`: 1117 Client-Facing Entity IDs, 1131 Zod Validation in API Routes, 1159 ActivityPub & JSON-LD, 1318 A Fetched Document's Own `id` Is Not Evidence, 1342 Actor Usernames Are Case-Insensitive, 1358 Status Posts & Actions, 1687 Local Usernames Are Actor-Id Path Segments, 1697 Local Actors ("does this server host this actor?"), 1706 Who May See an Actor's Statuses, 1722 Publicly Readable Status Ids, 1740 Review: API routes, 1777 Review: Actor usernames, 1891 Review: Mastodon and Fediverse Interoperability Quirks, 1907 Review: Fetched ActivityPub document ids
- notes: 251 KB with only four `##` sections — the "Extensions" section (L489–1096, ~600 lines) and "Intentional divergences" (L18–465) are enormous single bullet-list blocks. Intro states keeping the page current is part of the definition of done (L15–16). "Contributor rules" (L1096–1978) includes four "Review:" headings (L1740–1907).

### docs/postgresql-setup.md
- bytes / lines: 7,607 / 204
- audience: operator/self-hoster
- purpose: Guide for setting up Activity.next with a PostgreSQL backend (dev and production).
- outline:
  - L5 `## Prerequisites`
  - L11 `## PostgreSQL Database Setup`
  - L65 `## Development Setup`
  - L103 `## Production Deployment with PostgreSQL` — `###`: 117 Example Configuration for Production
  - L139 `## Using with Vercel`
  - L147 `## Docker Deployment with PostgreSQL`
- notes: Small, focused operator guide; includes a PG15+ `public` schema grant caveat (L18–26).

### docs/quickstart.md
- bytes / lines: 4,254 / 100
- audience: operator/self-hoster, human contributor
- purpose: Minimal local boot path: clone, three required settings in `.env.local`, migrate, run, sign up.
- outline:
  - L12 `## Prerequisites`
  - L17 `## 1. Clone and install`
  - L26 `## 2. Create a minimal `.env.local``
  - L69 `## 3. Migrate and run`
  - L76 `## 4. Sign up`
  - L83 `## What's intentionally left out`
  - L96 `## Next steps`
- notes: Small and clean; explicitly defers everything else to setup.md and environment-variables.md.

### docs/setup.md
- bytes / lines: 39,410 / 440
- audience: operator/self-hoster, human contributor, agent rules
- purpose: Full setup guide covering prerequisites, configuration areas, first run, and deployment options.
- outline:
  - L10 `## Prerequisites`
  - L17 `## Database Setup`
  - L25 `## General Configuration` — `###`: 31 Required Configuration, 54 Access Control, 64 Serving more than one domain (Optional), 77 Authentication Methods, 81 Media Storage (Optional), 172 Email Configuration (Optional), 216 Queue Configuration (Optional), 248 Push Notifications (Optional)
  - L258 `## Starting the Application` — `###`: 260 Development Environment, 276 First-Time Setup
  - L284 `## Deployment Options` — `###`: 286 Vercel Deployment, 296 Docker Deployment, 357 Public Endpoint Protection
  - L363 `## Contributor rules` — `###`: 372 Build, Test, and Development Commands, 391 Database Backends & Local Setup
- notes: Mostly an operator guide, but it ends with a "Contributor rules" section (L363–440, ~18% of the file) containing build/test command and database-local-setup agent rules.

### docs/sqlite-setup.md
- bytes / lines: 5,748 / 113
- audience: operator/self-hoster
- purpose: Guide for setting up Activity.next with SQLite (default bundled backend).
- outline:
  - L5 `## Prerequisites`
  - L10 `## Database Configuration`
  - L41 `## Development Setup`
  - L74 `## Using with a Tunnel for Local Development`
  - L82 `## Production Deployment with SQLite` — `###`: 92 Docker Deployment with SQLite
- notes: Small, focused operator guide; covers both individual variables and the JSON `ACTIVITIES_DATABASE` form.

## Cross-file observations
- Four large files (architecture.md, fitness-file-storage.md, maintenance.md, mastodon-api-compatibility.md — 1.2 MB combined, ~87% of docs/ by bytes) each carry a large `## Contributor rules` section with "Review:" headings that read like accumulated review/plan text, and those sections account for roughly 30–75% of each file.
- Changelog/version-scoped content: maintenance.md L5–31 and L381–423 (Knex handover, v1.192.34 repairs).
- Small operator guides (postgresql-setup.md, sqlite-setup.md, quickstart.md) are clean and focused; features.md is a roadmap/checklist document.
- Duplicate topics in architecture.md: "Link Preview Cards" (L778 and L1644) and "Offline-First PWA Launch & Timeline Caching" (L1047 and L4003).
