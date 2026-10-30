# Contributing to Activities.next

Thank you for your interest in contributing to Activities.next! This document provides guidelines and information for contributors. The rules below apply to every change; the [Definition of Done](AGENTS.md#definition-of-done-read-this-first) and the routing table remain in [AGENTS.md](AGENTS.md), and the sections here preserve the detailed commands, tests, review process, and rationale.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Testing Guidelines](#testing-guidelines)
- [Task Recipes](#task-recipes)
- [Design Library Sync](#design-library-sync)
- [Documentation Maintenance](#documentation-maintenance)
- [Commit & Pull Request Guidelines](#commit--pull-request-guidelines)
- [Code Review Loop (Sub-Agents)](#code-review-loop-sub-agents)

## Documentation and rule map

The root files are indexes into the durable guides:

- [AGENTS.md](AGENTS.md) contains the Definition of Done, cross-cutting conventions, and the routing table.
- [REVIEW.md](REVIEW.md) is the actionable review checklist.
- [Architecture rules](docs/architecture.md), [Mastodon compatibility rules](docs/mastodon-api-compatibility.md), [fitness and storage rules](docs/fitness-file-storage.md), [maintenance rules](docs/maintenance.md), and the [setup guide](docs/setup.md) own subsystem detail.
- [Design Library Sync](#agents-design-library-sync) explains how design changes reach the Sketch library in `llun/sketch`.
- [Documentation maintenance](#agents-documentation-maintenance) explains how durable docs stay navigable and current.

These references complement AGENTS.md; they do not relax its mandatory core. Keep linked rules consistent when behavior changes.

## Code of Conduct

This project follows the standard open source code of conduct. Be respectful, inclusive, and considerate in all interactions.

## Getting Started

### Prerequisites

- **Node.js 24** (the `engines` field in `package.json` pins `24.x`)
- **Yarn 4** via Corepack (the exact version is pinned by the `packageManager` field in `package.json`)
- **Git**
- A code editor (VS Code recommended)

### Setting Up Development Environment

1. **Fork and clone the repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/activities.next.git
   cd activities.next
   ```

2. **Enable Corepack** (for Yarn 4 support):

   ```bash
   corepack enable
   ```

3. **Install dependencies**:

   ```bash
   yarn install
   ```

   > **Note:** `yarn install` at the repository root installs all workspaces (the core app plus optional packages under `packages/`), providing all database drivers and queue clients out of the box for development.

4. **Set up your environment**:

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your local configuration
   ```

   At minimum, set `ACTIVITIES_HOST`, `ACTIVITIES_SECRET_PHASE`, and a database configuration (e.g., `ACTIVITIES_DATABASE_CLIENT=better-sqlite3`).

5. **Run database migrations**:

   ```bash
   yarn migrate
   ```

6. **Start the development server**:

   ```bash
   yarn dev
   ```

7. **Open your browser** to [http://localhost:3000](http://localhost:3000)

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feature/description` - For new features
- `fix/description` - For bug fixes
- `docs/description` - For documentation changes
- `refactor/description` - For code refactoring

Keep commits small and focused, with clear, descriptive messages, building on each other logically.

### Commit Messages and Version Bumps

<a id="review-commits-versioning"></a>

**Do NOT manually change the `version` field in `package.json`.** A CI workflow automatically bumps the version based on commit message prefixes after merge. Manual version changes in PRs will conflict with the automated workflow.

The version-bump workflow reads commit prefixes to determine the next semver version. Use these prefixes to control version bumping:

| Prefix               | Version bump    | When to use                                                                                                                  |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `none:`              | None            | For internal-only changes that do not require a release (e.g. documentation, CI configuration)                               |
| `major:`             | Major (`X.0.0`) | Breaking change approved by a human maintainer with the `release:major` label. Without that label, it produces a minor bump. |
| `minor:`             | Minor (`x.Y.0`) | New backwards-compatible features users can opt into (e.g. new endpoint, new UI page, new optional config)                   |
| _(any other prefix)_ | Patch (`x.y.Z`) | Bug fixes, refactors, chores, docs, tests — anything that doesn't change the public-facing contract                          |

PRs are **squash-merged**, so the **PR title becomes the commit subject** on `main`. The workflow checks the commit subject first, then falls back to scanning the commit body (which contains the individual commit messages).

**To ensure a minor version bump, the PR title MUST start with `minor:`.** A `major:` title produces a major bump only after a human maintainer applies the `release:major` label to the feature PR. Agents must never apply this label. Without it, `major:` produces a minor bump. The tag workflow independently verifies that approval on the source PR. For example:

```text
minor: add hashtag timeline support        ← PR title → minor bump
major: remove legacy v1 API endpoints      ← PR title + human `release:major` label → major bump
feat: fix button alignment                 ← PR title → patch bump (default)
```

If the PR title uses a generic prefix (e.g. `feat:`) but an individual commit inside the PR uses `minor:`, the workflow will also detect it from the squash-merge body. However, **setting the PR title is the most reliable approach** since it is always the commit subject.

Commits that change only files under `.github/` are also treated as no-bump by default, unless the commit message explicitly uses `major:` or `minor:`. When the repository has no version tag yet, the workflow still bootstraps `v1.0.0` regardless of commit history.

After a merge to `main`, the version-bump workflow opens an auto-merging `Bump version to vX.Y.Z` PR from the reserved `version-bump/main` branch — leave that branch and PR alone. That bump PR's first `pull_request` CI run can fail at startup with no jobs at all (the bot's force-push can race the workflow registration); the version-bump workflow's close/reopen kick re-fires the run, so such a failure is non-gating. The merged bump commit is tagged by `tag-version.yml`, and `package.yml` builds and publishes multi-arch Docker images (tagged `main`) to GHCR and Docker Hub on every push to `main`. The sync to the production deployment does **not** follow each merge: `sync-main-to-prod-dispatch.yml` runs once a day at 01:17 UTC and dispatches the newest of the last 30 `main` commits on which CI, Package and CodeQL all succeeded (skipping the day with a warning if none has; a merge whose checks have not finished waits for the next run). To ship sooner, run activities.prod's `sync-upstream.yml` by hand, or run `sync-main-to-prod-dispatch.yml` to apply the same selection now.

### Pull Request Process

#### Before Submitting

Run all checks in order:

```bash
yarn run prettier --write .       # Format code
yarn lint                        # Lint — must pass with no errors
yarn typecheck                   # Type check — must pass
yarn build                       # Build — must succeed
yarn test                        # Tests — must pass
```

Also:

- Update every doc your change makes stale — grep `*.md` and `docs/` for renamed or removed commands, env vars, routes, and scripts (see [Documentation Maintenance](#agents-documentation-maintenance))
- Test manually if UI changes are involved
- Rebase on main to ensure clean history:

  ```bash
  git fetch origin
  git rebase origin/main
  ```

#### PR Guidelines

- **Title**: Clear and descriptive (follows conventional commit format)
- **Description**: Explain what and why, not just how
  - What problem does this solve?
  - What approach did you take?
  - Any breaking changes?
  - Test results, and notes for config/migrations
  - Screenshots for UI changes (optional, not required)
- **Link issues**: Reference related issues using `Fixes #123` or `Relates to #456`
- **Keep PRs focused**: One feature/fix per PR

#### CI Status Checks

<a id="review-ci-checklist"></a>

Branch protection on `main` requires the `All Tests`, `Lint and Prettier`, and `Build` checks (strict: false).

The workflow fires on `pull_request`, on pushes to `main`, and on `workflow_dispatch`, once per commit: `cancel-in-progress` concurrency kills a superseded run when a new push lands on the same ref, so a PR has exactly one CI run per head commit.

Every job pins the runner image (`runs-on: ubuntu-24.04`) and carries a `timeout-minutes` ceiling (5 to 40 depending on the job), so a hung job fails instead of burning GitHub's six-hour default.

Every install step goes through the shared composite action `.github/actions/install`: `yarn install --immutable`, retried up to twice only when the log shows a YN0001 transport error with a network code (`ECONNREFUSED`, `ECANCELED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ENOTFOUND`, `EPIPE`, `socket hang up`, `ERR_SSL`, `ERR_TLS`). A YN0028 (the lockfile would change) or any other failure is a code error and runs once.

`.github/workflows/ci-rerun.yml` re-runs the failed jobs of a failed CI run exactly once (`run_attempt == 1`) when every failed job provably ran no repository code: a job GitHub never gave a runner (reported as `abandoned`/`queued` with no steps) or one whose only failed steps are the runner's own setup steps. `.github/scripts/classify-ci-rerun.mjs` decides from the jobs API; any failed step that runs checkout code (install, lint, build, test, docker) blocks the re-run, and the workflow never checks out the PR's code.

Dependabot runs one job per manifest the dependency graph indexes. Only the `/` npm entry (daily) may bump dependencies, because the Yarn workspaces share the root `yarn.lock`; the `/packages/*` entries carry `open-pull-requests-limit: 0` and `ignore: dependency-name: '*'` so their security-update jobs open nothing (see `.github/dependabot.yml`) — a workspace-rooted PR would edit `package.json` alone, which `yarn install --immutable` refuses.

`All Tests` is the fail-closed fan-in over the four SQLite test shards and the two PostgreSQL test shards (`PostgreSQL Tests (shard N/2)` — shard 1 also runs the SQLite and PostgreSQL schema dump drift checks). `CI Success` is the overall aggregate of every job in the workflow: it fails closed over every upstream job (`Lint and Prettier`, `Type Check`, `Build`, `Test Shard N of 4`, `PostgreSQL Tests (shard N/2)`, `All Tests`, and the Docker smoke jobs `Docker Images Smoke Test (minimal)` / `(full)`). It is not required by the ruleset; it only reports the workflow-wide result.

The `Build` job persists only `.next/cache`, including Next.js's default Turbopack filesystem build cache. Its versioned cache key includes the runner OS, Yarn lockfile, build configuration, and application source; a lockfile-prefix restore lets changed source reuse a prior build cache. Generated build outputs outside `.next/cache` are rebuilt on every run, and Yarn's archive cache remains managed by `actions/setup-node`.

The separate Docker packaging workflow (`.github/workflows/package.yml`) reuses GitHub Actions BuildKit caches scoped as `activities-next-minimal-amd64` and `activities-next-minimal-arm64`. The GHCR build imports and exports all intermediate layers (`mode=max`); cache export failures do not fail publication. The following Docker Hub build imports the same cache and reuses the job's Buildx builder without exporting again. Registry authentication, digest pushes, and manifest publication follow the existing workflow.

## Coding Standards

### TypeScript

- **Use strict TypeScript**: Avoid `any` types — use proper types or `unknown`
- **Type everything**: Functions, parameters, and complex objects should have explicit types
- **Use TypeScript features**: Interfaces, type guards, utility types, etc.

### Code Style

Prettier formats (no semicolons, single quotes, import sorting, 2-space
indentation) and Oxlint lints; the Husky pre-commit hook formats the staged
files (lint-staged runs `prettier --write` on them) and then runs `yarn lint`
over the whole repo before every commit (see [Commit & Pull Request
Guidelines](#agents-commit-pull-request-guidelines)). In VS Code, use the
`oxc.oxc-vscode` extension (the ESLint extension no longer applies). Import
paths, naming, and the lint rule inventory (including why `yarn lint` runs a
second pass over `scripts/` with `lint/oxlintrc.scripts.json`) live in
[AGENTS.md → Coding Style & Naming Conventions](AGENTS.md#coding-style--naming-conventions)
and the [setup guide](docs/setup.md#agents-build-test-and-development-commands).

Run formatting and linting:

```bash
yarn run prettier --write .
yarn lint
```

### Naming Conventions

- **Files**: camelCase for utilities, PascalCase for components
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **React Components**: PascalCase

### React Components

- Use functional components with hooks
- Prefer named exports for components
- Use TypeScript interfaces for props
- Keep components focused and single-purpose

Example:

```typescript
interface ProfileCardProps {
  actor: Actor
  isFollowing: boolean
  onFollow: () => void
}

export const ProfileCard: FC<ProfileCardProps> = ({
  actor,
  isFollowing,
  onFollow
}) => {
  // Component implementation
}
```

### Logging

Never use `console.*` in committed code; use the server-side logger — see [Logging Guidelines](AGENTS.md#logging-guidelines).

### API Responses

Always use `apiResponse` / `apiErrorResponse` from `@/lib/utils/response`, never `Response.json()` — see [API Response Guidelines](AGENTS.md#api-response-guidelines).

### Zod Validation

Always `safeParse` (never `.parse()`), bound strings with `.max(n)`, and normalize empty strings to `null` for nullable columns — see [Zod Validation in API Routes](docs/mastodon-api-compatibility.md#agents-zod-validation-in-api-routes).

### Settings Forms

Settings forms are client components that submit through named exports in `lib/client.ts`, never plain HTML `<form method="post">` or direct `fetch()` — see [Settings Forms (Client Components)](docs/architecture.md#agents-settings-forms-client-components).

### Better-auth Plugins

Do not register a better-auth plugin unless its required database tables exist in migrations, and gate admin/dashboard plugins with explicit access control — see [Better-auth Plugin Guidelines](docs/architecture.md#agents-better-auth-plugin-guidelines).

## Project Structure

```
activities.next/
├── app/                       # Next.js App Router
│   ├── (timeline)/            # Timeline routes (with sidebar)
│   ├── (nosidebar)/           # Auth routes (no sidebar)
│   ├── embed/                 # Public embed widgets (heatmaps)
│   ├── health/                # Health liveness probe
│   ├── api/                   # API routes
│   │   ├── auth/              #   Authentication (better-auth)
│   │   ├── inbox/             #   Shared ActivityPub inbox
│   │   ├── nodeinfo/          #   NodeInfo 2.0 / 2.1 metadata
│   │   ├── oauth/             #   OAuth 2.0 provider
│   │   ├── oembed/            #   Public oEmbed endpoint
│   │   ├── users/             #   ActivityPub actor endpoints
│   │   ├── v1/                #   Mastodon-compatible API v1
│   │   ├── v2/                #   Mastodon-compatible API v2
│   │   └── well-known/        #   Federation discovery
│   └── layout.tsx             # Root layout
├── lib/                       # Core application logic
│   ├── actions/               # Server actions
│   ├── activities/            # ActivityPub protocol logic
│   ├── components/            # Shared React components
│   ├── config/                # Configuration loaders
│   ├── database/              # Database abstraction (Kysely)
│   ├── jobs/                  # Background job handlers
│   ├── services/              # Business logic services
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions
├── migrations/                # Database migrations (Kysely) and the schema dumps
├── packages/                  # Modular optional workspace packages
│   ├── cloudtasks/            #   Google Cloud Tasks queue adapter (@activities/cloudtasks)
│   ├── pg/                    #   PostgreSQL database driver (@activities/pg)
│   └── qstash/                #   Upstash QStash queue adapter (@activities/qstash)
├── docs/                      # Documentation
├── lint/                      # Local Oxlint JS plugin (AGENTS.md conventions)
├── test/                      # Tests for root-level files (next.config, proxy, instrumentation) + Vitest setup
├── public/                    # Static assets
└── scripts/                   # Development/admin scripts (backup/, fitness/, maintenance/, mock/)
```

### Important Files

- `package.json` — Dependencies, scripts, and workspace configuration
- `packages/` — Optional dependency workspaces (`@activities/cloudtasks`, `@activities/pg`, `@activities/qstash`)
- `tsconfig.json` — TypeScript configuration (editors, `yarn tsc`, and `yarn typecheck`)
- `tsconfig.build.json` — what `next build` type-checks (excludes tests)
- `.oxlintrc.json` + `lint/oxlintrc.scripts.json` + `lint/agentsRules.mjs` — Oxlint rules
- `package.json` → `prettier` — Code formatting rules
- `vitest.config.ts` — Test configuration
- `next.config.ts` — Next.js configuration
- `migrations/index.ts` — the migrations `yarn migrate` runs (`scripts/database/migrate.ts`), with their names in `migrations/names.ts`
- `Dockerfile` — Docker container build

<a id="agents-testing-guidelines"></a><a id="review-style-imports-tests"></a>

## Testing Guidelines

- Vitest is configured via `vitest.config.ts`; the project is ESM-only
  (`"type": "module"`). Use the Vitest API (`vi.fn()`, `vi.mock()`,
  `vi.spyOn()`, …) — do not write `jest.*` calls. The minimal global `jest`
  proxy is only a compat shim for third-party libraries like `jest-fetch-mock`
  (`test/setup/jest-global.ts`), not for first-party tests; the `jest.Mock` /
  `jest.MockedFunction` / `jest.Mocked` **type** names still work via
  `test/vitest.d.ts`.
- **The suite's clock is pinned to `TZ=UTC`**, set in Vitest's **main process**
  (`vitest.config.ts` assigns `process.env.TZ` at the top of the file) — in
  `test.env` the assignment reaches only the worker thread, where it changes
  the variable without changing the zone `Date` and `Intl` use.
  `test/vitest.config.test.ts` runs in both projects and fails if either pool
  is not in UTC. The pin is a backstop, not a licence: a formatter whose
  output must not depend on the viewer's zone still has to say
  `timeZone: 'UTC'` itself, because production is not running under the pin.
  An external `TZ` does not override it (`TZ=Pacific/Noumea yarn test` still
  runs in UTC); the CI `test-shards` job sets `TZ: Pacific/Noumea` on purpose
  so the config test can fail on a UTC runner too — do not "tidy" that to
  UTC. A test that needs another zone wraps the code in `withTimeZone` from
  `@/lib/testing/withTimeZone` (a bare `process.env.TZ = '…'` inside a test
  does nothing on a worker thread and leaves the test passing without testing
  anything); the helper throws when the zone did not move, and
  `vitest.config.ts` routes every file that imports it to the `forks` project
  (see the worker-threads rule below).
- **The suite runs with `LOG_LEVEL=silent`** (`vitest.config.ts` →
  `test.env`). Assert logging by spying on `logger.*` (a spy records the call
  whatever the level), never by reading output; a test of the logger's own
  level handling sets or deletes `LOG_LEVEL` itself, as
  `lib/utils/logger.test.ts` does.
- **Never wait out a timer in real time.** Install `vi.useFakeTimers()` just
  before the action that arms the timer (after any `waitFor` setup, which
  needs real timers), import the component's own timeout constant, and pin
  both sides of the boundary: advance to `TIMEOUT - 1` and assert nothing
  happened, then by one more and assert it did. Restore with
  `vi.useRealTimers()` in `afterEach`.
- **Test files run on worker threads, except those that call `process.chdir()`
  or import `withTimeZone`.** `vitest.config.ts` defines two projects:
  `threads` (every test file, one fresh worker thread per file) and `forks`
  (files that `process.chdir()` into a temp directory — Node rejects that
  call inside a worker thread — or move the time zone with `withTimeZone`,
  which a worker thread silently ignores). The config finds them by scanning
  test files for `process.chdir(` and for an import specifier ending in
  `/withTimeZone` (also catching generic, aliased or namespace calls), so a
  new such file needs no list edit and one the scan misses fails rather than
  passing. Each worker thread gets its own `VITEST_POOL_ID`, so the
  `TEST_DATABASE_TYPE=pg` harness keeps one database per worker. Two faster
  options were measured and declined: `isolate: false` failed 163 files on
  leaked cross-file state, and running the jsdom files on `vmThreads` breaks
  any test that redefines `window.location` (unforgeable in a VM context) and
  carries Vitest's documented VM-pool memory caveat.
- **Import `date-fns` functions from their sub-path**
  (`import { format } from 'date-fns/format'`), never the barrel — the barrel
  evaluates every date-fns function in each isolated test file that
  transitively reaches it. Oxlint's `no-restricted-imports` rejects the bare
  `'date-fns'` import in `app/` and `lib/`.
- **Seed password fixtures at bcrypt cost 4** (`TEST_BCRYPT_COST` in the auth
  tests): `bcrypt.compare` reads the cost from the stored hash, so a
  fixture's cost changes nothing a test asserts, while cost 10
  (production's, in `lib/services/auth/auth.ts`) costs tens of milliseconds
  per hash and per sign-in verify.
- The Vitest default environment is `node`. Any test that renders React or
  touches the DOM must start with a `/** @vitest-environment jsdom */` docblock
  (Vitest 4 removed `environmentMatchGlobs`, so there is no glob-based
  opt-in); jsdom tests get `http://localhost:3000` as their URL via
  `environmentOptions`. A `.test.tsx` without the docblock fails with
  "document is not defined".
- `test/setup/vitest.setup.ts` installs global mocks that apply to EVERY test:
  the `@/lib/config` barrel (host `test.llun.dev`, in-memory SQLite — a new
  barrel export must also be added to the setup-file factory and
  `lib/config/__mocks__/index.ts`, or every test that hits it fails with
  "x is not a function"), `got`, `node:dns/promises`, and `fetch` via
  jest-fetch-mock's global `fetchMock` (passthrough by default — call
  `fetchMock.doMock()` / `mockResponse…` to stub). It also installs a
  jsdom-only guard on `HTMLElement`/`SVGElement` `focus()` that caps
  synchronous re-entry depth: jsdom fires focus events synchronously, so
  Radix UI's `FocusScope` (DropdownMenu, Dialog, …) can re-enter `focus()`
  without settling and overflow the stack when a menu closes as a dialog
  opens; real focus flows never nest that deep, so normal `focus()` /
  `document.activeElement` behavior is unchanged.
- CI (`.github/workflows/ci.yml`) runs the full job set listed in [CI Status
  Checks](#ci-status-checks) on every pull request and push to `main` — lint + prettier-check,
  **type check**, build, four parallel SQLite test shards, and two PostgreSQL
  test shards (built from the file list generated by
  `scripts/maintenance/listPostgresTestFiles.ts`; shard 1 also regenerates the
  SQLite and PostgreSQL schema dumps from the migrations and fails on drift),
  plus Docker smoke jobs for the minimal and full images. The merge ruleset on
  `main` requires the `All Tests`, `Lint and Prettier`, and `Build` checks
  (strict: false); the `All Tests` job fans in the test shards and the
  PostgreSQL shards, and the `CI Success` job aggregates every job in the
  workflow without being required by the ruleset.
  The SQLite test shards pin `TEST_DATABASE_TYPE: sqlite`.
- **New tests get their database from `createTestDatabase()`**
  (`lib/database/testing/createTestDatabase.ts`): the `Database` facade
  (`database`, with the schema-dump `migrate()`), a Kysely `db`, the
  PostgreSQL `prepare` step (a no-op on SQLite), `destroy`, `backend`, and
  the statement capture described below (`captureQueries`, `onQuery`,
  `pendingAcquires`). Seed or inspect state the public `Database` methods
  cannot reach with `db` and the helpers in `lib/database/testing/fixtures.ts`;
  use a public method instead when one already does the job. A test that
  needs a connection of its own (the connection and sqlcommenter tests) opens
  it with `createDatabaseConnection` and `getTestDatabaseConfig(backend)`,
  and destroys it. The helpers below are one-line aliases over
  `createTestDatabase`; `lib/database/testUtils.ts` keeps the older helpers
  as aliases.
- **To assert on the SQL a call sends, capture it with
  `testDb.captureQueries(work)`.** It resolves to the `{ sql, bindings }[]`
  the driver sent while `work` ran, in order, with the `begin` / `commit` /
  `rollback` of any transaction; statements sent before or after `work` are
  not in it, and statements another caller sends while it runs are (the
  capture is a window in time on the whole pool, not on `work`'s async
  context). Captures nest; if `work` throws, the error is rethrown and the
  statements are lost. Match the placeholder, not the identifier quoting
  (Kysely double-quotes identifiers on both backends; the same statement
  differs only in `?` vs `$1`). `testDb.onQuery(listener)` calls
  `listener({ sql, bindings, connection })` for every statement and returns
  the unsubscribe function — use it when a test needs the `connection` (equal
  strings mean the same connection: "inside one open transaction" vs
  "autocommitted elsewhere") or must stop a runaway loop (a listener that
  throws fails the statement that triggered it).
  `getTestDatabaseWithInstance()` returns the same `captureQueries`,
  `onQuery` and `db` next to its `database`. `testDb.pendingAcquires()` is
  how many callers are queued for a pooled connection, for a race test that
  has to know another caller is stuck.
- **`getTestSQLDatabase` and `getTestSQLDatabaseWithInstance` are SQLite-ONLY
  and ignore `TEST_DATABASE_TYPE` entirely** — a suite built on either
  reports a clean pass under the pg environment variables having never opened
  a PostgreSQL connection. `getTestDatabaseTable()` (for a `describe.each`
  over backends) and `getTestDatabaseWithInstance()` do honour it. When a
  claim about cross-backend behaviour matters, point `TEST_DATABASE_HOST` at
  an unreachable address first: a suite that still passes is not running
  where you think it is.
- **To reach the branch a concurrent writer would take in a read-then-write,
  stage the race with `withStaleFirstRead(db, table, stale)`**
  (`lib/database/testing/staleRead.ts`): the first SELECT from `table` sees
  `stale(rows)` instead of what is stored, standing in for another request
  writing between the query function's read and its write, so the
  unique-conflict and guarded-update branches run on both backends. Row locks
  are checked on PostgreSQL itself: capture the statements with
  `testDb.captureQueries` and assert the `for update`.
- **To grab a mocked module and configure it, use `vi.importMock<T>('@/path')`,
  not `(await import('@/path')) as unknown as T`.** `vi.importMock` is
  purpose-built, always returns the mock, and is typed as `MaybeMockedDeep<T>`
  (no `as unknown as` cast needed); a bare `await import()` returns the
  **real** module unless it is separately `vi.mock`'d. `vi.importMock` **is**
  a valid, documented Vitest API — do not "fix" it on a review bot's say-so
  that it does not exist.
- **"Always returns the mock" stops holding the moment a factory AWAITS
  `importOriginal()`** — the trigger is that call, **not** the factory being
  async (a sync factory, an async one with no `importOriginal` parameter, and
  an async one that never calls it all return the factory's result). Then
  `vi.importMock` hands back the **original** module — real, callable, and a
  DIFFERENT object from the one the module under test was given, so
  `vi.mocked()` on it configures and asserts nothing while calling it runs
  the real implementation. Read a partial mock (the
  `{ ...(await importOriginal()), fn: vi.fn() }` shape) through a plain
  static import, which does resolve to the mock.
- **`vi.restoreAllMocks()` does not reset a `vi.fn()` a `vi.mock` factory
  created** — it only iterates the spies `vi.spyOn` registered, so a module
  mocked as `vi.mock('@/path', () => ({ fn: vi.fn() }))` carries the last
  test's return value — implementation AND call history — for the rest of the
  file, however thorough the `afterEach` looks. Reset each such export
  explicitly in `beforeEach` (`vi.mocked(fn).mockReset()`), and pin the reset
  with a guard test placed last in the block so it runs after the tests that
  dirty the mocks.
- **A test must pass whichever test in its file ran before it.** The tests
  inside one file share every mock handle and every row the file's
  `beforeAll` built, and two leaks hide there. `vi.clearAllMocks()` empties
  call history but keeps queued `mock…Once` values, so a
  `mockResolvedValueOnce` queued for a call a test's path never makes answers
  the next test's first call instead of that test's own default — reset
  module-level `vi.fn()` handles in `beforeEach` and set their defaults again
  straight after (`mockReset()` also drops a default given at creation,
  `vi.fn().mockReturnValue(x)`, while `vi.fn(impl)` keeps `impl`). And a test
  that announces, blocks, deletes or likes hands those rows to whichever test
  runs next — build the database in `beforeEach` and destroy it in
  `afterEach`, or, on the PostgreSQL harness where `prepare` recreates a
  whole database, have each test seed the rows it asserts on under ids of its
  own. CI runs tests in declaration order and cannot see either leak; check
  with `yarn test --sequence.shuffle --sequence.seed=<n>` over a few seeds.
- **`toHaveBeenCalledWith` asks whether a call ever happened, never whether
  it was the only one.** A once-per-run summary asserted that way is equally
  satisfied by one logged per row (the last row carries the correct
  cumulative totals) — pin "once" by filtering
  `vi.mocked(console.log).mock.calls` and asserting the list with `toEqual`,
  over a fixture large enough that the wrong placement logs twice (two rows
  at `batchSize: 1` separates per-row, per-batch and after-the-loop). The
  same gap hides a hardcoded page size: at fixture scale one big batch and
  several small ones write the same rows, so paging is only observable by
  counting the SELECTs `captureQueries` reports.
- **To control when an awaited call settles, import `createDeferred` from
  `@/lib/testing/deferred`** — do not hand-roll another
  promise-with-exposed-resolve helper. Its promise stays **pending** until a
  test settles it: the pending render and the settled one are separate
  flushes, so a `Promise.resolve(value)` stand-in collapses them into the
  first `act()` and the in-flight assertion passes vacuously.
- **A test that shows a client component hydrates the server's HTML without
  a mismatch calls `hydrateServerHtml` from `@/lib/testing/hydrateServerHtml`**
  rather than repeating the `renderToString` / `hydrateRoot` / `act()`
  boilerplate, and calls the `unmount()` it returns in a `finally` — an
  abandoned root keeps its effects' timers and listeners alive into later
  tests.
- **React `cache` does not memoize under Vitest, so a test for a `cache()`d
  helper has to stand a request scope up itself — `runInReactCacheScope`
  from `@/lib/testing/reactCacheScope`.** The client build Vitest resolves
  is a hard passthrough; only the `react-server` build — the one Next.js
  loads for Server Components and route handlers — keys on the arguments,
  and only while an async cache dispatcher is installed (that dispatcher
  **is** the request scope). A test that calls a memoized helper twice and
  expects one query reads two and proves nothing; the natural "fix" is to
  weaken the assertion. Swap the server build's `cache` in with
  `vi.mock('react', …)` returning that module's `serverCache`, then wrap the
  calls in `runInReactCacheScope` — one call is one request, with a fresh
  store, restored afterwards — and **sequentially**: React's dispatcher is
  one mutable global, so a second scope entered while one is live throws
  rather than nesting. `app/(timeline)/[actor]/profileFollowLookup.test.ts`
  is the worked example.
- Prefer unit tests near `lib/` and route tests near `app/`.
- **Test a behaviour once, at the layer that owns it.** A parent component's
  test checks that it wires a child in, not the child's behaviour again — the
  route privacy hint's tap timer is tested in `ActivityRouteMapKit` and
  `ActivityMapPanel`, which each own a timer, and not again through
  `FitnessStatusDetail`, which only renders `ActivityMapPanel`. Copies at
  several layers fail together on one change and slow the suite.
- **Don't re-test OAuth scope or "401 without a session" in each route's own
  test file.** For a route guarded by `OAuthGuard`, `OAuthGuardAnyScope`,
  `OptionalOAuthGuard` or `OAuthAppGuard`, add it to `EXPECTED` in
  `app/api/v1/routeScopeWiring.test.ts` (and to `MULTI_METHOD` if its methods
  use different scopes, and with `guard` if it is not `OAuthGuardAnyScope`).
  That test pins the scope literals (per method for `MULTI_METHOD` routes, as
  a set for the rest) and which guard each exported method is behind, so an
  any-of → all-of or required → optional switch fails; it also asserts that
  no listed route opts into `unconfirmedAccount` (except
  `emails/confirmations`, its single documented recovery carve-out), and
  fails if a route whose handlers carry an OAuth guard is in neither
  `EXPECTED` nor `UNLISTED_BASELINE` (now empty, with all routes pinned). A
  route that builds its guard inside its own handler goes in
  `GUARDED_BY_OWN_CODE` with the test that pins its scopes; `MULTI_METHOD`
  entries must name every guarded method the route exports.
  `lib/services/guards/OAuthGuard.{session,token,accountState}.test.ts` cover
  what each guard then does (no session, wrong scope, a parent scope,
  unconfirmed accounts) once, for every route; two routes keep an end-to-end
  check against the real guard as a canary —
  `app/api/v1/preferences/route.test.ts` for a read and
  `app/api/v1/notifications/clear/route.scopes.test.ts` for a write. This
  applies only to that guard family: routes behind `AuthenticatedGuard` or
  their own session check have no wiring table, so their own 401/403 tests
  are the only proof and must stay. A test that drives a real guard supplies
  the bearer token's row through the `Database` the guard is given, never by
  mocking the connection: the guard suites and the route canaries call
  `stubAccessTokenLookup` (`lib/services/guards/OAuthGuard.testUtils.ts`),
  which stubs `getOAuthAccessTokenByHash` on their test database (a token it
  has no row for is looked up in the real table), and a route test whose
  `getDatabase()` is a hand-built object gives it a
  `getOAuthAccessTokenByHash` of its own. The row has the shape of
  `OAuthAccessTokenRecord`, `expiresAt` in epoch milliseconds.
- **Assert what the user or caller sees.** Query by role, label or text
  rather than `toHaveClass`/`querySelector`, unless the class is the
  contract (a design-system token such as `.skeleton`). When asserting class
  absence, note that `.not.toHaveClass('a', 'b')` negates the conjunction and
  passes when _either_ class is absent — assert `.not.toHaveClass('a')` and
  `.not.toHaveClass('b')` separately when neither class may be present. Use
  `toHaveBeenCalledTimes` only when the count itself is the behaviour. Never
  assert exact call counts inside `waitFor`: `waitFor` retries on failure,
  so an assertion that was briefly true and then became false can never
  recover and flakes in CI — wait for the settled state inside `waitFor`,
  then assert the count once outside it.
- All tests run in parallel using isolated SQLite in-memory databases. The
  schema is loaded from the committed reference dumps (`migrations/schema*.sql`)
  via `lib/database/testing/schema.ts` rather than by running the migrations,
  so the dumps MUST stay in lockstep with the migrations (see
  [Keeping the reference schema dumps in sync](docs/setup.md#keeping-the-reference-schema-dumps-in-sync)).
- **`describe` / `it` names use plain descriptive text — do not prefix them.**
  Name the function or method under test directly (`describe('getVisibility', …)`,
  not `describe('#getVisibility', …)`), with no leading `#` or `.` sigil;
  `it` names read as a behavior statement
  (`it('returns null when actor is missing', …)`).
- For tests whose cases differ only by input and expected output, prefer a
  table-driven `it.each([...])('$description', …)` with a `description`
  column instead of repeating near-identical `it` blocks (keep
  `$description` strings under ~40 chars, since Vitest truncates longer
  values in test titles). Reserve standalone `it` blocks for cases with
  distinct setup or assertion shapes.
- **Prove every bug-fix or guard test against the reverted fix.** Temporarily
  revert the production fix (or introduce the mutant under test), confirm the
  new test fails for the expected reason, and restore the code before
  committing. When running manual mutation checks in a worktree, always
  `git checkout -- <file>` before finishing and verify `git status --short`
  is clean so a surviving mutant is never left on disk.
- Client components that fan out to children which render relative timestamps
  (e.g. `Posts`/`Post`) must receive `currentTime: number` from a Server
  Component and forward it. Add a regression test that renders the component
  with a fixed `currentTime` and a post created a known interval earlier,
  then asserts the rendered relative time (for example `posted 5 minutes
ago`); if the component calls `Date.now()` internally instead, the
  assertion fails. See `app/(timeline)/MainPageTimeline.test.tsx` for the
  pattern.

### Writing tests

- **Co-locate tests** with the code being tested, with **descriptive test
  names** that explain what is being tested
- **Follow the AAA pattern**: Arrange, Act, Assert
- **Test behavior**, not implementation details
- Aim for high coverage of business logic; don't skip edge cases, test error
  conditions, and mock external dependencies appropriately

### Running PostgreSQL database integration tests

Database integration test suites can also run against a local PostgreSQL 17
instance to verify cross-backend portability: set `TEST_DATABASE_TYPE=pg`
(with `TEST_DATABASE_HOST` / `TEST_DATABASE_USERNAME` /
`TEST_DATABASE_PASSWORD`, and optional `TEST_DATABASE_PORT` defaulting to 5432) against a throwaway **local** PostgreSQL. In that mode each Vitest
worker drops and recreates its **own** database named `test_<VITEST_POOL_ID>` — a single shared
database would let one worker destroy the schema another worker is mid-test on.
The schema loader runs `migrations/schema.sql` on a connection of its own
that it closes afterwards (`executeScript` in `lib/database/connection.ts`),
never on a pooled one: pg_dump's leading
`SELECT pg_catalog.set_config('search_path', '', false)` is session-scoped and
would otherwise leave that connection unable to resolve any unqualified table
name for the rest of its life.

1. Start a local disposable PostgreSQL 17 container:

```bash
docker run --rm -d --name test-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=activities \
  -e POSTGRES_PASSWORD=activities \
  -e POSTGRES_DB=postgres \
  postgres:17
```

2. Run one or more PostgreSQL-reaching test files with bounded worker concurrency (e.g. `--maxWorkers=2` to avoid connection exhaustion):

```bash
TEST_DATABASE_TYPE=pg \
TEST_DATABASE_HOST=127.0.0.1 \
TEST_DATABASE_PORT=5432 \
TEST_DATABASE_USERNAME=activities \
TEST_DATABASE_PASSWORD=activities \
yarn test --maxWorkers=2 \
  lib/database/domains/media/media.test.ts
```

There is no hand-written list of PostgreSQL test files to maintain — not in CI
and not here. `node scripts/run.cjs scripts/maintenance/listPostgresTestFiles.ts`
prints every test file whose import graph reaches a PG-capable test helper
(`createTestDatabase` and friends), and CI runs that generated list in two
shards, so a new database-reaching test is picked up automatically.

3. When finished, stop the container:

```bash
docker stop test-postgres
```

<a id="agents-known-failure-classes"></a>

### Known failure classes

- **A test-suite OOM that appears when a Radix menu closes while a dialog opens is `@radix-ui/react-focus-scope` ↔ jsdom focus-event recursion (stack overflow), not a heap leak.** The CI test matrix runs 4 shards with `NODE_OPTIONS="--max-old-space-size=8192"`; the two focus scopes hand focus back and forth through jsdom's synchronous focus events until the stack overflows. `test/setup/vitest.setup.ts` bounds that re-entry; a new OOM in a test that opens a dialog from a menu is this class first.
- **Probabilistic crypto chi-square tests (`lib/utils/crypto.test.ts`) flake at `alpha = 1e-4` by design and pass on re-run.** Do not "fix" a flake by shrinking the sample size — under the null hypothesis the test statistic stays `~chi-square(61)` regardless of sample size.
- **Worker `SIGABRT` in production is heatmap fan-out × Cloud Run concurrency, not a single-job code fault.** Recover crash-orphaned fitness imports (`pending` with `statusId = NULL`) with `scripts/fitness/repairFailedFitnessImports.ts`.
- **A red `All Tests` whose upstream job is `abandoned`/`queued` with no runner is GitHub runner allocation, not code.** `ci-rerun.yml` re-runs it once; if it happened on attempt 2, re-run by hand.
- **`Process completed with exit code 129` after the last `✓` with no Vitest summary is the runner's SIGHUP** (one-day incident on 2026-10-16); it is not auto re-run because the step ran repository code. Re-run by hand after checking the log has no `FAIL`.
- **`YN0028` on a Dependabot branch whose name contains `packages/` is a security-update job rooted in a workspace** (see `dependabot.yml`); close it — the `/` job's twin PR carries the lockfile.
- **A `pull_request`-only failure whose `push` sibling is green is merge-ref divergence first** (the PR branch's test against `main`'s changed contract, e.g. the 303/307 accounts redirect), not a flake.
- **A zero-job `failure` run on `version-bump/main`** is the startup failure the version-bump close/reopen kick heals; ignore it.

<a id="local-manual-browser-testing"></a>

### Local Manual / Browser Testing (SQLite + mock data)

Use this to run the app locally with a logged-in test user and seeded posts —
for example to verify UI changes or reproduce hydration issues in a browser.
These exact steps are verified to work; the gotchas below are load-bearing.

1. Create a git-ignored `.env.local` at the repo root:

   ```bash
   ACTIVITIES_HOST=localhost:3000
   ACTIVITIES_INSECURE_AUTH=true
   ACTIVITIES_SECRET_PHASE=local-dev-secret-phrase-change-me
   ACTIVITIES_ALLOW_EMAILS='["test@example.com"]'
   ACTIVITIES_DATABASE_CLIENT=better-sqlite3
   ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
   ```

   - `ACTIVITIES_INSECURE_AUTH=true` is **required** for local sign-in over
     `http`. Without it, `getBaseURL()` defaults to `https://…`, so better-auth's
     trusted origin becomes `https://localhost:…` and sign-in fails with
     `403 Invalid origin: http://localhost:…`.
   - Wrap JSON-valued vars like `ACTIVITIES_ALLOW_EMAILS` in **single quotes** so
     both `dotenv-flow` and shell `source` keep the inner double quotes.
   - `ACTIVITIES_HOST` must match the port the dev server actually serves on (the
     mock actor's domain is `config.host`). If port 3000 is taken, pick a free
     port and set both `ACTIVITIES_HOST` and `yarn dev --port` to it.
   - For repeatable public-page performance measurements, seed the deterministic
     fixture set instead (see **Create Web Vitals Fixtures** in
     [docs/maintenance.md](docs/maintenance.md#create-web-vitals-fixtures)).

2. Install deps, migrate, and seed mock data:

   ```bash
   yarn install          # Node.js 24
   yarn migrate          # dotenv-flow → auto-loads .env.local; prints the database first

   # The mock scripts do NOT auto-load .env.local.
   # Export the vars into the shell first, then run them:
   set -a; . ./.env.local; set +a
   # The project is ESM-only. Run scripts through the scripts/run.cjs bootstrap
   # (also wired into each script's shebang) so tsx loads them in CommonJS
   # mode — this resolves the app's extensionless and CommonJS-named imports,
   # which Node's strict ESM loader rejects.
   node scripts/run.cjs scripts/mock/createMockUser.ts      # testuser / test@example.com / testpassword123
   node scripts/run.cjs scripts/mock/createMockStatuses.ts  # seeds main (home) timeline posts
   ```

   The mock user is created already email-verified, so credential sign-in works.

3. Run the server and sign in:

   ```bash
   yarn dev --port 3000   # port must match ACTIVITIES_HOST
   ```

   Open `http://localhost:3000/auth/signin` and sign in with
   `test@example.com` / `testpassword123`. The seeded posts appear on the
   timeline at `/`.

4. Reproducing hydration mismatches in a browser: relative timestamps round
   coarsely (date-fns boundaries at 30s, 90s, …), so the natural SSR→hydration
   gap rarely crosses a boundary. To force a deterministic mismatch, override the
   browser clock before load (e.g. Playwright `addInitScript` setting
   `Date.now = () => realNow() + 180000`). With the bug present this throws a
   React hydration error naming the timestamp node; with `currentTime` passed
   from the server it does not, because both SSR and hydration use the identical
   server value.

<a id="agents-task-recipes"></a>

## Task Recipes

Ordered checklists for the most common task shapes. Follow them step by step;
each ends with the Definition of Done gate.

### Adding a Mastodon-style API endpoint

1. Create `app/api/v1/<name>/route.ts` exporting HTTP-method handlers (`GET`, `POST`, …).
2. Wrap handlers in the right guard from `lib/services/guards/` (e.g. `AuthenticatedGuard`, `AdminApiGuard`) — the guards already handle auth and same-origin proof.
3. Validate request bodies with Zod `safeParse` (never `.parse()` — lint-enforced); add `.max(n)` for sized columns and the empty→`null` transform for nullable text (see **Zod Validation in API Routes** in `docs/mastodon-api-compatibility.md`).
4. Take status/actor ids through `resolveStatusIdParam` / `resolveActorIdParam` (or their batch `…Params` forms) and emit them with `getClientStatusId` / `getClientActorId`, including any pagination cursor — never `idToUrl`/`urlToId` inline (see **Client-Facing Entity IDs** in `docs/mastodon-api-compatibility.md`).
5. Respond only via `apiResponse` / `apiErrorResponse` from `@/lib/utils/response` (lint-enforced); CORS routes (those exporting `OPTIONS`) use `apiResponse` even for errors.
6. If the web UI calls the endpoint, add a named exported function to `lib/client.ts` and import it in components — never call `fetch()` in a component (lint-enforced).
7. Co-locate `route.test.ts`; plain `describe`/`it` names, table-driven `it.each` for input/expected variants (see **Testing Guidelines**).
8. Update `docs/architecture.md` or the relevant feature guide if they enumerate routes.
9. Run the Definition of Done gate.

### Adding a background job

1. Create the job handler in `lib/jobs/`.
2. Add the job name constant in `lib/jobs/names.ts`.
3. Register the job in `lib/jobs/index.ts`.
4. Add tests.

### Adding a database migration

1. `yarn migrate:make <name>` — never hand-write the file (migrations are TypeScript with named `up`/`down` taking a `Kysely<any>`, from `migrations/migration.stub`) — then register it in `migrations/index.ts` and its name in `migrations/names.ts`. All migrations must work with SQLite and PostgreSQL: use Kysely's schema and query builders and avoid database-specific SQL unless it is wrapped with backend-specific fallback logic (see **Database Compatibility Guidelines** in `docs/maintenance.md`). Each migration runs in its own transaction on both backends unless it exports `config = { transaction: false }`, and that step must be safe to run again. The first migration, `20261014000000_baseline`, loads the frozen schema in `migrations/baseline/`; never edit those files. `yarn migrate:status` lists applied and pending migrations without writing anything, `yarn migrate:down` rolls back the last one (never the baseline), and `yarn migrate:unlock` releases the SQLite migration lock a killed run left held.
2. Apply it locally against a throwaway SQLite file with inline env vars: `ACTIVITIES_DATABASE= ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./throwaway.sqlite3 yarn migrate` (the empty `ACTIVITIES_DATABASE=` keeps a JSON configuration in `.env.local` from taking over).
3. Regenerate BOTH reference schema dumps (see **Keeping the reference schema dumps in sync** in `docs/setup.md`), then the Kysely DB types (see **Regenerating the Kysely DB types** in `docs/setup.md`). This is not optional: the Vitest suite builds its databases from the dumps, and CI's schema drift checks (in the first PostgreSQL test shard) fail on schema-dump or type drift.
4. Update the affected `lib/database/` code and types, plus tests.
5. Run the Definition of Done gate.

### Adding an environment variable

1. Read it ONLY inside `lib/config/` — add it to the right module and its Zod schema, with tests (`lib/config/envAccess.test.ts` fails on reads elsewhere).
2. Never read it at build time (`next.config.ts` etc.) — see **Runtime Configuration Guidelines**.
3. Document it in `docs/environment-variables.md` (the `lib/config/envDocumentation.test.ts` sync test fails otherwise) and add it to `.env.example`.
4. Update any setup guide that shows related configuration.
5. Run the Definition of Done gate.

### Adding a page in the `(timeline)` group

1. Create `app/(timeline)/<name>/page.tsx`; render `<PageHeader title="…" />` and inherit the unified `max-w-content` width — no per-page width classes. `PageHeader` also renders the mobile compact bar below 768px; a page without a `PageHeader` renders `MobileCompactHeader` itself (or, for a cover-led page like the profile, the floating `MobileNavigationTrigger`). Never put a back arrow or a logo in a title — pass `back` to `PageHeader` or use `BackLink` (see **Mobile chrome** in `docs/architecture.md`).
2. A section's pages are switched with the shared `SectionNavDropdown` at every width (Settings, Account & security and Admin through `SectionLayout`, which also owns their index pages and puts a link to them before the trigger; Fitness and Gallery directly). Never a navigation list or rail beside the content, and never in-header tabs (see **Page Header & Sub-Navigation** in `docs/architecture.md`).
3. Pass timestamps as `Date.now()` numbers from Server Components; Client Components accept `currentTime: number` and never call `Date.now()`/`new Date()` during render (see **Date Serialization in Server Components** in `docs/architecture.md`).
4. If the page shows status posts, render them through the shared `Posts`/`Post` components and turn actions on with `currentActor` + `showActions` — never a bespoke post/action row or per-status action callbacks (see **Status Posts & Actions** in `docs/mastodon-api-compatibility.md`).
5. All client-side data calls go through named functions in `lib/client.ts` (lint-enforced).
6. Add component tests (`/** @vitest-environment jsdom */` docblock) and verify the page in a real browser (see **Local Manual / Browser Testing**); screenshots in the PR are not required.
7. Run the Definition of Done gate.

<a id="agents-design-library-sync"></a>

## Design Library Sync

The Sketch design library is the visual source of truth for Activities.next. It lives in a separate repository, [`llun/sketch`](https://github.com/llun/sketch), checked out on the maintainer's Mac:

- `Activities.next/Activities.next.sketch` is the library: Brand, Colors, Type, Spacing, Emails, Symbols, the Components pages, Templates, and the Mobile and Fitness redesign System pages. It is registered in Sketch as the "Activities.next" library.
- `Activities.next/Screens/` holds the redesign screens: `Activities.next Screens.sketch` is the editable source, `images/<page-slug>/<frameId>.png` are its exported frames, and `index.html` with `manifest.js` is a static viewer that lists every screen with its page, frame name and layer id in the Sketch file.
- `Activities.next/Interactive/` is the interactive prototype, published at <https://sketch.llun.dev/Activities.next/Interactive/>: the real app built from `main` with demo data, recorded page by page and replayed in the browser by a Service Worker, so every page, menu, dialog and theme can be tried. It is generated, never edited by hand.

When a change alters what users see, update the design in the same task:

1. **Decide whether it is a design change.** It is when the change adds or changes a design token (color, type, spacing, radius, motion), a shared component or its states, a page layout, or a screen state such as loading, empty or error. Pure logic, data or copy-only fixes that keep the existing design do not need a Sketch update.
2. **Always update `Activities.next.sketch`.** Edit the affected swatches, text styles, symbols, component pages or System notes so the library matches the shipped UI, then save the document (Sketch keeps unsaved edits in memory, so an unsaved file commits nothing).
3. **Regenerate screens when needed.** If the change adds a screen or changes how an existing one looks, update its Light and Dark frames in `Activities.next/Screens/Activities.next Screens.sketch`, export the frames to `Activities.next/Screens/images/<page-slug>/<frameId>.png` (`@2x` for frames 800px wide or narrower), and add or update their entries in `manifest.js` so the viewer shows them.
4. **Regenerate the interactive prototype.** The prototype records the app from `main`, so after a design change merges, regenerate `Activities.next/Interactive/` from the new `main` with the interactive generator in the sketch repository (`Activities.next/Tools/interactive/`, which runs on macOS or Linux; its README has the exact commands and checks) and replace the folder with its output. Each run re-records the whole app (about 28 MB), so several design PRs that merge together can share one regeneration. The per-area page screens (`Activities.next/Screens/Pages/<Area>.sketch`) come from `Activities.next/Tools/screens/run.sh` beside it. When a change adds a page, add it to `Activities.next/Tools/screens/routes.json`; when it adds an action that saves something, add a flow to `Activities.next/Tools/interactive/mutations.json`, so both tools cover it.
5. **Commit and push the sketch repository.** Commit on `main` in the `llun/sketch` checkout with a message that names the design change and links the Activities.next PR, then `git push origin main`, and publish it with `scripts/publish.sh` from that checkout: it tests and builds the site and uploads it to the sketch repository's GitHub release `site` with the GitHub CLI (`gh auth login` once), and the VM deploys it to <https://sketch.llun.dev/> within 10 minutes. Pushing alone does not update the site. Design changes do not need a pull request in `llun/sketch`. The Activities.next code change itself still follows the normal PR flow.
6. **Never skip it silently.** If the Mac or Sketch is unreachable, the prototype cannot be regenerated, or the push or publish fails, finish the code change and say exactly what is left (which file, which pages or screens) in the PR description and to the person you are working with.

<a id="agents-documentation-maintenance"></a>

## Documentation Maintenance

- **Docs are part of the change.** Any PR that changes behavior described in `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `REVIEW.md`, or `docs/` MUST update those documents in the same PR. Stale guidance is a bug: these files are the operating manual for both humans and AI agents, and past drift produced broken commands and examples (e.g. docs still saying "Jest" long after the Vitest migration, and Docker examples that could not start).
- Before opening a PR, grep the repo's Markdown for every command, script, route, environment variable, table, flag, or convention your change renames, removes, or reshapes — `grep -rn "<old-name>" *.md docs/` — and fix every hit.
- Common triggers and the docs they touch:
  - `package.json` scripts, tooling, hooks (husky/lint-staged), or CI workflow changes → `AGENTS.md` (Build, Test, and Development Commands) and `CONTRIBUTING.md` (Commit & Pull Request Guidelines)
  - Environment variables added/removed/renamed, or defaults/validation changed → `docs/environment-variables.md` and `.env.example` (plus any setup guide that shows the variable)
  - API routes added/moved, or HTTP methods changed → `docs/architecture.md` and the relevant feature guide (e.g. `docs/fitness-file-storage.md`)
  - Migrations → regenerate both schema dumps and the Kysely DB types (see Database Backends & Local Setup in `docs/setup.md`)
  - `scripts/` utilities added or changed → `docs/maintenance.md` (and the feature guide that lists them)
  - Deployment, Docker, or runtime-config changes → `README.md`, `docs/setup.md`, and the database setup guides
  - New or changed coding conventions and patterns → the matching `AGENTS.md` section and the `REVIEW.md` checklist
  - Visual design changes (tokens, components, layouts, screen states) → `Activities.next.sketch`, when screens change `Activities.next/Screens/`, and the regenerated `Activities.next/Interactive/` prototype in the `llun/sketch` repository (see Design Library Sync)
  - Changes to AGENTS.md rules themselves → `AGENTS.md` (which `CLAUDE.md` symlinks to) and the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md`
- Keep `docs/` durable and general-purpose (see [Docs hygiene](#review-docs-hygiene) and Project Structure): update the reference docs in place; do not add change-specific writeups.

<a id="review-docs-hygiene"></a>

### Docs hygiene

- `docs/` is durable, general-purpose reference only — no implementation plans, design docs, PR/task-specific writeups, gap analyses, or screenshots, and no `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/` scratch dirs (see AGENTS.md → Project Structure & Module Organization); task artifacts belong in the PR description.

<a id="agents-commit-pull-request-guidelines"></a>

## Commit & Pull Request Guidelines

- **Work reaches `main` as a pull request**: commit to the feature branch, push it, and open a PR. Nothing is merged by committing to `main` directly (Definition of Done item 1), and the review loop below has no PR to attach to until this has happened.
- Commit messages and PR titles carry the conventional prefix that controls the version bump, followed by a short imperative description — see [Commit Messages and Version Bumps](#commit-messages-and-version-bumps).
- **Never put production or operational SQL in PR descriptions** (or anywhere committed in the repo). One-off database mutations for a deployment — hotfix `UPDATE`/`INSERT`/`DELETE` statements, data backfills, or any copy-pasteable production runbook — must not live in the PR body. Describe **what** operational change is needed and **why** in prose, and deliver the actual SQL through the deployment runbook or a private ops channel instead. This targets operational/runbook SQL — it does **not** restrict application query code: Kysely query-builder calls and its `sql` tag in `lib/` are normal application code and unaffected. The database files that legitimately live in the repo, all under `migrations/`, are the migrations (TypeScript that define schema changes — not raw `.sql`), the frozen baseline schema (`migrations/baseline/`) and the reference schema dumps (`migrations/schema.sql`, `migrations/schema.sqlite.sql`); illustrative SQL in the `docs/` setup and maintenance guides (e.g. `docs/postgresql-setup.md` and the schema-dump steps) is also fine. This keeps environment-specific identifiers, hostnames, and runbooks out of the public Git history.
- A husky pre-commit hook (`.husky/pre-commit`) runs on every commit: first `lint-staged` (configured in `package.json`), which runs `prettier --write` on the staged files and re-stages the formatted result, then `yarn lint`, which blocks the commit on lint errors. It does **not** run build or tests — run those yourself per the [pre-submit gate](#before-submitting).
- The `prettier` / `prettier:check` package scripts only cover `app migrations lib lint test`; the trailing `.` in `yarn run prettier --write .` is what extends formatting to the whole tree. Note that `yarn run prettier` always **writes** (`"prettier": "prettier --write ..."` in `package.json`, so even `yarn prettier --check` writes); use `yarn prettier:check` for a read-only check. CI's format gate (`yarn prettier:check`) does not check `scripts/`, `docs/`, or `.github/`. Always `git fetch` before pushing to a PR branch, because the maintainer sometimes rebases open PR branches.
- **The sub-agent code-review loop below is the project's review process** — read [Code Review Loop (Sub-Agents)](#agents-code-review-loop-sub-agents) and `REVIEW.md` (the project's review checklist, which also documents recurring reviewer false-flags) before acting on review feedback.

<a id="agents-code-review-loop-sub-agents"></a>

## Code Review Loop (Sub-Agents)

**Once a PR is ready, drive a sub-agent code-review loop before treating the work as done, and re-run it every time an agent makes further changes to that PR.** "Ready" means the branch is pushed, the PR is open, and the local pre-commit gate (prettier → lint → typecheck → build → test) is green. This is a required step for every PR an agent produces, not an optional polish pass — with one exception, **When sub-agents are unavailable** below.

### Fan out sub-agents to review the whole change

- Spawn **sub-agents** (the Task/Agent tool; to use the `code-review` skill, run it inside a reviewer sub-agent rather than from the main thread) to review **all** of the PR's code — correctness bugs plus the project invariants in this file and `REVIEW.md`, security, tests, and style. Use `REVIEW.md` as the checklist. For a sizeable diff, fan several sub-agents out in parallel across different files/dimensions instead of a single pass, then consolidate their findings. Each reviewer must be a **separate sub-agent that did not write the change** (never the main thread, and never the implementer reviewing its own work). The main thread chooses each reviewer's model and effort explicitly per the table in [AGENTS.md](AGENTS.md#working-with-sub-agents-always); fixes go to a separate implementer sub-agent.
- **Post every finding as a comment on the PR** — an inline review comment anchored to the offending file and line wherever possible, not just a summary in chat. The `code-review` skill's `--comment` flag posts inline comments directly; otherwise open a pending review with `pull_request_review_write` (method `create`), attach comments with `add_comment_to_pending_review`, and submit with `pull_request_review_write` (method `submit_pending`). The PR threads are the source of truth for what still needs addressing.

### Where findings come from

In multi-round reviews, **review the previous round's fix range (`git diff <prev-sha>..HEAD`) hardest, then finish with one pass over the full diff.** Nearly every serious finding after round 1 in past PRs was a regression introduced by the previous round's fix:

- **Ordering fix that opens a permanent-stranding window when the step between throws** (e.g. stamping `completedAt` before the scan finishes refuses the rebuild that would heal it; marking an actor `deleting` before `Delete(actor)` fan-out strands the account on retry).
- **Privacy or visibility fix whose companion `Update` or publish job still fires and leaks** (`sendNoteJob` and `sendUpdateNoteJob` apply **no** visibility or opt-in checks of their own — if you publish to them, they federate; and because Mastodon synthesises a `Create` when it receives an `Update` for an unseen object younger than ~a day, sending an ungated `Update` after attaching media publishes a status that stayed local or private).
- **Failure-handling fix that writes a status-column combination that strands a row forever** (e.g. `pending` + `statusId = NULL`, or setting `processingStatus = 'failed'` for a map-only error so every downstream reader, rollup, or repair script skips or hides the row).
- **Relocated statement whose failures are now owned by a different `try`/`catch`** (e.g. moving a courtesy read inside an outer `catch` that marks the primary work `failed`).
- **Fix that is a no-op at the caller** (updating a shared helper in a way the caller's own branch never reaches, or checking a column like `accounts.verifiedAt` whose historical `DEFAULT CURRENT_TIMESTAMP` makes `whereNotNull` always true).
- **When adding a guard, check every other writer and enqueued job** that touches the same column, endpoint, or status transition; when accepting or writing a factual claim in a comment or doc (e.g. TS diagnostic codes, whether a route reads a flag), verify it against the actual code and compiler.
- **Do not report or "fix" documented deliberate oddities:** UTC calendar-day math in `ActorFitnessDashboard` / `lib/fitness/calendar/localDay.ts` (date keys go through UTC setters, `setUTCFullYear` / `setUTCHours`, which is zone-independent calendar math, while day boundaries use `localDayWindow`), `attachments.mediaId` historical backend-conditional migrations across schema dumps, unclipped tile storage in `fitness_route_heatmap_tiles` (clipped at serve time), `createAttachment` throwing on non-row ids (routes validate with `toMediaRowId` first), and `getFitnessFileType` reading the raw file name before the 200-byte sanitization cap.

### Address → reply → resolve, in rounds

For every open review comment (from your sub-agents or from a bot):

1. **Address it** — make the fix on the branch, or, for a false positive / won't-fix, decide that explicitly and be ready to justify it. Commit and push.
2. **Reply** on the comment thread with what changed (or why no change is warranted) via `add_reply_to_pull_request_comment`.
3. **Mark it resolved** via `resolve_review_thread`.

After clearing a batch, **run the sub-agent review again** — fixes can introduce new problems. **Repeat until a full round surfaces no new issues that need addressing, or you reach a maximum of 20 rounds**, whichever comes first. Note the round number as you go so the cap stays visible, and stop early the moment a clean round produces nothing actionable.

### Review bots

- **No external review bot currently runs on PRs.** The `gemini-code-assist` bot has been removed, so do **not** post `/gemini review` (or any other bot trigger) and do **not** wait on a bot review — the sub-agent rounds above are the whole review.
- If an automated review bot is reintroduced later, loop it in the same way: after addressing a round, re-request its review, treat its comments exactly like your own findings (address → reply → resolve), and give it up to 20 minutes to respond before continuing — but until then, don't wait on a bot that isn't there.

### When sub-agents are unavailable

Some sessions cannot spawn sub-agents at all: the harness exposes no Task/Agent tool, the operator's session configuration forbids calling it ("do not call the Agent tool unless the user requested it" and similar), or the user has said not to. **In that case the loop is not required, and you must not stall the work waiting for it.** The exception is narrow and mechanical — it fires on _inability_, never on the change looking small, the diff looking obvious, or the gate being green. Those are the conditions under which a review is cheap, not the conditions under which it is unnecessary.

What still holds when the exception fires:

- **Review the diff yourself, in one pass, against `REVIEW.md` and this file.** The exception is about _who_ reviews, not _whether_ the work is reviewed. A single careful self-review is worth far more than nothing, and it is the whole review in this mode.
- **Say so explicitly**, in the PR body and in the handoff to the user: the loop did not run, and why. A skipped review that nobody can see is indistinguishable from a review that found nothing — which is precisely the failure this rule exists to prevent. Never describe the work as fully reviewed, and never imply rounds ran that did not.
- **The loop is still owed.** Offer to run it the moment sub-agents are available — the user can lift the restriction for the session, or run `/code-review` themselves. If a later session on the same PR _can_ spawn sub-agents, run the loop there before the PR merges.

Everything else about the PR is unchanged: the Definition of Done, the pre-commit gate, and the documentation and schema-dump rules all still apply in full.

### Done when

A full sub-agent review round yields no new actionable comments, or you have run 20 rounds. Every thread you touched should be replied-to and resolved before you stop. Where the exception above applies, you are done when the self-review is complete and the skipped loop is disclosed on the PR.

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/guide/)
- [better-auth Documentation](https://www.better-auth.com/)
- [Kysely Documentation](https://kysely.dev/)

## Getting Help

- Check existing [issues](https://github.com/llun/activities.next/issues)
- Review [documentation](docs/)
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
