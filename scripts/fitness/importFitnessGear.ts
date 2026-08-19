#!/usr/bin/env -S node scripts/run.cjs
/**
 * Imports fitness gear from a JSON file and attributes existing activities to it
 * by start time.
 *
 * Gear tracking arrived after most people's activities did, so every ride
 * imported before it exists with no gear at all. Re-importing is not an option —
 * it would duplicate the posts — and the app's own Strava paths only attribute
 * activities they import themselves. This script closes that gap: it creates the
 * gear and its component history, then walks a list of {time, gear} entries and
 * assigns each to the activity whose `activityStartTime` it names.
 *
 * Assignments are the precise instrument; per-gear date windows are the blunt
 * one, applied afterwards to whatever is still unassigned. Both leave an
 * activity that already carries gear alone unless `--overwrite` is given, so a
 * re-run costs nothing and never undoes a manual correction.
 *
 * Use `scripts/fitness/convertStravaExportToGearImport.ts` to build the
 * assignments from a Strava export.
 *
 * IMPORTANT: run this with the PRODUCTION database env configured. `@next/env`
 * loads `.env.local` above `.env.production` even under NODE_ENV=production, so
 * a stray local file points this at SQLite and it reports nothing to do — the
 * banner it prints first is there to catch exactly that.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/importFitnessGear.ts \
 *     --actor-id https://<host>/users/<username> \
 *     --input ./gear-import.json \
 *     [--tolerance-seconds 60] [--overwrite] [--dry-run [true|false]]
 */
import { loadEnvConfig } from '@next/env'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { SportKey } from '@/lib/services/fitness-files/sportTypes'
import { FitnessGear, FitnessGearKind } from '@/lib/types/database/fitnessGear'

import { printDatabaseBanner } from './describeConnection'
import {
  AssignmentMatch,
  ImportGear,
  MatchableFitnessFile,
  UnattributedActivity,
  applyWindows,
  diffGearComponents,
  findUnattributedActivities,
  matchAssignmentsToFiles,
  parseGearImportFile
} from './gearImportPlan'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  input: z.string().min(1),
  toleranceSeconds: z.coerce.number().int().positive().max(3600).default(60),
  overwrite: z.boolean().default(false),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/importFitnessGear.ts \\
  --actor-id https://<host>/users/<username> \\
  --input ./gear-import.json \\
  [--tolerance-seconds 60] [--overwrite] [--dry-run [true|false]]`

const ACTOR_SCAN_PAGE_SIZE = 200
const BOOLEAN_FLAGS = new Set(['overwrite', 'dry-run'])

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

    if (BOOLEAN_FLAGS.has(rawKey)) {
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
    input: parsed['input'],
    toleranceSeconds: parsed['tolerance-seconds'] ?? 60,
    overwrite: parsed['overwrite'] ?? false,
    dryRun: parsed['dry-run'] ?? false
  })
}

const normalizeGearName = (name: string): string => name.trim().toLowerCase()

interface ResolvedGear {
  entry: ImportGear
  existing: FitnessGear | null
}

/**
 * Finds the gear this entry refers to, by name.
 *
 * The name is the only handle the plan file carries, so a re-run after the
 * owner renamed the gear in the UI misses and creates a second row. That is
 * visible and repairable (delete the duplicate, or rename the plan entry to
 * match); it is also why the plan validator rejects two entries whose names
 * differ only by case.
 */
const resolveExistingGear = async (
  database: Database,
  actorId: string,
  entry: ImportGear
): Promise<FitnessGear | null> =>
  database.findFitnessGearByName({
    actorId,
    name: entry.name
  })

const loadActorFitnessFiles = async (
  database: Database,
  actorId: string
): Promise<MatchableFitnessFile[]> => {
  const files: MatchableFitnessFile[] = []
  let offset = 0

  for (;;) {
    // Primary files only: a batch upload of the same ride from two devices
    // shares one post, and only the primary row counts toward gear totals.
    const page = await database.getFitnessFilesByActor({
      actorId,
      limit: ACTOR_SCAN_PAGE_SIZE,
      offset,
      isPrimary: true
    })
    if (page.length === 0) break

    for (const file of page) {
      files.push({
        id: file.id,
        fileName: file.fileName,
        activityStartTime: file.activityStartTime,
        activityType: file.activityType,
        gearId: file.gearId,
        processingStatus: file.processingStatus,
        sourceUrl: file.sourceUrl,
        totalDistanceMeters: file.totalDistanceMeters
      })
    }

    if (page.length < ACTOR_SCAN_PAGE_SIZE) break
    offset += ACTOR_SCAN_PAGE_SIZE
  }

  return files
}

const formatTime = (milliseconds: number): string =>
  new Date(milliseconds).toISOString()

const describeAssignmentSource = (match: AssignmentMatch): string =>
  match.stravaActivityId
    ? `${formatTime(match.timeMilliseconds)} (strava ${match.stravaActivityId})`
    : formatTime(match.timeMilliseconds)

const KILOMETRE = 1000
const REPORT_SAMPLE_SIZE = 20

const formatKm = (meters: number): string =>
  `${(meters / KILOMETRE).toFixed(1)} km`

/**
 * Prints the activities the plan leaves with no gear.
 *
 * The counterpart to the unmatched-assignment list: that one says which entries
 * found no activity, this one says which activities no entry found. Only the
 * second answers "why is the gear page short against Strava", because a gear
 * total is a sum over exactly these rows — so it leads with the total those
 * kilometres add up to, and breaks it down by year to point at the period that
 * went wrong.
 */
const reportUnattributed = (unattributed: UnattributedActivity[]): void => {
  if (unattributed.length === 0) return

  const totalMeters = unattributed.reduce(
    (sum, activity) => sum + activity.totalDistanceMeters,
    0
  )
  console.log(
    `\nUnattributed activities (${unattributed.length}, ${formatKm(totalMeters)}):` +
      '\n  These count toward no gear. A gear page short against Strava is short by these.'
  )

  const byYear = new Map<string, { count: number; meters: number }>()
  for (const activity of unattributed) {
    const year =
      activity.activityStartTime === undefined
        ? '(no date)'
        : String(new Date(activity.activityStartTime).getUTCFullYear())
    const total = byYear.get(year) ?? { count: 0, meters: 0 }
    total.count += 1
    total.meters += activity.totalDistanceMeters
    byYear.set(year, total)
  }
  for (const [year, total] of [...byYear.entries()].sort()) {
    console.log(
      `    ${year}: ${total.count} activities, ${formatKm(total.meters)}`
    )
  }

  for (const activity of unattributed.slice(0, REPORT_SAMPLE_SIZE)) {
    const when =
      activity.activityStartTime === undefined
        ? 'no start time'
        : formatTime(activity.activityStartTime)
    // The sport key is what auto-assign matches on, so `null` is the whole
    // reason a file can never be attributed without naming it explicitly.
    const sport =
      activity.sportKey ??
      `sport not recognised from "${activity.activityType ?? 'none'}"`
    console.log(
      `  ${when}  ${formatKm(activity.totalDistanceMeters).padStart(9)}  ${sport}  ` +
        `${activity.sourceUrl ?? activity.fileName}`
    )
  }
  if (unattributed.length > REPORT_SAMPLE_SIZE) {
    console.log(`  ... and ${unattributed.length - REPORT_SAMPLE_SIZE} more`)
  }
}

async function importFitnessGearScript(args = process.argv.slice(2)) {
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

  let rawFile: unknown
  try {
    rawFile = JSON.parse(readFileSync(input.input, 'utf-8'))
  } catch (error) {
    console.error(
      `Error: cannot read ${input.input}: ${(error as Error).message}`
    )
    return 1
  }

  const parsed = parseGearImportFile(rawFile)
  if (!parsed.ok) {
    console.error(`Error: ${input.input} is not a valid gear import file:`)
    for (const error of parsed.errors) console.error(`  - ${error}`)
    return 1
  }
  const file = parsed.file

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

    // --- Read phase -------------------------------------------------------
    const resolved: ResolvedGear[] = []
    const errors: string[] = []

    for (const entry of file.gears) {
      const existing = await resolveExistingGear(database, actor.id, entry)
      if (existing && existing.kind !== entry.kind) {
        // `kind` decides which fields and sports are meaningful and is immutable
        // once components hang off the gear.
        errors.push(
          `gear "${entry.name}" exists as ${existing.kind}, but the file says ${entry.kind}`
        )
      }
      resolved.push({ entry, existing })
    }

    // A default sport belongs to one gear at a time, so creating gear that
    // claims one silently takes it from whoever holds it now. Only gear this
    // run actually creates can steal: `defaultSports` is passed to
    // `createFitnessGear` and nowhere else, so warning about a reused entry
    // would describe a change that never happens.
    const claimedSports = new Map<SportKey, string>()
    for (const { entry, existing } of resolved) {
      if (existing) continue
      for (const sportKey of entry.defaultSports ?? []) {
        claimedSports.set(sportKey, entry.name)
      }
    }
    if (claimedSports.size > 0) {
      const fileGearNames = new Set(
        file.gears.map((gear) => normalizeGearName(gear.name))
      )
      const actorGears = await database.getFitnessGearsByActor({
        actorId: actor.id
      })
      for (const gear of actorGears) {
        if (fileGearNames.has(normalizeGearName(gear.name))) continue
        for (const sportKey of gear.defaultSports) {
          const claimant = claimedSports.get(sportKey as SportKey)
          if (!claimant) continue
          console.log(
            `  ! "${claimant}" will take default sport "${sportKey}" from existing gear "${gear.name}"`
          )
        }
      }
    }

    // Two entries pointing at one database row would each diff their components
    // against the same pre-write snapshot, so both would insert and the gear
    // would end up with the history twice over.
    const resolvedById = new Map<string, string>()
    for (const { entry, existing } of resolved) {
      if (!existing) continue
      const owner = resolvedById.get(existing.id)
      if (owner) {
        errors.push(
          `entries "${owner}" and "${entry.name}" both resolve to the existing gear "${existing.name}"`
        )
        continue
      }
      resolvedById.set(existing.id, entry.name)
    }

    if (errors.length > 0) {
      console.error('Error: import cannot proceed:')
      for (const error of errors) console.error(`  - ${error}`)
      return 1
    }

    const files = await loadActorFitnessFiles(database, actor.id)

    // An actor with no activities at all cannot be the one these assignments
    // describe. Creating the gear anyway would leave rows on the wrong actor —
    // and `stealDefaultSports` would quietly strip sports off their real gear —
    // so stop while that is still just a typo in `--actor-id`.
    if (files.length === 0 && file.assignments.length > 0) {
      console.error(
        `Error: ${actor.id} has no activities, but the file has ${file.assignments.length} assignments.\n` +
          '  Check --actor-id and the database shown above before re-running.'
      )
      return 1
    }

    const gearKindByName = new Map<string, FitnessGearKind>(
      file.gears.map((gear) => [normalizeGearName(gear.name), gear.kind])
    )

    // --- Plan phase -------------------------------------------------------
    const { matches, reservedFileIds, timestamplessFileCount } =
      matchAssignmentsToFiles({
        assignments: file.assignments,
        files,
        toleranceMilliseconds: input.toleranceSeconds * 1000,
        gearKindByName
      })

    const windowAssignments = applyWindows({
      gears: file.gears,
      files,
      reservedFileIds
    })

    const componentPlan = new Map<
      string,
      ReturnType<typeof diffGearComponents>
    >()
    for (const { entry, existing } of resolved) {
      const existingComponents = existing
        ? await database.getFitnessGearComponents({
            gearId: existing.id,
            actorId: actor.id
          })
        : []
      componentPlan.set(
        normalizeGearName(entry.name),
        diffGearComponents({
          components: entry.components,
          existing: existingComponents
        })
      )
    }

    // --- Report -----------------------------------------------------------
    const matchedByGear = new Map<string, number>()
    for (const match of matches) {
      if (match.outcome.kind !== 'matched') continue
      const key = normalizeGearName(match.gearName)
      matchedByGear.set(key, (matchedByGear.get(key) ?? 0) + 1)
    }
    const windowsByGear = new Map<string, number>()
    for (const assignment of windowAssignments) {
      const key = normalizeGearName(assignment.gearName)
      windowsByGear.set(key, (windowsByGear.get(key) ?? 0) + 1)
    }

    console.log(
      `\nActor ${actor.id}: ${files.length} primary activities, ` +
        `${file.gears.length} gear entries, ${file.assignments.length} assignments.`
    )
    if (timestamplessFileCount > 0) {
      console.log(
        `  ${timestamplessFileCount} activities have no start time, so only an entry naming ` +
          'their Strava id or file name can reach them.'
      )
    }

    console.log('\nGear:')
    for (const { entry, existing } of resolved) {
      const key = normalizeGearName(entry.name)
      const components = componentPlan.get(key) ?? []
      const parts = [
        // Reuse adds the missing components and reconciles `retired`, but never
        // rewrites the gear's own fields — an import must not overwrite what the
        // owner may have corrected in the UI. Say so, or a re-run after editing
        // brand/notes/defaultSports in the file looks like it applied them.
        existing ? 'reuse (existing gear fields left as they are)' : 'create',
        `${components.length}/${entry.components.length} components to add`,
        `${matchedByGear.get(key) ?? 0} matched`,
        `${windowsByGear.get(key) ?? 0} by window`
      ]
      const retiredChange =
        existing && Boolean(existing.retiredAt) !== entry.retired
          ? `, ${entry.retired ? 'retire' : 'unretire'}`
          : ''
      console.log(
        `  ${entry.name} [${entry.kind}]: ${parts.join(', ')}${retiredChange}`
      )
    }

    // Gear totals only count 'completed' activities, so a matched file that is
    // still processing (or failed) gets its gearId but stays out of the numbers
    // until it finishes — worth saying, since the totals are what an operator
    // compares against Strava.
    const filesById = new Map(files.map((entry) => [entry.id, entry]))
    const notCompletedCount = matches.filter(
      (match) =>
        match.outcome.kind === 'matched' &&
        filesById.get(match.outcome.fileId)?.processingStatus !== 'completed'
    ).length

    const unmatched = matches.filter(
      (match) => match.outcome.kind === 'unmatched'
    )
    const ambiguous = matches.filter(
      (match) => match.outcome.kind === 'ambiguous'
    )
    const conflicts = matches.filter(
      (match) => match.outcome.kind === 'conflict'
    )
    const kindMismatches = matches.filter(
      (match) => match.outcome.kind === 'matched' && match.outcome.kindMismatch
    )

    if (unmatched.length > 0) {
      console.log(`\nUnmatched assignments (${unmatched.length}):`)
      for (const match of unmatched.slice(0, 20)) {
        const outcome = match.outcome as { nearestDeltaMilliseconds?: number }
        const nearest =
          outcome.nearestDeltaMilliseconds === undefined
            ? 'no activities to compare'
            : `nearest activity ${Math.round(outcome.nearestDeltaMilliseconds / 1000)}s away`
        console.log(
          `  ${describeAssignmentSource(match)} → ${match.gearName}: ${nearest}`
        )
      }
      if (unmatched.length > 20) {
        console.log(`  ... and ${unmatched.length - 20} more`)
      }
    }

    for (const [label, group] of [
      ['Ambiguous', ambiguous],
      ['Conflicting', conflicts]
    ] as const) {
      if (group.length === 0) continue
      console.log(`\n${label} assignments (${group.length}, skipped):`)
      for (const match of group.slice(0, 20)) {
        console.log(`  ${describeAssignmentSource(match)} → ${match.gearName}`)
      }
      if (group.length > 20) console.log(`  ... and ${group.length - 20} more`)
    }

    if (kindMismatches.length > 0) {
      // Assigned anyway on purpose: the import file knows which gear was used,
      // while the local sport is guessed from free-form `activityType`. But this
      // is the only skipped-or-warned category that still writes, so it gets the
      // same detail as the others — and grouping by gear surfaces the case that
      // matters, a gear whose every activity mismatches, which means its `kind`
      // is wrong in the file and cannot be changed after the gear is created.
      console.log(
        `\n! Sport/kind mismatches (${kindMismatches.length}, assigned anyway):`
      )
      const mismatchByGear = new Map<string, number>()
      for (const match of kindMismatches) {
        const key = normalizeGearName(match.gearName)
        mismatchByGear.set(key, (mismatchByGear.get(key) ?? 0) + 1)
      }
      for (const [key, count] of mismatchByGear) {
        const entry = file.gears.find(
          (gear) => normalizeGearName(gear.name) === key
        )
        const total = matchedByGear.get(key) ?? 0
        const allOfThem =
          count === total && total > 1
            ? ` — every one of them, so "kind": "${entry?.kind}" is probably wrong in the file`
            : ''
        console.log(
          `  ${entry?.name ?? key} [${entry?.kind}]: ${count} of ${total}${allOfThem}`
        )
      }
    }

    // Computed from the pre-write snapshot, so this is what the run will leave
    // behind — the same list either way, since it only ever assigns the files
    // the matches and windows above already named.
    reportUnattributed(
      findUnattributedActivities({
        files,
        reservedFileIds,
        windowAssignedFileIds: new Set(
          windowAssignments.map((assignment) => assignment.fileId)
        )
      })
    )

    if (input.dryRun) {
      console.log('\nDry run: nothing was written.')
      return 0
    }

    // --- Execute ----------------------------------------------------------
    // Every step is individually idempotent, so no wrapping transaction: a
    // crash leaves a state a re-run completes from, and `createFitnessGear`
    // already opens its own transaction.
    const totals = {
      gearsCreated: 0,
      gearsReused: 0,
      retiredChanged: 0,
      componentsCreated: 0,
      assigned: 0,
      alreadyAssigned: 0,
      windowAssigned: 0,
      failed: 0
    }

    const gearIdByName = new Map<string, string>()
    const printSummary = () => {
      console.log(
        `\nDone: ${totals.gearsCreated} gear created, ${totals.gearsReused} reused, ` +
          `${totals.retiredChanged} retirement change(s), ${totals.componentsCreated} components added.\n` +
          `Activities: ${totals.assigned} assigned, ${totals.windowAssigned} by window, ` +
          `${totals.alreadyAssigned} already had gear, ${unmatched.length} unmatched, ` +
          `${ambiguous.length + conflicts.length} skipped, ${totals.failed} error(s).`
      )
      if (notCompletedCount > 0) {
        console.log(
          `  ${notCompletedCount} of the matched activities are not 'completed' yet, so they ` +
            'will not count toward gear totals until their processing finishes.'
        )
      }
    }

    // A throw here (a dropped connection, a statement timeout) would otherwise
    // take the counters with it, leaving no way to tell whether the run wrote
    // nothing or nearly everything.
    let inFlight = 'the gear'
    try {
      for (const { entry, existing } of resolved) {
        inFlight = `gear "${entry.name}"`
        const key = normalizeGearName(entry.name)
        let gear = existing

        if (gear) {
          totals.gearsReused += 1
        } else {
          gear = await database.createFitnessGear({
            actorId: actor.id,
            kind: entry.kind,
            name: entry.name,
            brand: entry.brand,
            model: entry.model,
            bikeType: entry.bikeType,
            weightKilograms: entry.weightKilograms,
            defaultSports: entry.defaultSports ?? [],
            alertDistanceMeters: entry.alertDistanceMeters,
            notes: entry.notes
          })
          totals.gearsCreated += 1
          console.log(`  Created gear ${entry.name}`)
        }

        gearIdByName.set(key, gear.id)

        if (Boolean(gear.retiredAt) !== entry.retired) {
          const retired = await database.setFitnessGearRetired({
            id: gear.id,
            actorId: actor.id,
            retired: entry.retired
          })
          if (retired) totals.retiredChanged += 1
          else {
            totals.failed += 1
            console.error(
              `  ! could not ${entry.retired ? 'retire' : 'unretire'} "${entry.name}" (${gear.id}) — the gear is no longer readable`
            )
          }
        }

        const planned = componentPlan.get(key) ?? []
        for (const [position, component] of planned.entries()) {
          const created = await database.createFitnessGearComponent({
            gearId: gear.id,
            actorId: actor.id,
            componentType: component.type,
            brand: component.brand,
            model: component.model,
            addedAt: component.addedAt ? new Date(component.addedAt) : null,
            removedAt: component.removedAt
              ? new Date(component.removedAt)
              : null,
            serviceDistanceMeters: component.serviceDistanceMeters
          })
          if (created) {
            totals.componentsCreated += 1
            continue
          }
          // Null means the gear itself is gone or not ours, which is fatal for
          // every remaining component of this gear — looping on would just
          // count the same failure once per part.
          const remaining = planned.length - position
          totals.failed += remaining
          console.error(
            `  ! gear "${entry.name}" (${gear.id}) is no longer readable — ` +
              `${remaining} of its ${planned.length} new components were not created, starting at "${component.type}"`
          )
          break
        }
      }

      for (const match of matches) {
        if (match.outcome.kind !== 'matched') continue
        inFlight = `assignment ${match.index} (${describeAssignmentSource(match)} → ${match.gearName})`
        const gearId = gearIdByName.get(normalizeGearName(match.gearName))
        if (!gearId) {
          totals.failed += 1
          console.error(
            `  ! ${describeAssignmentSource(match)} → ${match.gearName}: gear was never created`
          )
          continue
        }

        if (input.overwrite) {
          const updated = await database.setFitnessFileGear({
            fitnessFileId: match.outcome.fileId,
            actorId: actor.id,
            gearId
          })
          if (updated) totals.assigned += 1
          else {
            totals.failed += 1
            console.error(
              `  ! ${describeAssignmentSource(match)} → ${match.gearName}: activity ${match.outcome.fileName} could not be updated`
            )
          }
          continue
        }

        const assigned = await database.assignFitnessFileGearIfUnset({
          fitnessFileId: match.outcome.fileId,
          actorId: actor.id,
          gearId
        })
        if (assigned) {
          totals.assigned += 1
        } else if (match.outcome.alreadyAssigned) {
          // Expected: the activity carried gear when the plan was read, and this
          // run is not allowed to overwrite it.
          totals.alreadyAssigned += 1
        } else {
          // The guarded UPDATE matched nothing even though the activity had no
          // gear moments ago — the row (or the gear) changed underneath us.
          totals.failed += 1
          console.error(
            `  ! ${describeAssignmentSource(match)} → ${match.gearName}: activity ${match.outcome.fileName} ` +
              'had no gear when planned but the write was rejected; it or the gear changed during the run'
          )
        }
      }

      for (const assignment of windowAssignments) {
        inFlight = `window assignment for ${assignment.gearName}`
        const gearId = gearIdByName.get(normalizeGearName(assignment.gearName))
        if (!gearId) {
          totals.failed += 1
          console.error(
            `  ! window assignment for ${assignment.gearName}: gear was never created`
          )
          continue
        }
        // Windows never overwrite, even with --overwrite: they describe a period,
        // not the specific ride the owner may have corrected by hand.
        const assigned = await database.assignFitnessFileGearIfUnset({
          fitnessFileId: assignment.fileId,
          actorId: actor.id,
          gearId
        })
        if (assigned) {
          totals.windowAssigned += 1
        } else {
          // `applyWindows` only ever offers activities whose gear was null, so
          // unlike the matched loop there is no benign reading of a false here.
          totals.failed += 1
          console.error(
            `  ! window assignment for ${assignment.gearName}: activity ${assignment.fileName} ` +
              'had no gear when planned but the write was rejected; it changed during the run'
          )
        }
      }
    } catch (error) {
      console.error(`\nAborted while processing ${inFlight}.`)
      printSummary()
      console.error(
        'Every step is idempotent — re-run to continue where it stopped.'
      )
      throw error
    }

    printSummary()

    // A run that wrote no attribution at all did not do its job, whatever the
    // per-item counters say. `alreadyAssigned` keeps a genuine re-run green.
    if (
      file.assignments.length > 0 &&
      totals.assigned + totals.windowAssigned + totals.alreadyAssigned === 0
    ) {
      console.error(
        `\nError: none of the ${file.assignments.length} assignments reached an activity. ` +
          'Check --actor-id, the database above, and the unmatched deltas.'
      )
      return 1
    }

    return totals.failed > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  importFitnessGearScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { importFitnessGearScript }
