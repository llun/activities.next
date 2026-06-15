# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the Next.js App Router UI and API routes (see `app/api/` and route groups like `app/(nosidebar)/`).
- `lib/` hosts core domain logic, database access, services, jobs, and shared utilities.
- `migrations/` holds Knex migration files used for SQL backends.
- `public/` serves static assets; `uploads/` and `data/` are used for local storage in some deployments.
- `docs/` includes setup and database-specific guides; `scripts/` includes repo utilities.
  - **`docs/` is for durable, general-purpose reference documentation only** (setup, architecture, environment variables, feature guides). **Do NOT add** implementation plans, design docs, task/PR-specific writeups, gap analyses, before/after screenshots, or any other artifact tied to a single change or pull request. Those belong in the PR description or issue tracker, not the repo. Do not create `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/`, or similar scratch directories.
- Configuration files live at the repo root (for example `.env.example`, `knexfile.js`, and framework/tooling configs).

## Build, Test, and Development Commands

- **Agents:** MUST use Node.js version 24 for running any node commands in this project.
- **Always use `yarn` for all package management.** Never use `npm install`, `npm ci`, or any other `npm` commands to install or manage packages.
- `yarn dev` runs the local Next.js development server.
- `yarn build` builds the production app; `yarn start` serves it.
- `yarn lint` runs ESLint across the workspace.
- `yarn test` runs the full Jest suite (all tests run in parallel with SQLite in-memory databases).
- `yarn migrate` applies Knex migrations; `yarn migrate:make <name>` creates a new migration.
- **Local database is local-only.** For development and tests, use either **SQLite** on `localhost` (`ACTIVITIES_DATABASE_CLIENT=better-sqlite3` with a local `*.sqlite3` file, or the `ACTIVITIES_DATABASE` JSON equivalent) or the **PostgreSQL in the docker-compose stack at `activities.local`**. **Never run the dev server, migrations, or tests against a remote/shared/production database** (e.g. a non-local `ACTIVITIES_DATABASE_PG_HOST` such as `34.79.77.243`). Verify the resolved database target is local before migrating or starting the app. When working in a git worktree, do not copy a main-checkout `.env.local` that points at a remote DB; create a worktree-local SQLite config instead.
- **Creating test/mock users is allowed** for local verification (for example, to log in and check UI changes), but only against a local database as defined above — never against a remote/shared/production database.

## Runtime Configuration Guidelines

- Deployment and instance configuration must be read at runtime, not at build time. Treat `ACTIVITIES_*`, `OTEL_EXPORTER_*`, secrets, database settings, storage settings, host settings, and auth settings as runtime-only inputs.
- Do not read runtime deployment config in `next.config.ts`, static Next headers, `images.remotePatterns`, `allowedDevOrigins`, webpack config, `generateBuildId`, or other build-time/module-level Next configuration. Production/Docker builds must succeed when `ACTIVITIES_*` variables are missing or contain invalid placeholder values.
- `next.config.ts` may read build-only flags such as `NODE_ENV`, `BUILD_STANDALONE`, and `NEXT_TELEMETRY_DISABLED`, but it must not derive app behavior from runtime deployment config.
- Keep `next.config.ts` as a thin Next configuration entrypoint. Do not define reusable utility functions, parsing helpers, or shared constants there; move helper logic into an appropriate `lib/` module and import it.
- If runtime config affects browser-visible behavior such as CSP, security headers, host redirects, or storage upload origins, implement it in request-time server code (for example `proxy.ts`, route handlers, or server services), not as static Next config.
- Do not inject runtime app config through `nextConfig.env` or `NEXT_PUBLIC_*` variables unless the value is intentionally public, non-secret, and stable at build time.
- Do not read `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables directly, and do not define environment variable name constants, outside `lib/config/`. Add or reuse a config utility and import that instead.
- When changing runtime config behavior, add a regression test that loads `next.config.ts` with missing or invalid `ACTIVITIES_*` values and verifies the build config does not consume them.

## Coding Style & Naming Conventions

- TypeScript + React with 2-space indentation.
- Prettier enforces no semicolons, single quotes, and import sorting (`.prettierrc.yml`).
- Use absolute imports (for example `@/lib/...`) for anything outside the current directory.
- Relative imports are allowed only for files in the same directory (for example `./helper`), and `../` imports are not allowed.
- Apply the same import-path rule to `jest.mock(...)` module paths.
- ESLint (Next + TypeScript) runs via `yarn lint`; unused vars should be prefixed with `_`.
- Tests are co-located with code and named `*.test.ts`/`*.test.tsx`.

## Logging Guidelines

- **NEVER** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code.
- Migration files in `migrations/` and script files in `scripts/` are exceptions and may use `console.*` for CLI output.
- For server-side code (API routes, services, jobs, models, lib utilities), use the logger from `@/lib/utils/logger`:

  ```typescript
  import { logger } from '@/lib/utils/logger'

  logger.info({ message: 'Something happened' })
  logger.warn({ message: 'Warning message' })
  logger.error({ message: 'Error occurred' })
  ```

- **Do NOT** use logger in React components or client-side code—logging is for server-side only.

## API Response Guidelines

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response` for API route responses.
- **Do NOT** use `Response.json()` directly in API routes.
- On CORS-enabled endpoints (those that export `OPTIONS`), always use `apiResponse` — even for error responses — so CORS headers are included. Reserve `apiErrorResponse` for non-CORS routes or middleware.
- Example usage:

  ```typescript
  import {
    HTTP_STATUS,
    apiErrorResponse,
    apiResponse
  } from '@/lib/utils/response'

  // Success response
  return apiResponse({ req, allowedMethods: ['GET'], data: result })

  // Error response (non-CORS route)
  return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

  // Error response (CORS-enabled route — include req and allowedMethods)
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Bad Request' },
    responseStatusCode: 400
  })
  ```

## Zod Validation in API Routes

- **Always use `safeParse`**, never `.parse()`, in API route handlers. `.parse()` throws an unhandled `ZodError` that propagates as a 500; `safeParse` lets you return a proper 4xx response.
- For string columns with a database size limit (e.g. `varchar(255)`), add a matching `.max(255)` constraint in the Zod schema to prevent runtime DB errors.
- When a text column is nullable, use `.transform((v) => v || null)` to convert empty/whitespace-only strings to `null`. Keep this normalization consistent between create and update paths.

  ```typescript
  const UpdateNameRequest = z.object({
    name: z
      .string()
      .trim()
      .max(255)
      .transform((v) => v || null)
  })

  const parsed = UpdateNameRequest.safeParse(json)
  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Invalid input' },
      responseStatusCode: 422
    })
  }
  ```

## ActivityPub & JSON-LD

ActivityPub objects are **JSON-LD**, so the same logical object can arrive in many shapes (`type` as a string, array, CURIE, or full IRI; recipients as a single value or an array; id references inline or as nested objects; varied `@context` orderings and extension vocabularies). Do **not** lock the wire format to a single shape with strict schemas — be liberal in what you accept and canonical in what you emit.

- **Canonicalise every inbound ActivityPub document with `compactActivityPub` from `@/lib/activities/jsonld` before validating or processing it.** It runs the real `jsonld` processor, compacting against one canonical context so downstream code (and the Zod schemas) can rely on a predictable shape: bare `type` terms, id references as strings, and `to`/`cc`/`tag`/`attachment` always arrays. **Any new entry point that parses an untrusted remote AP note/activity/actor MUST compact first.** Already wired: the shared inbox (`app/api/inbox/route.ts`), the per-user inbox (`app/api/users/[username]/inbox/route.ts`), `getActorPerson`, `getActorPosts`, and `getNote` (so `getRemoteStatus` and boosted-note resolution inherit it). `compactActivityPub` is generic (`<T>(input: T) => Promise<T>`), preserves the document's logical shape, and falls back to the raw input on any processing error.
- **The processor must never dereference remote `@context` URLs at runtime** (SSRF/DoS vector). Contexts are bundled as committed offline assets under `lib/activities/jsonld/contexts/` and served by `offlineDocumentLoader`; unknown context URLs resolve to an empty context (their terms simply drop). Add new contexts as bundled assets, never as network fetches. `jsonld` (via `rdf-canonize`) is a heavy, Node-only dependency that breaks under jsdom, so it is imported **lazily** inside `compactActivityPub` — keep it that way so it never enters component/jsdom test module graphs.
- **Extension `type`s that are not defined in the bundled ActivityStreams context must be aliased in `CANONICAL_CONTEXT`**, otherwise compaction emits a CURIE (e.g. `toot:Emoji`, `as:Hashtag`, `schema:PropertyValue`) that the strict `type` validators then drop. `Emoji`, `Hashtag`, and `PropertyValue` are the currently-aliased ones (all other matched AS2 types are already in the bundled context). If you start matching on a new non-AS2 `type`, add its alias **and a regression test** asserting it survives compaction as a bare term.
- **Keep the Zod schemas liberal, not strict.** Model only the fields you consume; never `.strict()`; tolerate unknown tag/attachment kinds via the `z.looseObject({})` fallback in the `Tag`/`Attachment` unions (`z.looseObject` is valid Zod v4 — see `lib/types/activitypub/actor.ts`); never Zod-validate `@context`. Narrow loose values back to fully-valid known shapes at the consumption boundary with `safeParse` (e.g. `getTags`/`getAttachments` return only valid `KnownTag`/`Document` via `KnownTag.safeParse`/`Document.safeParse`).
- **Do not change `http://schema.org#` to `https`.** Mastodon maps the `schema` prefix to the non-standard `http://schema.org#` base in actor `@context`; the canonical context must use the same IRI so profile fields (`PropertyValue`/`value`) compact correctly.
- Compaction emits the public collection as the compact alias `as:Public`; `toRecipientArray` canonicalises it back to the full ActivityStreams Public IRI when coercing recipients for persistence so stored recipients have one canonical form. JSON-LD blank-node ids (`_:b0`) are document-local artifacts and are rejected by `extractActivityPubId`/`normalizeActivityPubUri` — they are never valid resolvable ActivityPub ids.

## Date Serialization in Server Components

- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** `Date` objects are not safely serializable across the server/client boundary and can cause hydration mismatches.
- Always pass timestamps as `number` (e.g. `Date.now()`) from Server Components.
- Client Components should accept `currentTime: number` and construct `new Date(currentTime)` internally before use.
- This pattern is already used throughout the codebase (e.g. `HashtagTimeline` accepts `currentTime: number` and converts it before passing to `<Posts>`).

## Client-Side API Calls

- **Never call `fetch()` directly inside React components.** All API calls from client components must go through `lib/client.ts`.
- Add a named, exported function to `lib/client.ts` for every new API endpoint the UI needs to call. The function should encapsulate the `fetch` call, method, headers, body serialization, and return a typed result.
- Import those functions in components: `import { myApiCall } from '@/lib/client'`.
- This keeps all network logic in one place, makes it easy to find every client→server call, and lets components stay focused on UI state.

## Page Header & Sub-Navigation

The **design system is the source of truth** for page chrome. There are two
section-navigation patterns; pick by section type.

- Use `PageHeader` from `@/lib/components/page-header` for every page title in the `(timeline)` route group. By default it renders the sticky, full-width chrome (translucent background + backdrop blur + bottom border) and centers the title above the content column. Pages always call `<PageHeader title="…" description="…" actions={…} />`; they don't need to know which sub-nav pattern (if any) wraps them.
- **Unified desktop content width.** Every top-level page in the `(timeline)` group shares **one** content width on desktop so the column stays aligned as you switch tabs. The `(timeline)` layout wrapper centers content at `max-w-content` (a single `--container-content: 940px` token defined in `app/globals.css`'s `@theme`), and `PageHeader` centers its title row at the same `max-w-content`. There is **no** per-page width tier any more: do **not** reintroduce the old two-tier `max-w-2xl` (timeline) / `max-w-4xl` (sections) split, a `contentWidth` prop on `PageHeader`, or the `data-layout-width="wide"` opt-in CSS rule. Section layouts (settings, fitness, admin) and Messages all inherit the unified `max-w-content` from the wrapper — they don't set their own width.

### Dropdown sub-nav (settings-style sections — the design-system default)

- Settings-style sections (settings, fitness, admin) use a **dropdown sub-navigation on every breakpoint, including desktop** — there is **no vertical nav rail**. The earlier desktop "vertical icon rail" is gone: do **not** reintroduce a `lg:block` rail beside the content. The same dropdown that tablet/mobile used now drives desktop too, so the content always gets the full width.
- **Reuse the shared `SectionNavDropdown` component** from `@/lib/components/section-nav-dropdown` — do **not** re-inline the dropdown markup in each layout. Pass it a `label` (the `<nav>` accessible name) and a `tabs: SectionNavTab[]` array (`{ name, url, icon }`). It owns the active-tab resolution and renders the trigger + menu described below; `app/(timeline)/settings/layout.tsx`, `app/(timeline)/fitness/layout.tsx`, and `app/(timeline)/admin/layout.tsx` all consume it.
- Under the hood, `SectionNavDropdown` renders a single `<nav aria-label="…">` wrapping a Radix `DropdownMenu`. The trigger is an outline `Button` showing the active tab's Lucide icon (`text-primary`) + **sentence-case** label ("Blocked accounts", not "Blocked Accounts") + a `ChevronDown`; it is `w-full` on mobile and a contained `sm:w-64` from `sm` up. Each menu item is a `<Link>` (with `aria-current="page"` on the active one) inside a `DropdownMenuItem`, and `DropdownMenuContent` uses `align="start"` + `w-[--radix-dropdown-menu-trigger-width]` so the menu lines up with and matches the trigger width.
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

- A **nested** sub-nav inside a section renders as a small **in-content segmented control**, not a second dropdown or rail. Hand it to the closest section-mode `PageHeader` via `PageSubnavProvider` so it sits directly **below the per-page title** (header-first, like the non-nested pages) rather than above it. (The settings, fitness, and admin layouts themselves use the dropdown sub-nav above, not this nested pattern.)

### Sticky-header sub-nav (`PageSubnavProvider`)

- `PageSubnavProvider` remains available for sections that need horizontal tabs **inside** the sticky header: wrap the layout's `{children}` in it and pass the rendered tabs as `subnav`. The closest `PageHeader` renders the tabs directly under the title row, inside the sticky chrome. Do **not** render the sub-nav directly in the layout JSX above the header. No top-level section currently uses this — admin moved to the dropdown sub-nav above to match the design system — but the primitive is kept for the nested in-content segmented-control pattern and future admin-style sections.

  ```tsx
  import { PageSubnavProvider } from '@/lib/components/page-header'

  // const subnav = (/* tabs strip — desktop tabs + mobile dropdown */)
  // return <PageSubnavProvider subnav={subnav}>{children}</PageSubnavProvider>
  ```

## Settings Forms (Client Components)

- Settings forms that update user data (name, email, password, etc.) **must be client components** using `fetch()` with JSON bodies — not plain HTML `<form method="post">` with server-side redirects.
- This matches the pattern used by `ChangeEmailForm`, `ChangePasswordForm`, and `ChangeNameForm`.
- Client component forms should:
  - Call `fetch('/api/v1/...', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })`
  - Show inline success and error messages (not raw error pages)
  - Manage loading state with `useState`
- The corresponding API route should return JSON via `apiResponse()`, not `Response.redirect()`.

## Better-auth Plugin Guidelines

- **Do not register a better-auth plugin unless its required database tables exist** in the Knex migrations. The custom `knexAdapter` does not auto-create tables; missing tables will cause runtime errors.
- When adding a new plugin (e.g. `sso()`, `dash()`), first create the necessary migration with `yarn migrate:make <name>`, then register the plugin.
- Plugins that expose admin or dashboard endpoints must be configured with explicit access control (e.g. `adminCredentials` or `adminRole`). Never register `dash()` without authentication gating.

## Testing Guidelines

- Jest is configured via `jest.config.mjs` with SWC transforms.
- Prefer unit tests near `lib/` and route tests near `app/`.
- All tests run in parallel using isolated SQLite in-memory databases.
- **`describe` / `it` names use plain descriptive text — do not prefix them.**
  Name the function or method under test directly (`describe('getVisibility', …)`,
  not `describe('#getVisibility', …)`), and do not use a leading `#` or `.`
  sigil. `it` names should read as a behavior statement
  (`it('returns null when actor is missing', …)`).
- For tests whose cases differ only by input and expected output, prefer a
  table-driven `it.each([...])('$description', …)` with a `description` column
  instead of repeating near-identical `it` blocks. Reserve standalone `it`
  blocks for cases with distinct setup or assertion shapes.
- Client components that fan out to children which render relative timestamps
  (e.g. `Posts`/`Post`) must receive `currentTime: number` from a Server
  Component and forward it. Add a regression test that renders the component
  with a fixed `currentTime` and a post created a known interval earlier, then
  asserts the rendered relative time (for example `posted 5 minutes ago`). If
  the component calls `Date.now()` internally instead, the assertion fails. See
  `app/(timeline)/MainPageTimeline.test.tsx` for the pattern.

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

2. Install deps, migrate, and seed mock data:

   ```bash
   yarn install          # Node.js 24
   yarn migrate          # knexfile uses dotenv-flow → auto-loads .env.local

   # The mock scripts run via swc-node, which does NOT auto-load .env.local.
   # Export the vars into the shell first, then run them:
   set -a; . ./.env.local; set +a
   node -r @swc-node/register scripts/createMockUser.ts      # testuser / test@example.com / testpassword123
   node -r @swc-node/register scripts/createMockStatuses.ts  # seeds Home/No-Announce timeline posts
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

## Commit & Pull Request Guidelines

- Commit messages must start with one of these prefixes followed by a short imperative description:
  - `none:` to mark that commit as no-release unless another commit in the range requests a higher bump
  - `major:` for breaking changes (major version bump)
  - `minor:` for backwards-compatible new features (minor version bump)
  - `fix:`, `feat:`, `chore:`, `refactor:`, `test:`, `docs:`, etc. for everything else (patch version bump)
- PRs should include a clear summary, linked issues (if any), test results, and notes for config/migrations.
- Include screenshots or clips for UI changes.

### Version Bump Prefixes

**Do NOT manually change the `version` field in `package.json`.** A CI workflow automatically bumps the version based on commit message prefixes after merge. Manual version changes in PRs will conflict with the automated workflow.

The version-bump workflow reads commit prefixes to determine the next semver version. Use these prefixes to control version bumping:

| Prefix               | Version bump    | When to use                                                                                                                                      |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none:`              | None            | For internal-only changes that do not require a release (e.g. documentation, CI configuration)                                                   |
| `major:`             | Major (`X.0.0`) | Breaking changes that require users to update configs, migrations, or integrations (e.g. removed API, changed auth flow, incompatible DB schema) |
| `minor:`             | Minor (`x.Y.0`) | New backwards-compatible features users can opt into (e.g. new endpoint, new UI page, new optional config)                                       |
| _(any other prefix)_ | Patch (`x.y.Z`) | Bug fixes, refactors, chores, docs, tests — anything that doesn't change the public-facing contract                                              |

#### Squash-merge and PR titles

PRs are **squash-merged**, so the **PR title becomes the commit subject** on `main`. The workflow checks the commit subject first, then falls back to scanning the commit body (which contains the individual commit messages).

**To ensure a `minor` or `major` version bump, the PR title MUST start with `minor:` or `major:`.** For example:

```text
minor: add hashtag timeline support        ← PR title → minor bump
major: remove legacy v1 API endpoints      ← PR title → major bump
feat: fix button alignment                 ← PR title → patch bump (default)
```

If the PR title uses a generic prefix (e.g. `feat:`) but an individual commit inside the PR uses `minor:`, the workflow will also detect it from the squash-merge body. However, **setting the PR title is the most reliable approach** since it is always the commit subject.

Commits that change only files under `.github/` are also treated as no-bump by default, unless the commit message explicitly uses `major:` or `minor:`.
When the repository has no version tag yet, the workflow still bootstraps `v1.0.0` regardless of commit history.

Examples:

```text
none: update internal CI docs without cutting a release
chore: tweak GitHub Actions cache keys              ← no bump if the commit only changes `.github/`
major: remove legacy v1 API endpoints
minor: add support for S3 media storage
fix: correct timestamp parsing in ActivityPub inbox   ← patch
chore: update dependencies                            ← patch
```

- **Before committing**, always run:
  1. `yarn run prettier --write .` to format all files.
  2. `yarn lint` to ensure no linting errors—**must be green before commit**.
  3. `yarn build` to ensure no build errors—**must be green before commit**.
  4. `yarn test` to ensure no test errors—**must be green before commit**.

## Security & Configuration Tips

- Store secrets and instance settings in environment variables; avoid committing secrets.
- Review `docs/setup.md` and the database setup guides before changing auth, host, or database settings.

## Database Backends & Local Setup

- Supported backends: SQLite (`docs/sqlite-setup.md`) and PostgreSQL (`docs/postgresql-setup.md`). MySQL-compatible Knex configuration paths also exist and should not be broken casually.
- Local SQLite is the simplest for development; run `yarn migrate` after updating schema or migrations.

### Keeping the reference schema dumps in sync

There are **two** committed reference schema dumps, one per supported backend.
Use the one that matches the database you are reasoning about:

- **`migrations/schema.sql`** — the **PostgreSQL** schema (a `pg_dump`). Use it when inspecting the schema for PostgreSQL deployments.
- **`migrations/schema.sqlite.sql`** — the **SQLite** schema (a `sqlite3 .schema` dump). Use it when inspecting the schema for SQLite — which is what local dev and the Jest test suite use (tests run against in-memory SQLite). Because the two backends use different SQL dialects (e.g. `character varying`/`jsonb`/`timestamp with time zone` vs `varchar`/`json`/`datetime`), the Postgres dump cannot be loaded into SQLite and vice versa — always read the file for the right backend.

Both are reference artifacts: neither is imported by runtime code (the app and tests run Knex migrations, not these files), so nothing will fail if they drift — they just go silently stale. They are gitignored by the blanket `*.sql` rule and re-included by explicit `!` negations in `.gitignore`.

- **Any PR that adds, edits, or removes a Knex migration in `migrations/` MUST regenerate BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql` in the same PR.** Keep them in lockstep — they must always describe the same migration set.
- Regenerate them canonically rather than hand-editing — run every migration against a fresh database of each type and dump the result. In both cases verify `SELECT count(*) FROM knex_migrations` equals the number of `migrations/*.js` files first.

  Pass the DB settings **inline** on the `yarn migrate` line — do **not** write a `.env.local` (you'd clobber an existing one, and the cleanup would delete it). Because `knexfile.js` uses `dotenv-flow`, which never overrides variables already in the environment, inline values win over any `.env.local`; for the same reason, run in a shell with **no** other `ACTIVITIES_DATABASE*` vars exported (a stray one would be merged in and could target a remote DB — check `env | grep ACTIVITIES_DATABASE`).

  **PostgreSQL (`migrations/schema.sql`):**
  1. Start a **local** PostgreSQL 17 (e.g. a throwaway `postgres:17` Docker container, or the docker-compose stack) and wait until it accepts connections (`docker run -d` returns before `initdb` finishes; loop on `pg_isready`). Never point at a remote/shared/production DB.
  2. Run migrations with the settings inline: `ACTIVITIES_DATABASE_CLIENT=pg ACTIVITIES_DATABASE_PG_HOST=… ACTIVITIES_DATABASE_PG_PORT=… ACTIVITIES_DATABASE_PG_USER=… ACTIVITIES_DATABASE_PG_PASSWORD=… ACTIVITIES_DATABASE_PG_DATABASE=… yarn migrate`.
  3. Dump schema only, without ownership/grants: `pg_dump --schema-only --no-owner --no-privileges` (run it against the PG 17 server so the dump matches that version).
  4. Strip pg_dump's noise to match the existing pure-DDL file: the `\restrict`/`\unrestrict` session token (non-deterministic — never commit it), the `-- …` comment headers, and the `SET default_tablespace` / `SET default_table_access_method` lines. Keep the leading `SET`/`SELECT pg_catalog.set_config(...)` block and all `CREATE`/`ALTER` DDL.

  **SQLite (`migrations/schema.sqlite.sql`):**
  1. Run migrations against a throwaway file DB with the settings inline: `ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./schema-dump.sqlite3 yarn migrate`.
  2. Dump the schema with `sqlite3 ./schema-dump.sqlite3 .schema`.
  3. Strip SQLite's auto-managed internal tables, which it recreates on its own and which must NOT be in the file: the `CREATE TABLE sqlite_sequence(...)` line, and the FTS5 shadow tables (`CREATE TABLE IF NOT EXISTS '<name>_fts_(data|idx|docsize|config|content)'`). Keep the `CREATE VIRTUAL TABLE … USING fts5(…)` statement and its triggers — those are real. A quick sanity check: `sqlite3 /tmp/x.sqlite3 < migrations/schema.sqlite.sql` should load cleanly.

  Then remove the throwaway container / `.sqlite3` file; only the two schema files should change.

- A Postgres regeneration is a full re-dump, so its diff can be large even for unchanged tables (formatting differs from older dumps). That is expected — do not try to reproduce the old line-by-line formatting by hand. Commit the schema regeneration as `none:` when it is the only change (they are reference artifacts and ship nothing).
- **Use only a local database for local dev/tests:** SQLite on `localhost`, or the docker-compose PostgreSQL at `activities.local`. Never connect local dev, tests, or user creation to a remote/shared/production database.
- Tests use isolated SQLite in-memory databases for fast, parallel execution.
- Docker users should mount a persistent volume to `/opt/activities.next` (see `docs/setup.md`).

## Database Compatibility Guidelines

- **All database operations must work with SQLite and PostgreSQL, and should avoid assumptions that break MySQL-compatible Knex clients where possible.**
- Use Knex query builder for all database operations—avoid raw SQL unless absolutely necessary.
- When writing raw SQL, ensure syntax is compatible across all supported databases.
- Avoid database-specific features unless wrapped with conditional logic or fallback behavior for each backend.
- Test migrations and queries against SQLite (used in tests) to catch compatibility issues early.
- Use standard SQL types and avoid vendor-specific extensions (e.g., use `text` instead of PostgreSQL's `varchar[]`).
