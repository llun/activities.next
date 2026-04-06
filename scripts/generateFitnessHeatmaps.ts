#!/usr/bin/env -S node -r @swc-node/register
/**
 * Manually generate fitness heatmaps from existing data.
 *
 * Usage:
 *   NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <actor-id>
 *   NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <id> --activity-type running
 *   NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <id> --period-type yearly --period-key 2024
 *
 * If only --actor-id is provided, generates ALL heatmap variants:
 *   - For each distinct activity type (plus null for "all"):
 *     - All-time, yearly per year, monthly per month
 *
 * If specific options are provided, generates only those variants.
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateHeatmapImage } from '@/lib/services/fitness-files/generateHeatmapImage'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import type { FitnessCoordinate } from '@/lib/services/fitness-files/parseFitnessFile'
import { saveMedia } from '@/lib/services/medias'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FitnessHeatmapPeriodType } from '@/lib/types/database/fitnessHeatmap'
import { Actor } from '@/lib/types/domain/actor'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  activityType: z.string().optional(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']).optional(),
  periodKey: z.string().optional()
})

const USAGE = `Usage:
  Generate all heatmaps for an actor:
    NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <actor-id>

  Generate for a specific activity type:
    NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <id> --activity-type running

  Generate a specific period:
    NODE_ENV=production scripts/generateFitnessHeatmaps.ts --actor-id <id> --period-type yearly --period-key 2024`

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

  if (!parsed['actor-id']) {
    throw new Error('--actor-id is required')
  }

  return CliArgs.parse({
    actorId: parsed['actor-id'],
    activityType: parsed['activity-type'],
    periodType: parsed['period-type'],
    periodKey: parsed['period-key']
  })
}

const getPeriodRange = (
  periodType: string,
  periodKey: string
): { periodStart: Date; periodEnd: Date } => {
  switch (periodType) {
    case 'yearly': {
      const year = parseInt(periodKey, 10)
      return {
        periodStart: new Date(Date.UTC(year, 0, 1)),
        periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
      }
    }
    case 'monthly': {
      const [year, month] = periodKey.split('-').map(Number)
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const nextMonth = new Date(Date.UTC(year, month, 1))
      const periodEnd = new Date(nextMonth.getTime() - 1)
      return { periodStart, periodEnd }
    }
    default: {
      return {
        periodStart: new Date(Date.UTC(1970, 0, 1)),
        periodEnd: new Date(Date.UTC(2100, 11, 31, 23, 59, 59, 999))
      }
    }
  }
}

const getFitnessFileBuffer = async (
  database: Database,
  fitnessFileId: string
): Promise<Buffer> => {
  const data = await getFitnessFile(database, fitnessFileId)
  if (!data) {
    throw new Error('Fitness file not found in storage')
  }

  if (data.type === 'buffer') {
    return data.buffer
  }

  const response = await fetch(data.redirectUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status})`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const getCompletedPrimaryFiles = async (
  database: Database,
  actorId: string
): Promise<FitnessFile[]> => {
  const allFiles: FitnessFile[] = []
  const PAGE_SIZE = 200
  let offset = 0

  while (true) {
    const page = await database.getFitnessFilesByActor({
      actorId,
      limit: PAGE_SIZE,
      offset
    })

    allFiles.push(
      ...page.filter(
        (f) => f.processingStatus === 'completed' && f.isPrimary && !f.deletedAt
      )
    )

    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allFiles
}

const filterFilesByPeriodAndType = (
  files: FitnessFile[],
  periodType: FitnessHeatmapPeriodType,
  periodKey: string,
  activityType: string | null
): FitnessFile[] => {
  const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

  return files.filter((file) => {
    if (file.activityStartTime) {
      const startTime = file.activityStartTime
      if (
        startTime < periodStart.getTime() ||
        startTime > periodEnd.getTime()
      ) {
        return false
      }
    }

    if (activityType !== null && file.activityType !== activityType) {
      return false
    }

    return true
  })
}

interface HeatmapVariant {
  activityType: string | null
  periodType: FitnessHeatmapPeriodType
  periodKey: string
}

const collectVariants = (
  files: FitnessFile[],
  activityTypes: (string | null)[],
  specificPeriodType?: FitnessHeatmapPeriodType,
  specificPeriodKey?: string
): HeatmapVariant[] => {
  const variants: HeatmapVariant[] = []

  for (const activityType of activityTypes) {
    const relevantFiles = files.filter(
      (f) => activityType === null || f.activityType === activityType
    )

    if (relevantFiles.length === 0) continue

    if (specificPeriodType && specificPeriodKey) {
      variants.push({
        activityType,
        periodType: specificPeriodType,
        periodKey: specificPeriodKey
      })
      continue
    }

    // All-time
    variants.push({
      activityType,
      periodType: 'all_time',
      periodKey: 'all'
    })

    // Determine year/month range from activityStartTime
    const years = new Set<number>()
    const months = new Set<string>()

    for (const file of relevantFiles) {
      if (!file.activityStartTime) continue
      const date = new Date(file.activityStartTime)
      const year = date.getUTCFullYear()
      years.add(year)
      months.add(`${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
    }

    for (const year of Array.from(years).sort()) {
      variants.push({
        activityType,
        periodType: 'yearly',
        periodKey: String(year)
      })
    }

    for (const month of Array.from(months).sort()) {
      variants.push({
        activityType,
        periodType: 'monthly',
        periodKey: month
      })
    }
  }

  return variants
}

const generateSingleHeatmap = async (
  database: Database,
  actor: Actor,
  allFiles: FitnessFile[],
  variant: HeatmapVariant
): Promise<'completed' | 'empty' | 'failed'> => {
  const { activityType, periodType, periodKey } = variant
  const label = `${activityType ?? 'all'} / ${periodType} / ${periodKey}`

  let heatmapId: string | undefined

  try {
    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    const existing = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType,
      periodType,
      periodKey
    })

    if (existing) {
      heatmapId = existing.id
      await database.updateFitnessHeatmapStatus({
        id: existing.id,
        status: 'generating'
      })
    } else {
      const created = await database.createFitnessHeatmap({
        actorId: actor.id,
        activityType,
        periodType,
        periodKey,
        periodStart,
        periodEnd
      })
      heatmapId = created.id
      await database.updateFitnessHeatmapStatus({
        id: created.id,
        status: 'generating'
      })
    }

    const matchingFiles = filterFilesByPeriodAndType(
      allFiles,
      periodType,
      periodKey,
      activityType
    )

    const allRouteSegments: FitnessCoordinate[][] = []

    for (const file of matchingFiles) {
      try {
        if (!isParseableFitnessFileType(file.fileType)) continue

        const buffer = await getFitnessFileBuffer(database, file.id)
        const activityData = await parseFitnessFile({
          fileType: file.fileType,
          buffer
        })

        if (activityData.coordinates.length >= 2) {
          allRouteSegments.push(activityData.coordinates)
        }
      } catch (error) {
        const nodeError = error as Error
        console.error(
          `  Warning: failed to parse file ${file.id} (${file.fileName}): ${nodeError.message}`
        )
      }
    }

    if (allRouteSegments.length === 0) {
      await database.updateFitnessHeatmapStatus({
        id: heatmapId,
        status: 'completed',
        activityCount: 0,
        imagePath: null
      })
      console.log(`  [${label}] No route data — marked completed (0 files)`)
      return 'empty'
    }

    const imageBuffer = await generateHeatmapImage({
      routeSegments: allRouteSegments
    })

    if (!imageBuffer) {
      await database.updateFitnessHeatmapStatus({
        id: heatmapId,
        status: 'completed',
        activityCount: matchingFiles.length,
        imagePath: null
      })
      console.log(
        `  [${label}] Image generation returned null — marked completed (${matchingFiles.length} files)`
      )
      return 'empty'
    }

    const imageBytes = new Uint8Array(imageBuffer)
    const activityTypePath = activityType ?? 'all'
    const fileName = `heatmap-${activityTypePath}-${periodType}_${periodKey}.png`

    const storedMedia = await saveMedia(database, actor, {
      file: new File([imageBytes], fileName, { type: 'image/png' }),
      description: `Fitness heatmap: ${activityTypePath} ${periodType} ${periodKey}`
    })

    if (!storedMedia) {
      throw new Error('Failed to save heatmap image to media storage')
    }

    const imagePath = getAttachmentMediaPath(storedMedia.url)

    await database.updateFitnessHeatmapStatus({
      id: heatmapId,
      status: 'completed',
      imagePath,
      activityCount: matchingFiles.length
    })

    console.log(
      `  [${label}] ✓ Generated (${matchingFiles.length} files, ${allRouteSegments.length} routes)`
    )
    return 'completed'
  } catch (error) {
    const nodeError = error as Error
    console.error(`  [${label}] ✗ Failed: ${nodeError.message}`)

    if (heatmapId) {
      await database.updateFitnessHeatmapStatus({
        id: heatmapId,
        status: 'failed',
        error: nodeError.message
      })
    }
    return 'failed'
  }
}

export async function generateFitnessHeatmaps(args = process.argv.slice(2)) {
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

  const actor = await database.getActorFromId({ id: input.actorId })
  if (!actor) {
    console.error(`Error: Actor not found: ${input.actorId}`)
    return 1
  }

  console.log(`Loading fitness files for actor ${input.actorId}...`)
  const allFiles = await getCompletedPrimaryFiles(database, input.actorId)
  console.log(`Found ${allFiles.length} completed primary fitness files`)

  if (allFiles.length === 0) {
    console.log('No files to process')
    return 0
  }

  // Determine which activity types to process
  let activityTypes: (string | null)[]
  if (input.activityType !== undefined) {
    activityTypes = [input.activityType]
  } else {
    const distinctTypes = await database.getDistinctActivityTypesForActor({
      actorId: input.actorId
    })
    activityTypes = [null, ...distinctTypes]
    console.log(
      `Activity types: all (null), ${distinctTypes.join(', ') || '(none)'}`
    )
  }

  const specificPeriodType = input.periodType as
    | FitnessHeatmapPeriodType
    | undefined
  const variants = collectVariants(
    allFiles,
    activityTypes,
    specificPeriodType,
    input.periodKey
  )

  console.log(`\nGenerating ${variants.length} heatmap(s)...\n`)

  const counts = { completed: 0, empty: 0, failed: 0 }

  for (const variant of variants) {
    const result = await generateSingleHeatmap(
      database,
      actor,
      allFiles,
      variant
    )
    counts[result] += 1
  }

  console.log(
    `\nDone: ${counts.completed} generated, ${counts.empty} empty/no-data, ${counts.failed} failed`
  )

  return counts.failed > 0 ? 1 : 0
}

if (require.main === module) {
  generateFitnessHeatmaps()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
