# Quickstart

The fastest way to get a local Activity.next instance running, with the **least
amount of setup**. This uses SQLite (a single file, no database server) and the
three environment variables that are strictly required.

For production deployments, federation, media storage, email, and every other
option, see the [Setup Guide](setup.md) and the
[Environment Variables Guide](environment-variables.md).

## Prerequisites

- **Node.js 24** or higher
- **Yarn** (enabled via Corepack)

## 1. Clone and install

```bash
git clone https://github.com/llun/activities.next.git
cd activities.next
corepack enable
yarn install
```

## 2. Create a minimal `.env.local`

Only three settings are strictly required to boot the app: the host, a secret
phrase, and a database. SQLite needs no server, so this is the least-effort
choice:

```bash
ACTIVITIES_HOST=localhost:3000
ACTIVITIES_SECRET_PHASE=local-dev-secret-phrase-change-me
ACTIVITIES_DATABASE_CLIENT=better-sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
```

> **Local sign-in over `http`:** add `ACTIVITIES_INSECURE_AUTH=true` so the
> instance accepts `http://localhost` sign-in. Without it, sign-in is forced to
> `https` and fails with `403 Invalid origin`.
>
> **Restrict who can register (optional but recommended):** add
> `ACTIVITIES_ALLOW_EMAILS='["you@example.com"]'` (single-quoted so the JSON
> array survives). Only listed emails can sign up.

A practical local `.env.local` therefore looks like:

```bash
ACTIVITIES_HOST=localhost:3000
ACTIVITIES_SECRET_PHASE=local-dev-secret-phrase-change-me
ACTIVITIES_INSECURE_AUTH=true
ACTIVITIES_ALLOW_EMAILS='["you@example.com"]'
ACTIVITIES_DATABASE_CLIENT=better-sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
```

> **Generate a real secret** for anything beyond throwaway local use:
> `openssl rand -base64 32`. In production, `ACTIVITIES_SECRET_PHASE` must be at
> least 32 characters or the app refuses to start.

## 3. Migrate and run

```bash
yarn migrate   # creates the SQLite schema in ./dev.sqlite3
yarn dev       # starts the dev server on http://localhost:3000
```

## 4. Sign up

Open `http://localhost:3000/auth/signup` and create your account with an email
that is in `ACTIVITIES_ALLOW_EMAILS` (or any email if you left it unset).

That's it — you now have a running instance.

## What's intentionally left out

To keep this minimal, the steps above skip everything optional. Each is disabled
or runs in a degraded-but-fine mode until you configure it:

| Feature            | Default without config        | Where to enable                                                             |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------- |
| Media uploads      | Disabled                      | [Setup Guide → Media Storage](setup.md#media-storage-optional)              |
| Email verification | Disabled                      | [Setup Guide → Email](setup.md#email-configuration-optional)                |
| Background jobs    | Run synchronously             | [Setup Guide → Queue](setup.md#queue-configuration-optional)                |
| Push notifications | Disabled                      | [Setup Guide → Push Notifications](setup.md#push-notifications-optional)    |
| Federation         | Needs a public domain + HTTPS | [Setup Guide → Starting the Application](setup.md#starting-the-application) |

## Next steps

- **Production / real deployment:** [Setup Guide](setup.md)
- **All configuration options:** [Environment Variables Guide](environment-variables.md)
- **Database choices:** [SQLite Setup](sqlite-setup.md) · [PostgreSQL Setup](postgresql-setup.md)
