# Strava Import CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local CLI script that runs `importStravaActivityJob` with
CLI-provided Strava credentials instead of reading them from
`fitness_settings`.

**Architecture:** Extend the job payload with an optional `stravaAuth`
override that is only used by direct CLI invocation. Keep the existing
database-backed path intact for queued jobs, and add a thin script that parses
flags, loads env, and invokes the job with a synthetic message.

**Tech Stack:** TypeScript, Zod, Next.js env loading, existing job system,
Jest, `@swc-node/register`.

---

### Task 1: Add the job payload override

**Files:**
- Modify: `lib/jobs/importStravaActivityJob.ts`
- Test: `lib/jobs/importStravaActivityJob.test.ts`

**Step 1: Write the failing test**

Add a test that calls `importStravaActivityJob` with:

- `data.actorId`
- `data.stravaActivityId`
- `data.stravaAuth.appId`
- `data.stravaAuth.appSecret`
- `data.stravaAuth.accessToken`

and with `database.getFitnessSettings` returning `null`.

Assert that the job still calls `getStravaActivity` with the provided access
token and proceeds into the import path.

**Step 2: Run the focused test to verify it fails**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" yarn test lib/jobs/importStravaActivityJob.test.ts`
Expected: FAIL because the payload schema rejects `stravaAuth` or the job
returns early when `fitness_settings` is missing.

**Step 3: Write the minimal implementation**

In `lib/jobs/importStravaActivityJob.ts`:

- extend `JobData` with optional `stravaAuth`
- branch the auth-loading logic so actor lookup is still required, but
  `fitness_settings` is only required when `stravaAuth` is absent
- construct an in-memory auth object for the CLI path
- bypass `getValidStravaAccessToken` when CLI auth is provided and use the
  passed access token directly

Keep the rest of the import flow unchanged.

**Step 4: Run the focused test to verify it passes**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" yarn test lib/jobs/importStravaActivityJob.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/jobs/importStravaActivityJob.ts lib/jobs/importStravaActivityJob.test.ts
git commit -m "feat(strava): support cli auth override for import job"
```

### Task 2: Add the runnable CLI script

**Files:**
- Create: `scripts/runImportStravaActivity.ts`

**Step 1: Write the script**

Create a script matching the repo's existing script style:

- shebang `#!/usr/bin/env -S node -r @swc-node/register`
- `loadEnvConfig(process.cwd(), process.env.NODE_ENV === 'development')`
- parse named flags:
  - `--actor-id`
  - `--activity-id`
  - `--strava-app-id`
  - `--strava-app-secret`
  - `--access-token`
- validate all required flags
- get the database and fail fast if unavailable
- call `importStravaActivityJob` with a synthetic message
- return `0` on success and `1` on failure

**Step 2: Run the script usage path**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" NODE_ENV=development scripts/runImportStravaActivity.ts`
Expected: prints a usage error and exits `1`.

**Step 3: Smoke test with placeholder arguments**

Run:

```bash
PATH="/opt/homebrew/opt/node@24/bin:$PATH" NODE_ENV=development scripts/runImportStravaActivity.ts \
  --actor-id actor-1 \
  --activity-id 123 \
  --strava-app-id app-id \
  --strava-app-secret app-secret \
  --access-token token
```

Expected: the script reaches the real job path and fails only on missing local
data or upstream API behavior, not on CLI parsing.

**Step 4: Commit**

```bash
git add scripts/runImportStravaActivity.ts
git commit -m "feat(strava): add import activity debug script"
```

### Task 3: Verify and format

**Files:**
- Modify: `docs/plans/2026-03-01-strava-import-cli-design.md`
- Modify: `docs/plans/2026-03-01-strava-import-cli.md`
- Modify: touched job/script/test files from prior tasks

**Step 1: Run targeted tests**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" yarn test lib/jobs/importStravaActivityJob.test.ts`
Expected: PASS

**Step 2: Run Prettier on touched code**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" yarn run prettier --write lib/jobs/importStravaActivityJob.ts lib/jobs/importStravaActivityJob.test.ts scripts/runImportStravaActivity.ts docs/plans/2026-03-01-strava-import-cli-design.md docs/plans/2026-03-01-strava-import-cli.md`
Expected: files formatted with no errors

**Step 3: Re-run targeted tests**

Run: `PATH="/opt/homebrew/opt/node@24/bin:$PATH" yarn test lib/jobs/importStravaActivityJob.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add docs/plans/2026-03-01-strava-import-cli-design.md docs/plans/2026-03-01-strava-import-cli.md lib/jobs/importStravaActivityJob.ts lib/jobs/importStravaActivityJob.test.ts scripts/runImportStravaActivity.ts
git commit -m "feat(strava): add local import activity cli"
```
