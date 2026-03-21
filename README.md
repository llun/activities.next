# Activity.next

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

Activity.next is a self-hosted [ActivityPub](https://www.w3.org/TR/activitypub/) server built with Next.js and TypeScript. It enables you to run your own instance in the [Fediverse](https://en.wikipedia.org/wiki/Fediverse) — the decentralized social media network — and interact with Mastodon, Pleroma, Misskey, and other ActivityPub-compatible platforms.

## ✨ Highlights

- **Fediverse-ready** — Full ActivityPub federation with other servers
- **Mastodon API compatible** — Use your favorite Mastodon client apps
- **OAuth 2.0 provider** — Acts as a full OAuth 2.0 / OpenID Connect server
- **Multiple databases** — SQLite for development, PostgreSQL for production
- **Flexible storage** — Local filesystem, AWS S3, or any S3-compatible object storage
- **Fitness tracking** — Upload .fit, .gpx, and .tcx activity files with map generation
- **Docker-ready** — Official Docker image available at `ghcr.io/llun/activities.next`

See the full [Feature Roadmap](docs/features.md) for current and planned features.

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Clients                             │
│  (Web Browser, Mastodon Apps, ActivityPub Servers)        │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│   Next.js Frontend   │    │       API Routes             │
│   (React + SSR)      │    │  /api/v1/* (Mastodon API)    │
│                      │    │  /api/users/* (ActivityPub)   │
│                      │    │  /api/auth/* (better-auth)    │
│                      │    │  /api/oauth/* (OAuth 2.0)     │
└──────────┬───────────┘    └──────────────┬───────────────┘
           │                               │
           └──────────┬────────────────────┘
                      ▼
         ┌────────────────────────┐
         │   Services & Jobs      │
         │  (Business Logic)      │
         └────────────┬───────────┘
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  Database  │ │   Storage  │ │   Queue    │
│ SQLite/PG  │ │ Local/S3   │ │  QStash    │
└────────────┘ └────────────┘ └────────────┘
```

For a more detailed architecture overview, see [docs/architecture.md](docs/architecture.md).

## 🚀 Getting Started

### Prerequisites

- **Node.js 24** or higher
- **Yarn** package manager (v4.12.0 via Corepack)
- A **domain name** (required for federation)

### Quick Start

1. **Clone the repository:**

   ```bash
   git clone https://github.com/llun/activities.next.git
   cd activities.next
   ```

2. **Enable Corepack** (for Yarn 4 support):

   ```bash
   corepack enable
   ```

3. **Install dependencies:**

   ```bash
   yarn install
   ```

4. **Configure your instance** (see the [Setup Guide](docs/setup.md)):

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

   At minimum, set `ACTIVITIES_HOST` and `ACTIVITIES_SECRET_PHASE`.

5. **Run database migrations:**

   ```bash
   yarn migrate
   ```

6. **Start the development server:**

   ```bash
   yarn dev
   ```

7. **Sign up** at `http://localhost:3000/auth/signup` (your email must be in the allow list).

For detailed setup instructions, see the [Setup Guide](docs/setup.md).

## 🐳 Deployment

### Docker (Recommended)

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=your-random-secret \
  -v /path/to/data:/opt/activities.next \
  ghcr.io/llun/activities.next:latest
```

The volume mount persists your SQLite database and uploaded media between container restarts.

For PostgreSQL or advanced Docker setups, see:

- [SQLite Docker Deployment](docs/sqlite-setup.md#docker-deployment-with-sqlite)
- [PostgreSQL Docker Deployment](docs/postgresql-setup.md#docker-deployment-with-postgresql)

### Vercel

1. Fork this repository
2. Connect it to your Vercel account
3. Add the required environment variables (see [Setup Guide](docs/setup.md))
4. Deploy

> **Note:** Vercel deployments require an external PostgreSQL database and S3-compatible storage.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Setup Guide](docs/setup.md) | General configuration and first-time setup |
| [Architecture](docs/architecture.md) | System architecture, data flow, and design decisions |
| [SQLite Setup](docs/sqlite-setup.md) | SQLite database configuration and Docker deployment |
| [PostgreSQL Setup](docs/postgresql-setup.md) | PostgreSQL database configuration and Docker deployment |
| [Environment Variables](docs/environment-variables.md) | Complete reference for all configuration options |
| [Feature Roadmap](docs/features.md) | Current and planned features |
| [Maintenance Scripts](docs/maintenance.md) | Admin scripts for media cleanup and user management |
| [Contributing](CONTRIBUTING.md) | Guidelines for contributors |

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, coding standards, and pull request process.

## 📄 License

This project is licensed under the MIT License — see [LICENSE.md](LICENSE.md) for details.
