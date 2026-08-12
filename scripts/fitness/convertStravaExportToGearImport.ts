#!/usr/bin/env -S node scripts/run.cjs
/**
 * Builds a gear import file from a Strava data export and a hand-authored gear
 * description.
 *
 * The export's `activities.csv` is the only place that records which gear each
 * historical activity used, and it names the gear by display name against a UTC
 * timestamp. That is exactly what `importFitnessGear.ts` matches on, so this
 * script is a straight transcription: one assignment per activity that carries
 * gear.
 *
 * What the export does NOT contain is component history — `components.csv` lists
 * parts with no dates at all. Install and removal dates live only on Strava's
 * gear pages, so the `gears` half of the import file is hand-authored (read off
 * those pages) and passed in with `--gears`; this script merges the two and
 * validates the result before writing it.
 *
 * Usage:
 *   scripts/fitness/convertStravaExportToGearImport.ts \
 *     --export-dir ./strava-export \
 *     --gears ./gears.json \
 *     --output ./gear-import.json
 */
import { parse } from 'csv-parse/sync'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { parseGearImportFile } from './gearImportPlan'

const CliArgs = z.object({
  exportDir: z.string().min(1),
  gears: z.string().min(1),
  output: z.string().min(1)
})

const USAGE = `Usage: scripts/fitness/convertStravaExportToGearImport.ts \\
  --export-dir ./strava-export \\
  --gears ./gears.json \\
  --output ./gear-import.json`

export const parseArgs = (args: string[]) => {
  const parsed: Record<string, string> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)
    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }
    if (inlineValue === undefined) index += 1
    parsed[rawKey] = nextValue
  }

  return CliArgs.parse({
    exportDir: parsed['export-dir'],
    gears: parsed['gears'],
    output: parsed['output']
  })
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
}

const ACTIVITY_DATE =
  /^([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/

/**
 * Parses Strava's export date (`Aug 10, 2026, 3:43:45 PM`) as UTC.
 *
 * The column is UTC despite looking local — it matches the `<time>` element of
 * the exported GPX for the same activity to the second, which is what makes
 * matching on it reliable. Parsing is hand-rolled rather than delegated because
 * every library route back to a UTC instant needs either a timezone package the
 * project does not carry or a reference-date trick that reads as a bug.
 *
 * Throws on anything else, including a non-English export: guessing at a month
 * name would shift a year's activities by weeks.
 */
export const parseStravaExportDate = (value: string): number => {
  const matched = ACTIVITY_DATE.exec(value.trim())
  if (!matched) {
    throw new Error(`Unparseable Strava activity date: ${value}`)
  }

  const [, month, day, year, hour, minute, second, meridiem] = matched
  const monthIndex = MONTHS[month]
  if (monthIndex === undefined) {
    throw new Error(
      `Unknown month "${month}" in "${value}" — is this an English export?`
    )
  }

  const hour12 = Number(hour)
  if (hour12 < 1 || hour12 > 12) {
    throw new Error(`Invalid hour in Strava activity date: ${value}`)
  }
  const hour24 = (hour12 % 12) + (meridiem === 'PM' ? 12 : 0)

  return Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    hour24,
    Number(minute),
    Number(second)
  )
}

export interface StravaActivityRow {
  activityId: string
  timeMilliseconds: number
  activityType: string
  gear: string
  fileName: string
  distanceMeters: number | null
}

/**
 * Reads `activities.csv` into rows.
 *
 * Parsed as arrays rather than objects on purpose: the file repeats five header
 * names ("Distance", "Elapsed Time", "Max Heart Rate", "Relative Effort",
 * "Commute"), and object mode keeps only the last of each. The second "Distance"
 * is the one in meters, and it is the only column that reproduces the totals
 * Strava shows on the gear pages — which makes it the checksum for this whole
 * conversion, so it has to be addressed by position.
 */
export const parseStravaActivitiesCsv = (csv: string): StravaActivityRow[] => {
  // `info` carries the physical line each record ends on. Counting records
  // instead would drift low for everything after the first blank line or
  // multi-line description — and a line number that is confidently wrong is
  // worse than none, because the operator trusts it and reads an unrelated row.
  const parsed = parse(csv, {
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    info: true
  }) as { record: string[]; info: { lines: number } }[]

  if (parsed.length === 0) throw new Error('activities.csv is empty')

  const header = parsed[0].record
  const indexOf = (name: string, occurrence = 1): number => {
    let seen = 0
    for (let index = 0; index < header.length; index += 1) {
      if (header[index].trim() !== name) continue
      seen += 1
      if (seen === occurrence) return index
    }
    throw new Error(
      `activities.csv is missing the "${name}" column${occurrence > 1 ? ` (occurrence ${occurrence})` : ''}`
    )
  }

  const activityIdIndex = indexOf('Activity ID')
  const dateIndex = indexOf('Activity Date')
  const typeIndex = indexOf('Activity Type')
  const gearIndex = indexOf('Activity Gear')
  const fileNameIndex = indexOf('Filename')
  // The first "Distance" is kilometres for display; the second is meters.
  let distanceIndex: number | null = null
  try {
    distanceIndex = indexOf('Distance', 2)
  } catch (error) {
    // Not fatal — the assignments are still correct without it — but the totals
    // it feeds are the only cheap check that the gear names were transcribed
    // right, and a confident "0.0 km" reads like the activities have no
    // distance rather than like the column is missing.
    console.warn(
      `Warning: ${(error as Error).message}. Per-gear distances will read 0.0 km ` +
        'and cannot be cross-checked against the Strava gear pages.'
    )
    distanceIndex = null
  }

  return parsed.slice(1).map(({ record: row, info }) => {
    // `relax_column_count` lets short and mis-quoted rows through on purpose —
    // Strava descriptions carry newlines and stray quotes — so a row that fails
    // here has to name itself or it is unfindable in a 1,700-row file.
    const line = info.lines
    try {
      const rawDistance =
        distanceIndex === null ? '' : (row[distanceIndex] ?? '')
      const distanceMeters = rawDistance.trim() ? Number(rawDistance) : NaN

      return {
        activityId: (row[activityIdIndex] ?? '').trim(),
        timeMilliseconds: parseStravaExportDate(row[dateIndex] ?? ''),
        activityType: (row[typeIndex] ?? '').trim(),
        gear: (row[gearIndex] ?? '').trim(),
        fileName: (row[fileNameIndex] ?? '').trim(),
        distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null
      }
    } catch (error) {
      throw new Error(
        `line ${line} (${row.length} columns): ${(error as Error).message}`
      )
    }
  })
}

export interface ConversionReport {
  gearName: string
  assignmentCount: number
  distanceMeters: number
}

export interface ConversionResult {
  assignments: {
    time: string
    gear: string
    stravaActivityId?: string
    filename?: string
  }[]
  reports: ConversionReport[]
  skippedByType: Record<string, number>
  unknownGear: string[]
  /** Gear-carrying rows whose distance would not parse; the totals are low by these. */
  unreadableDistanceCount: number
}

/**
 * Turns activity rows into assignments, keeping only the ones that name gear.
 *
 * A gear name the `gears` file does not describe is collected rather than
 * dropped: the import would fail validation on it anyway, and knowing which name
 * is missing is the difference between a one-line fix and a hunt.
 */
export const buildAssignments = ({
  rows,
  knownGearNames
}: {
  rows: StravaActivityRow[]
  knownGearNames: string[]
}): ConversionResult => {
  const known = new Set(knownGearNames.map((name) => name.trim().toLowerCase()))
  const assignments: ConversionResult['assignments'] = []
  const totals = new Map<string, { count: number; distanceMeters: number }>()
  const skippedByType: Record<string, number> = {}
  const unknownGear = new Set<string>()
  let unreadableDistanceCount = 0

  for (const row of rows) {
    if (!row.gear) {
      const type = row.activityType || '(unknown)'
      skippedByType[type] = (skippedByType[type] ?? 0) + 1
      continue
    }

    if (!known.has(row.gear.toLowerCase())) unknownGear.add(row.gear)

    assignments.push({
      time: new Date(row.timeMilliseconds).toISOString(),
      gear: row.gear,
      ...(row.activityId ? { stravaActivityId: row.activityId } : {}),
      // The archive importer stores the basename with `.gz` stripped, so this
      // lines up with `fitness_files.fileName` for anything imported that way.
      ...(row.fileName
        ? { filename: row.fileName.split('/').pop()?.replace(/\.gz$/, '') }
        : {})
    })

    if (row.distanceMeters === null) unreadableDistanceCount += 1

    const total = totals.get(row.gear) ?? { count: 0, distanceMeters: 0 }
    total.count += 1
    total.distanceMeters += row.distanceMeters ?? 0
    totals.set(row.gear, total)
  }

  return {
    assignments,
    reports: [...totals.entries()]
      .map(([gearName, total]) => ({
        gearName,
        assignmentCount: total.count,
        distanceMeters: total.distanceMeters
      }))
      .sort((left, right) => right.assignmentCount - left.assignmentCount),
    skippedByType,
    unknownGear: [...unknownGear],
    unreadableDistanceCount
  }
}

async function convertStravaExportToGearImportScript(
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

  let gearsInput: unknown
  try {
    gearsInput = JSON.parse(readFileSync(input.gears, 'utf-8'))
  } catch (error) {
    console.error(
      `Error: cannot read ${input.gears}: ${(error as Error).message}`
    )
    return 1
  }

  // The gears file is the import file minus its assignments, so it goes through
  // the same schema — a bad component date should surface here, not after the
  // 1,500-line assignment list has been generated on top of it.
  const gearsOnly = parseGearImportFile({
    gears: (gearsInput as { gears?: unknown })?.gears ?? gearsInput,
    assignments: []
  })
  if (!gearsOnly.ok) {
    console.error(`Error: ${input.gears} is not a valid gear description:`)
    for (const error of gearsOnly.errors) console.error(`  - ${error}`)
    return 1
  }

  const activitiesPath = join(input.exportDir, 'activities.csv')
  let rows: StravaActivityRow[]
  try {
    rows = parseStravaActivitiesCsv(readFileSync(activitiesPath, 'utf-8'))
  } catch (error) {
    console.error(
      `Error reading ${activitiesPath}: ${(error as Error).message}`
    )
    return 1
  }

  const result = buildAssignments({
    rows,
    knownGearNames: gearsOnly.file.gears.map((gear) => gear.name)
  })

  if (result.unknownGear.length > 0) {
    console.error(
      `Error: activities.csv names gear that ${input.gears} does not describe:`
    )
    for (const name of result.unknownGear) console.error(`  - ${name}`)
    return 1
  }

  // Writing an empty assignment list would validate and exit 0, and the import
  // that consumed it would create the gear and attribute nothing — two green
  // runs and no attribution, discovered days later on the fitness page.
  if (rows.length > 0 && result.assignments.length === 0) {
    console.error(
      `Error: none of the ${rows.length} activities in ${activitiesPath} name any gear ` +
        '(the "Activity Gear" column is empty on every row) — nothing to convert.'
    )
    return 1
  }

  const output = {
    gears: (gearsInput as { gears?: unknown })?.gears ?? gearsInput,
    assignments: result.assignments
  }

  const validated = parseGearImportFile(output)
  if (!validated.ok) {
    console.error('Error: the generated import file failed validation:')
    for (const error of validated.errors) console.error(`  - ${error}`)
    return 1
  }

  writeFileSync(input.output, `${JSON.stringify(output, null, 2)}\n`, 'utf-8')

  console.log(
    `\n${rows.length} activities read, ${result.assignments.length} assignments written to ${input.output}.`
  )
  console.log("\nPer gear (distance is Strava's own, for cross-checking):")
  for (const report of result.reports) {
    console.log(
      `  ${report.gearName}: ${report.assignmentCount} activities, ` +
        `${(report.distanceMeters / 1000).toFixed(1)} km`
    )
  }
  if (result.unreadableDistanceCount > 0) {
    console.log(
      `  (${result.unreadableDistanceCount} activities had an unreadable distance, ` +
        'so the totals above are low by that much.)'
    )
  }

  const skipped = Object.entries(result.skippedByType).sort(
    (left, right) => right[1] - left[1]
  )
  if (skipped.length > 0) {
    const total = skipped.reduce((sum, [, count]) => sum + count, 0)
    console.log(`\nSkipped ${total} activities with no gear:`)
    for (const [type, count] of skipped) console.log(`  ${type}: ${count}`)
  }

  return 0
}

if (require.main === module) {
  convertStravaExportToGearImportScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { convertStravaExportToGearImportScript }
