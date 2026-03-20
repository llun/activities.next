#!/usr/bin/env -S node -r @swc-node/register
/**
 * Script to fix fitness files stuck in 'processing' status, typically caused
 * by the Cloud Run instance being killed (e.g. OOM) mid-job before the final
 * status update could be written.
 *
 * Resolution logic per stuck file:
 *   - Activity data already parsed (totalDistanceMeters is set)
 *     → mark 'completed' (data is usable; map can be retried via Settings)
 *   - Activity data not yet parsed
 *     → mark 'pending' so the job will be re-queued on the next page load
 *
 * Usage (fix one status by URL hash):
 *   NODE_ENV=production scripts/fixStuckFitnessProcessing.ts \
 *     --status-hash <64-char-hex>
 *
 * Usage (fix all stuck files for an actor):
 *   NODE_ENV=production scripts/fixStuckFitnessProcessing.ts \
 *     --actor-id <actor-id>
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.union([
  z.object({ mode: z.literal('hash'), statusHash: z.string().length(64) }),
  z.object({ mode: z.literal('actor'), actorId: z.string().min(1) })
])

const USAGE = `Usage:
  Fix one status:
    NODE_ENV=production scripts/fixStuckFitnessProcessing.ts --status-hash <64-char-hex>

  Fix all stuck files for an actor:
    NODE_ENV=production scripts/fixStuckFitnessProcessing.ts --actor-id <actor-id>`

const parseArgs = (args: string[]) => {
  const parsed: Record<string, string> = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const nextValue = inlineValue ?? args[i + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }

    if (inlineValue === undefined) {
      i += 1
    }

    parsed[rawKey] = nextValue
  }

  if (parsed['status-hash']) {
    return CliArgs.parse({ mode: 'hash', statusHash: parsed['status-hash'] })
  }

  if (parsed['actor-id']) {
    return CliArgs.parse({ mode: 'actor', actorId: parsed['actor-id'] })
  }

  throw new Error('Provide either --status-hash or --actor-id')
}

const resolveTargetStatus = (file: FitnessFile): 'completed' | 'pending' =>
  typeof file.totalDistanceMeters === 'number' ? 'completed' : 'pending'

async function fixFile(
  database: Awaited<ReturnType<typeof getDatabase>>,
  file: FitnessFile
): Promise<'completed' | 'pending' | 'skipped' | 'error'> {
  if (!database) return 'error'

  if (file.processingStatus !== 'processing') {
    console.log(
      `  [${file.id}] ${file.fileName} — not stuck (${file.processingStatus}), skipping`
    )
    return 'skipped'
  }

  const target = resolveTargetStatus(file)

  try {
    await database.updateFitnessFileProcessingStatus(file.id, target)
    console.log(
      `  [${file.id}] ${file.fileName} → ${target}` +
        (file.activityType ? ` (${file.activityType})` : '')
    )
    return target
  } catch (error) {
    const nodeError = error as Error
    console.error(
      `  [${file.id}] ${file.fileName} — failed: ${nodeError.message}`
    )
    return 'error'
  }
}

async function fixStuckFitnessProcessing(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    const nodeError = error as Error
    console.error(nodeError.message)
    console.error(USAGE)
    return 1
  }

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  let filesToFix: FitnessFile[] = []

  if (input.mode === 'hash') {
    const status = await database.getStatusFromUrlHash({
      urlHash: input.statusHash
    })
    if (!status) {
      console.error(`No status found for hash: ${input.statusHash}`)
      return 1
    }

    const fitnessFile = await database.getFitnessFileByStatus({
      statusId: status.id
    })
    if (!fitnessFile) {
      console.error(`No fitness file linked to status: ${status.id}`)
      return 1
    }

    filesToFix = [fitnessFile]
  } else {
    const PAGE_SIZE = 200
    let offset = 0

    while (true) {
      const page = await database.getFitnessFilesByActor({
        actorId: input.actorId,
        limit: PAGE_SIZE,
        offset
      })

      filesToFix.push(
        ...page.filter((f) => f.processingStatus === 'processing')
      )

      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (filesToFix.length === 0) {
      console.log('No fitness files stuck in processing for this actor')
      return 0
    }

    console.log(
      `Found ${filesToFix.length} stuck file(s) for actor ${input.actorId}`
    )
  }

  const counts = { completed: 0, pending: 0, skipped: 0, error: 0 }

  for (const file of filesToFix) {
    const result = await fixFile(database, file)
    counts[result] += 1
  }

  console.log(
    `\nDone: ${counts.completed} → completed, ${counts.pending} → pending, ` +
      `${counts.skipped} skipped, ${counts.error} errors`
  )

  if (counts.completed > 0) {
    console.log(
      '\nFiles marked completed have activity data but no map image.\n' +
        'Use Settings → Fitness → Regenerate Maps to generate maps (after fixing the OOM issue).'
    )
  }

  if (counts.pending > 0) {
    console.log(
      '\nFiles reset to pending will be re-queued automatically on the next page load.'
    )
  }

  return counts.error > 0 ? 1 : 0
}

if (require.main === module) {
  fixStuckFitnessProcessing()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
