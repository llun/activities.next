#!/usr/bin/env -S node scripts/run.cjs
/**
 * Collapses an actor's stored `fitness_files.activityType` values to the
 * canonical sport keys.
 *
 * Four vocabularies write that column — FIT `sport`/`sub_sport` (`cycling`,
 * `gravel_cycling`), Garmin TCX `Sport` (`Biking`), Strava `sport_type`
 * (`Ride`, `GravelRide`, written verbatim into the TCX this app builds for a
 * Strava import) and free-form GPX `<trk><type>` text. Gear never cared,
 * because it matches through `normalizeActivityTypeToSportKey`, but everything
 * that GROUPS or FILTERS on the raw string did: the fitness overview breakdown
 * counted "Cycling", "Biking" and "Ride" as three separate activities, and the
 * per-type route-heatmap cache keyed three separate rows.
 *
 * New imports are normalized at the source — `toActivityData` in
 * `parseFitnessFile.ts` is the single funnel every parser returns through — so
 * this script exists only for history imported before that rule.
 *
 * Dry run by default. Nothing is written unless `--apply` is given.
 *
 * Idempotent by construction: every sport key normalizes to itself, so a second
 * run finds nothing to do. (It still reads the whole history to find that out —
 * the comparison is per row, not in the query.)
 *
 * Gear attribution cannot shift as a result. Auto-assign already reads the
 * column through `normalizeActivityTypeToSportKey`, and every value written
 * here is a fixed point of that function, so an activity's sport key — and
 * therefore its gear — is the same before and after.
 *
 * Common non-gear activities (training, rowing) are collapsed to their canonical
 * stored types, and any unmatched non-empty activity type defaults to 'other'.
 *
 * IMPORTANT: run this with the PRODUCTION database env configured. `@next/env`
 * loads `.env.local` above `.env.production` even under NODE_ENV=production, so
 * a stray local file points this at SQLite and it reports nothing to do — the
 * banner it prints first is there to catch exactly that.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/normalizeFitnessActivityTypes.ts \
 *     --actor-id https://<host>/users/<username> \
 *     [--apply]
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { normalizeStoredActivityType } from '@/lib/services/fitness-files/sportTypes'

import { printDatabaseBanner } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  apply: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/normalizeFitnessActivityTypes.ts \\
  --actor-id https://<host>/users/<username> \\
  [--apply]`

const ACTOR_SCAN_PAGE_SIZE = 200

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]) => {
  const parsed: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    // Every sibling fitness script takes `--dry-run` and writes by default;
    // this one inverts that. Say so, rather than answering an operator who
    // copied the habit from the next line of the runbook with "Missing value
    // for --dry-run" — or silently eating their `--actor-id` as its value.
    if (rawKey === 'dry-run') {
      throw new Error(
        'This script is a dry run by default; pass --apply to write.'
      )
    }

    if (rawKey === 'apply') {
      const nextValue = args[index + 1]
      if (inlineValue !== undefined) {
        parsed[rawKey] = parseBooleanFlagValue(inlineValue)
        continue
      }
      if (nextValue && !nextValue.startsWith('--')) {
        parsed[rawKey] = parseBooleanFlagValue(nextValue)
        index += 1
        continue
      }
      parsed[rawKey] = true
      continue
    }

    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }
    if (inlineValue === undefined) index += 1
    parsed[rawKey] = nextValue
  }

  return CliArgs.parse({
    actorId: parsed['actor-id'],
    apply: parsed['apply'] ?? false
  })
}

/** The subset of a fitness file this normalization reads. */
export interface NormalizableFitnessFile {
  id: string
  fileName: string
  activityType?: string | null
}

export interface ActivityTypeRewrite {
  fileId: string
  fileName: string
  from: string
  to: string
}

export interface ActivityTypeNormalizationPlan {
  /** Rows whose stored value differs from its canonical stored activity type. */
  rewrites: ActivityTypeRewrite[]
  /** Rows already stored as their canonical activity type — nothing to do. */
  alreadyNormalized: number
  /** Rows carrying no activity type at all. */
  missingType: number
}

const emptyPlan = (): ActivityTypeNormalizationPlan => ({
  rewrites: [],
  alreadyNormalized: 0,
  missingType: 0
})

/**
 * Decides what a page of files needs, with no database access, so the whole
 * decision table is testable against the various vocabularies at once.
 */
export const planActivityTypeNormalization = (
  files: NormalizableFitnessFile[],
  plan: ActivityTypeNormalizationPlan = emptyPlan()
): ActivityTypeNormalizationPlan => {
  for (const file of files) {
    const current = file.activityType
    if (!current) {
      plan.missingType += 1
      continue
    }

    const storedType = normalizeStoredActivityType(current)
    if (!storedType) {
      plan.missingType += 1
      continue
    }

    if (storedType === current) {
      plan.alreadyNormalized += 1
      continue
    }

    plan.rewrites.push({
      fileId: file.id,
      fileName: file.fileName,
      from: current,
      to: storedType
    })
  }

  return plan
}

/** `old -> new` with a count, ordered by how many rows each transition covers. */
export const summarizeRewrites = (
  rewrites: ActivityTypeRewrite[]
): Array<{ from: string; to: string; count: number }> => {
  const counts = new Map<string, { from: string; to: string; count: number }>()

  for (const rewrite of rewrites) {
    // JSON rather than a concatenation: `from` is free-form text out of an
    // uploaded file, so a delimiter key would need an argument about which
    // characters can appear in it. This one needs none.
    const key = JSON.stringify([rewrite.from, rewrite.to])
    const entry = counts.get(key)
    if (entry) {
      entry.count += 1
      continue
    }
    counts.set(key, { from: rewrite.from, to: rewrite.to, count: 1 })
  }

  return [...counts.values()].sort(
    (first, second) =>
      second.count - first.count || first.from.localeCompare(second.from)
  )
}

async function normalizeFitnessActivityTypesScript(
  args = process.argv.slice(2)
) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    console.error((error as Error).message)
    console.error(USAGE)
    return 1
  }

  printDatabaseBanner()

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  try {
    const actor = await database.getActorFromId({ id: input.actorId })
    if (!actor) {
      console.error(`Error: Actor not found: ${input.actorId}`)
      return 1
    }

    const plan = emptyPlan()
    let scanned = 0
    let offset = 0

    // Offset paging is stable here: the rows are ordered by (createdAt, id) and
    // this script writes neither column.
    for (;;) {
      const page = await database.getFitnessFilesByActor({
        actorId: actor.id,
        limit: ACTOR_SCAN_PAGE_SIZE,
        offset
      })
      if (page.length === 0) break

      scanned += page.length
      planActivityTypeNormalization(page, plan)

      if (page.length < ACTOR_SCAN_PAGE_SIZE) break
      offset += ACTOR_SCAN_PAGE_SIZE
    }

    console.log(
      `\nScanned ${scanned} activity file(s) for ${actor.id}.\n` +
        `  ${plan.rewrites.length} to normalize, ` +
        `${plan.alreadyNormalized} already canonical, ` +
        `${plan.missingType} with no activity type.`
    )

    const transitions = summarizeRewrites(plan.rewrites)
    if (transitions.length > 0) {
      console.log('\nChanges:')
      for (const { from, to, count } of transitions) {
        console.log(`  ${from} -> ${to}  (${count})`)
      }
    }

    if (plan.rewrites.length === 0) {
      console.log('\nNothing to do.')
      return 0
    }

    if (!input.apply) {
      console.log('\nDry run, nothing written. Re-run with --apply to write.')
      return 0
    }

    let updated = 0
    let failed = 0
    // Which old values a row actually MOVED AWAY from, as opposed to which the
    // plan intended to. The heatmap advice below is derived from this rather
    // than from the plan: a run whose writes all failed changed nothing, and
    // telling the operator their cache is stale — with a paste-ready rebuild
    // command — would send them to redo work that was never invalidated.
    const rewrittenFrom = new Set<string>()
    for (const rewrite of plan.rewrites) {
      try {
        await database.updateFitnessFileActivityData(rewrite.fileId, {
          activityType: rewrite.to
        })
        updated += 1
        rewrittenFrom.add(rewrite.from)
      } catch (error) {
        failed += 1
        console.error(
          `  ! ${rewrite.fileName} (${rewrite.fileId}): ${(error as Error).message}`
        )
      }
    }

    console.log(`\nDone: ${updated} updated, ${failed} error(s).`)

    // The per-type route-heatmap cache keys on the OLD strings and is not
    // touched here: its unique index is (actorId, activityTypeKey, periodType,
    // periodKey, region), so renaming a `cycling` row to `ride` collides with
    // the row already built from `Ride` rather than merging into it. Rebuilding
    // is the operation that actually reconciles them.
    //
    // Filtered through `transitions` rather than listing the set directly, to
    // keep the same most-rows-first order the change report above used.
    const staleKeys = transitions
      .map(({ from }) => from)
      .filter((from) => rewrittenFrom.has(from))
    if (staleKeys.length > 0) {
      console.log(
        `\nPer-activity-type route heatmaps cached under ${staleKeys
          .map((key) => `"${key}"`)
          .join(', ')} are now stale. Rebuild them with:\n` +
          `  NODE_ENV=production scripts/fitness/recreateFitnessRouteHeatmaps.ts --actor-id ${actor.id}`
      )
    }

    return failed > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  normalizeFitnessActivityTypesScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { normalizeFitnessActivityTypesScript }
