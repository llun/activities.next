/**
 * Pure planning for `importFitnessGear.ts`: the import-file schema, the
 * assignment matcher, the date-window fallback and the component diff.
 *
 * Everything here is a pure function over plain data so the CLI entry keeps only
 * database calls and printing, and so the interesting decisions — which activity
 * an assignment lands on, which components already exist — are unit-testable
 * without a database.
 */
import { z } from 'zod'

import {
  SPORT_KEYS,
  SPORT_KIND,
  SportKey,
  USER_CREATABLE_GEAR_KINDS,
  getSportKeysForKind,
  normalizeActivityTypeToSportKey
} from '@/lib/services/fitness-files/sportTypes'
import { getGearKindFieldError } from '@/lib/services/fitness-gears/gearRequests'
import { FitnessGearKind } from '@/lib/types/database/fitnessGear'

// Column widths, same as lib/services/fitness-gears/gearRequests.ts.
const VARCHAR_MAX = 255
const NOTES_MAX = 2000
const MAX_WEIGHT_KILOGRAMS = 1000
const MAX_DISTANCE_METERS = 100_000_000

const DAY_PRECISION = /^\d{4}-\d{2}-\d{2}$/
const EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/

/**
 * A date the file gives us, as epoch milliseconds.
 *
 * A bare `2024-01-06T10:26:21` is parsed as LOCAL time by `Date.parse` (only the
 * date-only form is UTC per ES2015+), so an import authored in one zone would
 * land hours away from the activity it names — far enough to match nothing, or
 * worse, to match a neighbour. Requiring an explicit `Z`/offset on any datetime
 * makes that impossible to express; a day-precision date is read as UTC midnight,
 * which is what both Strava's gear pages and this format mean by a bare date.
 */
const utcInstant = z
  .string()
  .trim()
  .refine(
    (value) => DAY_PRECISION.test(value) || EXPLICIT_OFFSET.test(value),
    'must be a YYYY-MM-DD date or a datetime with an explicit Z/offset'
  )
  .transform((value) =>
    DAY_PRECISION.test(value)
      ? Date.parse(`${value}T00:00:00.000Z`)
      : Date.parse(value)
  )
  .refine((milliseconds) => Number.isFinite(milliseconds), 'unparseable date')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()

const optionalPositiveNumber = (max: number) =>
  z.number().positive().max(max).nullish()

const ImportComponentSchema = z
  .object({
    type: z.string().trim().min(1).max(VARCHAR_MAX),
    brand: optionalText(VARCHAR_MAX),
    model: optionalText(VARCHAR_MAX),
    // Absent or null means "installed since the gear's beginning" / "still
    // installed", matching the nullable columns.
    addedAt: utcInstant.nullish(),
    removedAt: utcInstant.nullish(),
    serviceDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS)
  })
  .refine(
    (component) =>
      !component.addedAt ||
      !component.removedAt ||
      component.removedAt > component.addedAt,
    { message: 'removedAt must be after addedAt' }
  )

const ImportWindowSchema = z
  .object({
    from: utcInstant.nullish(),
    to: utcInstant.nullish(),
    sports: z.array(z.enum(SPORT_KEYS)).min(1).max(SPORT_KEYS.length).optional()
  })
  .refine((window) => !window.from || !window.to || window.to > window.from, {
    message: 'to must be after from'
  })

const ImportGearSchema = z.object({
  name: z.string().trim().min(1).max(VARCHAR_MAX),
  // The same tuple the create route accepts. A recording device is resolved
  // from the file that was recorded on it, never named in an import plan.
  kind: z.enum(USER_CREATABLE_GEAR_KINDS),
  brand: optionalText(VARCHAR_MAX),
  model: optionalText(VARCHAR_MAX),
  bikeType: optionalText(VARCHAR_MAX),
  weightKilograms: optionalPositiveNumber(MAX_WEIGHT_KILOGRAMS),
  defaultSports: z.array(z.enum(SPORT_KEYS)).max(SPORT_KEYS.length).optional(),
  alertDistanceMeters: optionalPositiveNumber(MAX_DISTANCE_METERS),
  notes: optionalText(NOTES_MAX),
  retired: z.boolean().default(false),
  components: z.array(ImportComponentSchema).default([]),
  windows: z.array(ImportWindowSchema).default([])
})

const ImportAssignmentSchema = z.object({
  time: z
    .string()
    .trim()
    .refine(
      (value) => EXPLICIT_OFFSET.test(value),
      'assignment time needs an explicit Z/offset'
    )
    .transform((value) => Date.parse(value))
    .refine(
      (milliseconds) => Number.isFinite(milliseconds),
      'unparseable date'
    ),
  gear: z.string().trim().min(1).max(VARCHAR_MAX),
  // Diagnostics only — carried through to the reports so an unmatched entry can
  // be traced back to its Strava activity without re-deriving it from the time.
  stravaActivityId: optionalText(VARCHAR_MAX),
  filename: optionalText(VARCHAR_MAX)
})

export const GearImportFileSchema = z.object({
  gears: z.array(ImportGearSchema).min(1),
  assignments: z.array(ImportAssignmentSchema).default([])
})

export type GearImportFile = z.infer<typeof GearImportFileSchema>
export type ImportGear = GearImportFile['gears'][number]
export type ImportComponent = ImportGear['components'][number]
export type ImportWindow = ImportGear['windows'][number]
export type ImportAssignment = GearImportFile['assignments'][number]

export type ParseGearImportFileResult =
  { ok: true; file: GearImportFile } | { ok: false; errors: string[] }

const normalizeGearName = (name: string): string => name.trim().toLowerCase()

const getWindowSports = (gear: ImportGear, window: ImportWindow): SportKey[] =>
  window.sports ?? getSportKeysForKind(gear.kind)

const windowsOverlap = (left: ImportWindow, right: ImportWindow): boolean => {
  const leftFrom = left.from ?? Number.NEGATIVE_INFINITY
  const leftTo = left.to ?? Number.POSITIVE_INFINITY
  const rightFrom = right.from ?? Number.NEGATIVE_INFINITY
  const rightTo = right.to ?? Number.POSITIVE_INFINITY
  return leftFrom < rightTo && rightFrom < leftTo
}

/**
 * Checks the whole file before anything is written: a typo in a gear name should
 * fail the run, not silently drop the several hundred activities that named it.
 */
const validateGearImportFile = (file: GearImportFile): string[] => {
  const errors: string[] = []

  const gearsByName = new Map<string, ImportGear>()
  for (const gear of file.gears) {
    const key = normalizeGearName(gear.name)
    if (gearsByName.has(key)) {
      // `findFitnessGearByName` compares trimmed and lowercased, so two entries
      // differing only by case would resolve to a single database row and the
      // second would silently absorb the first's assignments.
      errors.push(`gears: duplicate gear name "${gear.name}"`)
      continue
    }
    gearsByName.set(key, gear)
  }

  const sportOwners = new Map<SportKey, string>()

  for (const gear of file.gears) {
    const kindError = getGearKindFieldError(gear.kind, {
      bikeType: gear.bikeType,
      weightKilograms: gear.weightKilograms,
      alertDistanceMeters: gear.alertDistanceMeters,
      defaultSports: gear.defaultSports
    })
    if (kindError) errors.push(`gears: "${gear.name}" ${kindError}`)

    for (const sportKey of gear.defaultSports ?? []) {
      const owner = sportOwners.get(sportKey)
      if (owner) {
        // Creating the second gear would steal the sport from the first, so the
        // file's own intent decides silently by creation order.
        errors.push(
          `gears: default sport "${sportKey}" is claimed by both "${owner}" and "${gear.name}"`
        )
        continue
      }
      sportOwners.set(sportKey, gear.name)
    }

    gear.windows.forEach((window, index) => {
      const sports = getWindowSports(gear, window)
      const mismatched = sports.find(
        (sportKey) => SPORT_KIND[sportKey] !== gear.kind
      )
      if (mismatched) {
        errors.push(
          `gears: "${gear.name}" window ${index + 1} lists "${mismatched}", which is not a ${gear.kind} sport`
        )
      }
    })
  }

  // Two windows covering the same sport at the same time have no defined winner
  // — whichever gear the loop reaches first would take the activity.
  const allWindows = file.gears.flatMap((gear) =>
    gear.windows.map((window, index) => ({ gear, window, index }))
  )
  for (let left = 0; left < allWindows.length; left += 1) {
    for (let right = left + 1; right < allWindows.length; right += 1) {
      const first = allWindows[left]
      const second = allWindows[right]
      if (!windowsOverlap(first.window, second.window)) continue

      const firstSports = new Set(getWindowSports(first.gear, first.window))
      const shared = getWindowSports(second.gear, second.window).filter(
        (sportKey) => firstSports.has(sportKey)
      )
      if (shared.length === 0) continue

      errors.push(
        `gears: window ${first.index + 1} of "${first.gear.name}" and window ${second.index + 1} of ` +
          `"${second.gear.name}" overlap in time and both claim ${shared.join(', ')}`
      )
    }
  }

  file.assignments.forEach((assignment, index) => {
    if (!gearsByName.has(normalizeGearName(assignment.gear))) {
      errors.push(
        `assignments[${index}]: unknown gear "${assignment.gear}" — add it to gears[]`
      )
    }
  })

  return errors
}

export const parseGearImportFile = (
  input: unknown
): ParseGearImportFileResult => {
  const parsed = GearImportFileSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`
      )
    }
  }

  const errors = validateGearImportFile(parsed.data)
  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, file: parsed.data }
}

/** The subset of a fitness file row the planning functions read. */
export interface MatchableFitnessFile {
  id: string
  fileName: string
  activityStartTime?: number
  activityType?: string
  gearId?: string
  processingStatus?: string
  /** Strava's own activity URL, for files this instance imported from Strava. */
  sourceUrl?: string
  totalDistanceMeters?: number
}

/**
 * How an assignment reached its activity.
 *
 * `strava-id` and `filename` name the very row; `time` infers it. Reported so an
 * operator can tell a certainty from an inference at a glance.
 */
export type AssignmentMatchedBy = 'strava-id' | 'filename' | 'time'

export type AssignmentOutcome =
  | {
      kind: 'matched'
      fileId: string
      fileName: string
      matchedBy: AssignmentMatchedBy
      /** Absent when the file carries no start time to compare against. */
      deltaMilliseconds?: number
      kindMismatch: boolean
      alreadyAssigned: boolean
    }
  | { kind: 'unmatched'; nearestDeltaMilliseconds?: number }
  | { kind: 'ambiguous'; fileIds: string[] }
  | { kind: 'conflict'; fileId: string; claimedByAssignmentIndex: number }

export interface AssignmentMatch {
  index: number
  timeMilliseconds: number
  gearName: string
  stravaActivityId?: string | null
  outcome: AssignmentOutcome
}

export interface MatchAssignmentsResult {
  matches: AssignmentMatch[]
  /**
   * Files an explicit assignment has spoken for, whether or not it resolved.
   *
   * Matched files are the obvious case. The files behind an `ambiguous` tie and
   * the target of a `conflict` belong here too: the import file states which
   * gear those rides were on, and a window covering the same period is the
   * coarser rule. Leaving them out would let a window attribute a ride to a
   * different gear than the entry that named it — a wrong answer arrived at
   * precisely because the right one was too uncertain to use.
   */
  reservedFileIds: Set<string>
  /** Files with no `activityStartTime` — unplaceable in time, reported instead. */
  timestamplessFileCount: number
}

const getFileSportKind = (
  file: MatchableFitnessFile
): FitnessGearKind | null => {
  const sportKey = normalizeActivityTypeToSportKey(file.activityType)
  // A null sport key means the normalizer has no opinion (gym work, swimming,
  // free-form text), which is not evidence of a mismatch.
  return sportKey ? SPORT_KIND[sportKey] : null
}

/** `https://www.strava.com/activities/19812110930` → `19812110930`. */
const STRAVA_ACTIVITY_URL = /\/activities\/(\d+)(?:[/?#]|$)/
/** What the webhook importer names the file it builds: `strava-<id>.tcx`. */
const STRAVA_IMPORT_FILE_NAME = /^strava-(\d+)\.[a-z0-9]+$/i

/**
 * The Strava activity this file came from, if it says so.
 *
 * `sourceUrl` is the authoritative record and is read first; the file name is
 * the fallback for rows imported before that column was backfilled.
 */
const getStravaActivityId = (file: MatchableFitnessFile): string | null => {
  const fromUrl = file.sourceUrl
    ? STRAVA_ACTIVITY_URL.exec(file.sourceUrl)
    : null
  if (fromUrl) return fromUrl[1]
  const fromFileName = STRAVA_IMPORT_FILE_NAME.exec(file.fileName.trim())
  return fromFileName ? fromFileName[1] : null
}

/**
 * Both sides of a file-name comparison, reduced to the same shape.
 *
 * The export's `Filename` column is a path into the archive (`activities/1.gpx`)
 * and may carry the `.gz` the archive importer strips before storing, so a raw
 * comparison against `fitness_files.fileName` never matches.
 */
const normalizeFileName = (name: string): string =>
  (name.trim().split('/').pop() ?? '').replace(/\.gz$/i, '').toLowerCase()

const addToIndex = (
  index: Map<string, MatchableFitnessFile[]>,
  key: string,
  file: MatchableFitnessFile
): void => {
  const existing = index.get(key)
  if (existing) existing.push(file)
  else index.set(key, [file])
}

/** Index of the first entry whose start time is >= `target`. */
const lowerBound = (
  files: MatchableFitnessFile[],
  target: number,
  startTimeOf: (file: MatchableFitnessFile) => number
): number => {
  let low = 0
  let high = files.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (startTimeOf(files[middle]) < target) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Matches each assignment to the activity it names, by identity where the file
 * states one and by nearest timestamp otherwise.
 *
 * Identity goes first and ignores the tolerance entirely: a `sourceUrl` or a
 * `strava-<id>.tcx` name IS the activity, so a clock that drifted — or a file
 * with no start time at all — no longer costs the attribution. Only when
 * neither side names the row does the timestamp decide, within
 * `toleranceMilliseconds`.
 *
 * Two activities are never both plausible in time in practice — the closest gap
 * in a decade of real data is minutes, not seconds — so a tie means something is
 * genuinely duplicated (a repaired import twin, say) and the entry is skipped
 * rather than guessed at. Likewise a second assignment landing on an
 * already-claimed file is reported instead of cascading to its second choice,
 * which would quietly mis-attribute a ride.
 */
export const matchAssignmentsToFiles = ({
  assignments,
  files,
  toleranceMilliseconds,
  gearKindByName
}: {
  assignments: Pick<
    ImportAssignment,
    'time' | 'gear' | 'stravaActivityId' | 'filename'
  >[]
  files: MatchableFitnessFile[]
  toleranceMilliseconds: number
  gearKindByName: Map<string, FitnessGearKind>
}): MatchAssignmentsResult => {
  const startTimeOf = (file: MatchableFitnessFile): number =>
    file.activityStartTime as number

  const candidates = files
    .filter((file) => typeof file.activityStartTime === 'number')
    .sort((left, right) => startTimeOf(left) - startTimeOf(right))

  const filesByStravaId = new Map<string, MatchableFitnessFile[]>()
  const filesByName = new Map<string, MatchableFitnessFile[]>()
  for (const file of files) {
    const stravaId = getStravaActivityId(file)
    if (stravaId) addToIndex(filesByStravaId, stravaId, file)
    addToIndex(filesByName, normalizeFileName(file.fileName), file)
  }

  const claimedBy = new Map<string, number>()
  const reservedFileIds = new Set<string>()
  const outcomes = new Array<AssignmentOutcome | undefined>(assignments.length)

  const describe = (
    assignment: Pick<ImportAssignment, 'time' | 'gear' | 'stravaActivityId'>,
    index: number
  ) => ({
    index,
    timeMilliseconds: assignment.time,
    gearName: assignment.gear,
    stravaActivityId: assignment.stravaActivityId
  })

  const toMatched = (
    file: MatchableFitnessFile,
    assignment: Pick<ImportAssignment, 'time' | 'gear'>,
    matchedBy: AssignmentMatchedBy
  ): AssignmentOutcome => {
    const gearKind = gearKindByName.get(normalizeGearName(assignment.gear))
    const fileKind = getFileSportKind(file)
    return {
      kind: 'matched',
      fileId: file.id,
      fileName: file.fileName,
      matchedBy,
      ...(typeof file.activityStartTime === 'number'
        ? {
            deltaMilliseconds: Math.abs(
              file.activityStartTime - assignment.time
            )
          }
        : {}),
      kindMismatch: Boolean(gearKind && fileKind && fileKind !== gearKind),
      alreadyAssigned: Boolean(file.gearId)
    }
  }

  /** Claims `file` for this assignment, or reports whoever holds it already. */
  const claim = (
    file: MatchableFitnessFile,
    assignment: Pick<ImportAssignment, 'time' | 'gear'>,
    index: number,
    matchedBy: AssignmentMatchedBy
  ): AssignmentOutcome => {
    reservedFileIds.add(file.id)
    const claimingIndex = claimedBy.get(file.id)
    if (claimingIndex !== undefined) {
      return {
        kind: 'conflict',
        fileId: file.id,
        claimedByAssignmentIndex: claimingIndex
      }
    }
    claimedBy.set(file.id, index)
    return toMatched(file, assignment, matchedBy)
  }

  // --- Pass 1: the file itself names the activity ------------------------
  // Runs to completion before any timestamp is considered, so a certain match
  // always beats an inferred one no matter what order the entries are in.
  assignments.forEach((assignment, index) => {
    const byId = assignment.stravaActivityId
      ? filesByStravaId.get(assignment.stravaActivityId.trim())
      : undefined

    if (byId?.length) {
      // Two rows claiming one Strava activity is a real duplicate — a repaired
      // import twin — and picking either would attribute half a ride.
      if (byId.length > 1) {
        for (const file of byId) reservedFileIds.add(file.id)
        outcomes[index] = {
          kind: 'ambiguous',
          fileIds: byId.map((file) => file.id)
        }
        return
      }
      outcomes[index] = claim(byId[0], assignment, index, 'strava-id')
      return
    }

    const byName = assignment.filename
      ? filesByName.get(normalizeFileName(assignment.filename))
      : undefined
    // A name is only evidence while it is unique. Unlike a duplicated activity
    // id, a repeated file name says nothing the timestamp cannot settle better
    // (two hand-uploaded `activity.gpx` are different rides), so it falls
    // through to the time pass rather than blocking the entry.
    if (byName?.length === 1) {
      outcomes[index] = claim(byName[0], assignment, index, 'filename')
    }
  })

  // --- Pass 2: nothing named it, so the clock decides --------------------
  assignments.forEach((assignment, index) => {
    if (outcomes[index]) return

    const target = assignment.time
    const withinTolerance: MatchableFitnessFile[] = []
    let nearestDelta = Number.POSITIVE_INFINITY

    const pivot = lowerBound(candidates, target, startTimeOf)
    for (let cursor = pivot; cursor < candidates.length; cursor += 1) {
      const delta = Math.abs(startTimeOf(candidates[cursor]) - target)
      nearestDelta = Math.min(nearestDelta, delta)
      if (delta > toleranceMilliseconds) break
      withinTolerance.push(candidates[cursor])
    }
    for (let cursor = pivot - 1; cursor >= 0; cursor -= 1) {
      const delta = Math.abs(startTimeOf(candidates[cursor]) - target)
      nearestDelta = Math.min(nearestDelta, delta)
      if (delta > toleranceMilliseconds) break
      withinTolerance.push(candidates[cursor])
    }

    if (withinTolerance.length === 0) {
      outcomes[index] = {
        kind: 'unmatched',
        nearestDeltaMilliseconds: Number.isFinite(nearestDelta)
          ? nearestDelta
          : undefined
      }
      return
    }

    const deltaOf = (file: MatchableFitnessFile): number =>
      Math.abs(startTimeOf(file) - target)
    const minimumDelta = Math.min(...withinTolerance.map(deltaOf))
    const nearest = withinTolerance.filter(
      (file) => deltaOf(file) === minimumDelta
    )

    if (nearest.length > 1) {
      for (const file of nearest) reservedFileIds.add(file.id)
      outcomes[index] = {
        kind: 'ambiguous',
        fileIds: nearest.map((file) => file.id)
      }
      return
    }

    outcomes[index] = claim(nearest[0], assignment, index, 'time')
  })

  return {
    matches: assignments.map((assignment, index) => ({
      ...describe(assignment, index),
      // Every index is written by one of the two passes above; the fallback is
      // only here so the type does not have to admit `undefined`.
      outcome: outcomes[index] ?? { kind: 'unmatched' }
    })),
    reservedFileIds,
    timestamplessFileCount: files.filter(
      (file) => typeof file.activityStartTime !== 'number'
    ).length
  }
}

/**
 * A countable activity the whole plan left with no gear.
 *
 * Gear totals are derived from exactly these rows, so a leftover here is a
 * missing kilometre on the gear page — and the only reason an operator
 * comparing against Strava would come up short. The script reports assignments
 * that found no activity; this is the other direction, activities no assignment
 * (or window, or the app's own auto-assign) ever reached, which is what the
 * numbers are actually made of.
 */
export interface UnattributedActivity {
  fileId: string
  fileName: string
  activityStartTime?: number
  activityType?: string
  sourceUrl?: string
  totalDistanceMeters: number
  /** `null` when the type maps to no sport, so nothing could auto-attribute it. */
  sportKey: SportKey | null
}

export const findUnattributedActivities = ({
  files,
  reservedFileIds,
  windowAssignedFileIds
}: {
  files: MatchableFitnessFile[]
  reservedFileIds: Set<string>
  windowAssignedFileIds: Set<string>
}): UnattributedActivity[] =>
  files
    .filter(
      (file) =>
        !file.gearId &&
        !reservedFileIds.has(file.id) &&
        !windowAssignedFileIds.has(file.id) &&
        // Only 'completed' activities count toward a gear total, and only ones
        // carrying distance move it. Anything else would pad the report without
        // changing the number the operator is chasing — and the gym sessions
        // that record no distance would bury the rides that do.
        file.processingStatus === 'completed' &&
        (file.totalDistanceMeters ?? 0) > 0
    )
    .map((file) => ({
      fileId: file.id,
      fileName: file.fileName,
      activityStartTime: file.activityStartTime,
      activityType: file.activityType,
      sourceUrl: file.sourceUrl,
      totalDistanceMeters: file.totalDistanceMeters ?? 0,
      sportKey: normalizeActivityTypeToSportKey(file.activityType)
    }))
    .sort(
      (left, right) =>
        (left.activityStartTime ?? 0) - (right.activityStartTime ?? 0)
    )

export interface WindowAssignment {
  fileId: string
  fileName: string
  gearName: string
  activityStartTime: number
}

/**
 * Fills in the activities no explicit assignment named, using each gear's date
 * windows.
 *
 * Windows are the coarse rule and assignments are the fine one, so any file an
 * assignment spoke for is skipped even when a window also covers it — including
 * the files behind an assignment that could not be resolved (see
 * `reservedFileIds`). A file that already carries gear is left alone too: this
 * pass never overwrites, since a window is a statement about a period, not about
 * a specific ride the owner may have corrected by hand.
 */
export const applyWindows = ({
  gears,
  files,
  reservedFileIds
}: {
  gears: ImportGear[]
  files: MatchableFitnessFile[]
  reservedFileIds: Set<string>
}): WindowAssignment[] => {
  const assignments: WindowAssignment[] = []
  const taken = new Set(reservedFileIds)

  for (const file of files) {
    if (taken.has(file.id) || file.gearId) continue
    if (typeof file.activityStartTime !== 'number') continue

    const sportKey = normalizeActivityTypeToSportKey(file.activityType)
    if (!sportKey) continue

    for (const gear of gears) {
      if (SPORT_KIND[sportKey] !== gear.kind) continue

      const window = gear.windows.find((candidate) => {
        const from = candidate.from ?? Number.NEGATIVE_INFINITY
        const to = candidate.to ?? Number.POSITIVE_INFINITY
        // Half-open [from, to) so back-to-back windows share a boundary date
        // without both claiming the activity that starts exactly on it.
        const time = file.activityStartTime as number
        if (time < from || time >= to) return false
        return getWindowSports(gear, candidate).includes(sportKey)
      })
      if (!window) continue

      taken.add(file.id)
      assignments.push({
        fileId: file.id,
        fileName: file.fileName,
        gearName: gear.name,
        activityStartTime: file.activityStartTime
      })
      break
    }
  }

  return assignments
}

export interface ExistingComponent {
  componentType: string
  brand?: string
  model?: string
  addedAt?: number
}

/**
 * Which of a gear's components are not in the database yet.
 *
 * Identity is (type, brand, model, addedAt): a bike carries several chains over
 * its life, identical but for when they went on. `removedAt` is deliberately not
 * part of it, so correcting a removal date in the file and re-running does not
 * create a duplicate — this script, like the rest of the import paths, never
 * mutates a row the owner may have edited.
 */
export const diffGearComponents = ({
  components,
  existing
}: {
  components: ImportComponent[]
  existing: ExistingComponent[]
}): ImportComponent[] => {
  const identityOf = (component: {
    type: string
    brand?: string | null
    model?: string | null
    addedAt?: number | null
  }) =>
    JSON.stringify([
      component.type.trim().toLowerCase(),
      component.brand?.trim().toLowerCase() ?? null,
      component.model?.trim().toLowerCase() ?? null,
      component.addedAt ?? null
    ])

  const known = new Set(
    existing.map((component) =>
      identityOf({
        type: component.componentType,
        brand: component.brand,
        model: component.model,
        addedAt: component.addedAt
      })
    )
  )

  return components.filter((component) => !known.has(identityOf(component)))
}
