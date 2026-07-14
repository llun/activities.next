#!/usr/bin/env -S node scripts/run.cjs
/**
 * Recreates the local post for a fitness file that is ALREADY in storage but was
 * never linked to a status (orphaned), WITHOUT calling Strava. Use this when the
 * Strava re-import path (retrigerStravaActivities / repairFailedFitnessImports)
 * fails because the source activity was deleted from Strava (`404 Record Not
 * Found`) — the stored `.tcx`/`.gpx`/`.fit` is all we need.
 *
 * It reuses the existing stored file (no duplicate, no re-download), builds the
 * post from the file via importFitnessFilesJob, links the file, sets
 * importStatus='completed', and queues the route-map job. When several orphaned
 * files are given at once they are grouped by same-ride overlap (>=80% on
 * start+duration), so one ride recorded as two Strava activities merges into ONE
 * post (one primary carries the map, the rest are attached) instead of creating
 * duplicates.
 *
 * An orphan whose same-ride sibling ALREADY has a post is merged INTO that post
 * rather than getting one of its own: the sibling stays primary and keeps its
 * route map, and the orphan is attached to it (processingStatus='completed', no
 * second map). So recovering a half-failed same-ride pair — one Strava activity
 * imported, its twin failed — no longer means deleting the good post first.
 * Run with --dry-run to see MERGE vs NEW per post before anything is written.
 *
 * Run it with the PRODUCTION env (see diagnoseFitnessImport.ts — move `.env.local`
 * aside so `.env.production` wins, or this hits your local SQLite).
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/importStoredFitnessFile.ts \
 *     --actor-id https://<host>/users/<username> \
 *     ( --activity-id <strava-id> | --batch-id <batch> | --fitness-file-id <uuid> )... \
 *     [--visibility public|unlisted|private|direct]   (default public) \
 *     [--dry-run]
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { OVERLAP_CONTEXT_SCAN_LIMIT } from '@/lib/jobs/fitnessImportOverlap'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import {
  ParseableFitnessFileType,
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import { getStravaActivityBatchId } from '@/lib/services/strava/activityBatch'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { printDatabaseBanner } from './describeConnection'
import { StoredImportTarget, buildStoredImportPlan } from './storedImportPlan'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const parseArgs = (args: string[]) => {
  let actorId: string | undefined
  const activityIds: string[] = []
  const batchIds: string[] = []
  const fitnessFileIds: string[] = []
  let visibility = 'public'
  let dryRun = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const [key, inline] = arg.slice(2).split('=', 2)
    const value = inline ?? args[i + 1]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for --${key}`)
    if (inline === undefined) i += 1
    if (key === 'actor-id') actorId = value
    else if (key === 'activity-id') activityIds.push(value)
    else if (key === 'batch-id') batchIds.push(value)
    else if (key === 'fitness-file-id') fitnessFileIds.push(value)
    else if (key === 'visibility') visibility = value
    else throw new Error(`Unknown argument: --${key}`)
  }

  if (!actorId) throw new Error('--actor-id is required')
  if (activityIds.length + batchIds.length + fitnessFileIds.length === 0) {
    throw new Error(
      'Provide at least one of --activity-id / --batch-id / --fitness-file-id'
    )
  }
  return {
    actorId,
    activityIds,
    batchIds,
    fitnessFileIds,
    visibility: Visibility.parse(visibility),
    dryRun
  }
}

const toErrorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)) || 'Unknown error'

/**
 * Loads the candidate same-ride siblings for the targets: files whose ACTIVITY
 * time sits in the window around each target's ride, plus (as a backstop for
 * targets that could not be parsed, which therefore have no window) the actor's
 * most recent files.
 */
const getSiblingContextFiles = async (
  database: Database,
  actorId: string,
  targets: StoredImportTarget[]
): Promise<FitnessFile[]> => {
  const byId = new Map<string, FitnessFile>()

  for (const target of targets) {
    if (
      typeof target.startTimeMs !== 'number' ||
      typeof target.durationSeconds !== 'number' ||
      target.durationSeconds <= 0
    ) {
      continue
    }

    // Same window getOverlapContextFitnessFileIds applies when it narrows.
    const windowMs = Math.max(target.durationSeconds * 1000 * 2, 60 * 60 * 1000)
    const files = await database.getFitnessFilesByActor({
      actorId,
      limit: OVERLAP_CONTEXT_SCAN_LIMIT,
      startDate: new Date(target.startTimeMs - windowMs),
      endDate: new Date(target.startTimeMs + windowMs)
    })
    files.forEach((file) => byId.set(file.id, file))
  }

  const hasUnwindowedTarget = targets.some(
    (target) =>
      typeof target.startTimeMs !== 'number' ||
      typeof target.durationSeconds !== 'number' ||
      target.durationSeconds <= 0
  )
  if (hasUnwindowedTarget) {
    const recent = await database.getFitnessFilesByActor({
      actorId,
      limit: OVERLAP_CONTEXT_SCAN_LIMIT
    })
    recent.forEach((file) => byId.set(file.id, file))
  }

  return [...byId.values()]
}

async function main() {
  let input: ReturnType<typeof parseArgs>
  try {
    input = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }

  printDatabaseBanner()

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  const actor = await database.getActorFromId({ id: input.actorId })
  if (!actor) {
    console.error(
      `Error: Actor not found: ${input.actorId} — wrong database? (see diagnoseFitnessImport.ts)`
    )
    return 1
  }

  // Collect the candidate files: explicit ids + everything in the given batches.
  const seen = new Set<string>()
  const candidates: FitnessFile[] = []
  const addFile = (file: FitnessFile | null | undefined) => {
    if (!file || file.actorId !== input.actorId || seen.has(file.id)) return
    seen.add(file.id)
    candidates.push(file)
  }

  for (const id of input.fitnessFileIds) {
    addFile(await database.getFitnessFile({ id }))
  }
  const batchIds = [
    ...input.batchIds,
    ...input.activityIds.map((id) => getStravaActivityBatchId(id))
  ]
  for (const batchId of batchIds) {
    const files = await database.getFitnessFilesByBatchId({ batchId })
    files.forEach(addFile)
  }

  // Only orphaned files (no status) are recreated; already-linked ones are left.
  const targets = candidates.filter((file) => {
    if (file.statusId) {
      console.log(
        `  - skip ${file.fileName} (${file.id}) — already linked to a status`
      )
      return false
    }
    return true
  })

  if (targets.length === 0) {
    console.log('No orphaned stored files to recreate for this actor.')
    return 0
  }

  // Pass EVERY orphaned target to a SINGLE importFitnessFilesJob call and let it
  // group by same-ride overlap: files that overlap >=80% on start+duration
  // collapse into ONE post (one primary file carries the map, the rest are
  // attached), while genuinely distinct rides each get their own post. Grouping
  // per-batch instead would stop a same-ride pair recorded as two Strava
  // activities from ever merging — which is exactly the duplicate case here.
  const targetIds = targets.map((f) => f.id)
  const batchId = targets[0].importBatchId ?? `manual-recover:${targets[0].id}`

  // Parse each target the way importFitnessFilesJob will. A file that failed to
  // import has no stored activity data, so planning from the row would wrongly
  // call it ungroupable and predict a NEW post where the job actually merges.
  const plannedTargets: StoredImportTarget[] = await Promise.all(
    targets.map(async (file) => {
      let buffer: Buffer
      try {
        if (!isParseableFitnessFileType(file.fileType)) {
          throw new Error(`Unsupported fitness file type: ${file.fileType}`)
        }
        buffer = await getFitnessFileBuffer(database, file.id, file)
      } catch (error) {
        // Separate from a parse failure: a storage error is usually transient or
        // an env mistake ("run it again"), a parse failure is the file itself.
        return {
          file,
          parseError: `could not read from storage: ${toErrorMessage(error)}`
        }
      }

      try {
        const activityData = await parseFitnessFile({
          fileType: file.fileType as ParseableFitnessFileType,
          buffer
        })
        return {
          file,
          durationSeconds: activityData.totalDurationSeconds,
          ...(activityData.startTime
            ? { startTimeMs: activityData.startTime.getTime() }
            : null)
        }
      } catch (error) {
        return { file, parseError: toErrorMessage(error) }
      }
    })
  )

  // Same-ride siblings that ALREADY have a post, so the job reuses their status
  // instead of creating a second post for the ride.
  //
  // Scope this by the ride's ACTIVITY time, not by recency. The Strava importer
  // can scan "the actor's N most recent files" because it runs seconds after the
  // sibling was uploaded — but this script exists to recover OLD orphans, and by
  // now the actor may have uploaded hundreds of files since. A recency window
  // would drop the sibling and silently create the duplicate post.
  const contextFiles = await getSiblingContextFiles(
    database,
    input.actorId,
    plannedTargets
  )
  const { overlapFitnessFileIds, groups, unparseable } = buildStoredImportPlan({
    targets: plannedTargets,
    contextFiles
  })

  console.log(
    `Recreating posts for ${targets.length} orphaned file(s) in one overlap-aware import` +
      (input.dryRun ? ' (dry run)' : '') +
      ` with visibility=${input.visibility}`
  )
  console.log(`  files: ${targets.map((f) => f.fileName).join(', ')}\n`)

  console.log(
    `  ${input.dryRun ? 'would write' : 'writing'} ${groups.length} post(s)${
      input.dryRun ? ' (dry run — no Strava, no database writes)' : ''
    }:`
  )
  groups.forEach((group, index) => {
    const names = group.targetFileNames.join(' + ')
    console.log(
      group.mergeStatusId
        ? `    post ${index + 1}: ${names} → MERGE into existing post ${group.mergeStatusId}`
        : `    post ${index + 1}: ${names} → NEW post`
    )
  })
  // Print on the real run too: these files were already parsed, so the script
  // knows they will fail. Staying quiet until the summary hides it.
  unparseable.forEach((file) => {
    console.log(`    ✗ ${file.fileName} → will FAIL, no post: ${file.error}`)
  })
  console.log('')

  if (input.dryRun) return 0

  // One bad file among several should not block recovering the rest — the job
  // marks it failed (with the reason) and imports the others. But when EVERY
  // target fails, the files are almost certainly fine and the environment is
  // not (wrong env => no storage config, see the banner above), so importing
  // would only mark them all failed for a problem that is not theirs.
  if (unparseable.length === targets.length) {
    console.error(
      `Refusing to import: all ${targets.length} file(s) failed to read/parse (see above).\n` +
        '  This usually means the wrong environment or storage config, not bad files.'
    )
    return 1
  }

  try {
    await importFitnessFilesJob(database, {
      id: getHashFromString(
        `recover-stored:${input.actorId}:${[...targetIds].sort().join(',')}`
      ),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: input.actorId,
        batchId,
        fitnessFileIds: targetIds,
        overlapFitnessFileIds,
        visibility: input.visibility
      }
    })
  } catch (error) {
    console.error(`  ✗ importFitnessFilesJob failed: ${toErrorMessage(error)}`)
    return 1
  }

  // Report the result grouped by the status each file now points to.
  const byStatus = new Map<string, { file: string; primary: boolean }[]>()
  const unlinked: { fileName: string; reason: string }[] = []
  for (const file of targets) {
    const refreshed = await database.getFitnessFile({ id: file.id })
    if (!refreshed?.statusId) {
      // The job records why it gave up in importError — surface it instead of
      // just counting the file, which leaves the operator with nowhere to go.
      unlinked.push({
        fileName: file.fileName,
        reason: refreshed?.importError ?? 'no reason recorded'
      })
      continue
    }
    const group = byStatus.get(refreshed.statusId) ?? []
    group.push({ file: file.fileName, primary: Boolean(refreshed.isPrimary) })
    byStatus.set(refreshed.statusId, group)
  }

  console.log(
    `Linked ${targets.length - unlinked.length} file(s) across ${byStatus.size} post(s):`
  )
  for (const [statusId, files] of byStatus) {
    console.log(`  ✓ ${statusId}`)
    for (const f of files) {
      console.log(
        `      - ${f.file}${f.primary ? ' (primary — carries the route map)' : ' (attached)'}`
      )
    }
  }
  for (const file of unlinked) {
    console.log(`  ✗ ${file.fileName} — not linked to a status: ${file.reason}`)
  }

  return unlinked.length > 0 ? 1 : 0
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
