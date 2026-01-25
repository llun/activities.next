import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import { format } from 'date-fns'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { logger } from '@/lib/utils/logger'

/**
 * Maps activity types to their corresponding emoji
 * @param activityType - The type of fitness activity (e.g., 'Run', 'Ride', 'Swim')
 * @returns The emoji representing the activity type
 */
export function getActivityEmoji(activityType: string): string {
  switch (activityType) {
    case 'Run':
      return '🏃'
    case 'Ride':
      return '🚴'
    case 'Swim':
      return '🏊'
    case 'Walk':
      return '🚶'
    case 'Hike':
      return '🥾'
    default:
      return '📊'
  }
}

/**
 * Generates a fitness activity icon as a PNG image
 * This creates a simple colored icon to represent fitness data files
 */
async function generateFitnessIcon(activityType: string): Promise<Buffer> {
  // Choose color based on activity type
  const colorMap: Record<string, { bg: string; text: string }> = {
    Run: { bg: '#FF6B6B', text: '#FFFFFF' },
    Ride: { bg: '#4ECDC4', text: '#FFFFFF' },
    Swim: { bg: '#45B7D1', text: '#FFFFFF' },
    Walk: { bg: '#96CEB4', text: '#FFFFFF' },
    Hike: { bg: '#FFEAA7', text: '#2D3436' },
    default: { bg: '#A8E6CF', text: '#2D3436' }
  }

  const colors = colorMap[activityType] || colorMap.default

  // Create a 400x400 icon with activity emoji and type
  const emoji = getActivityEmoji(activityType)

  // Create SVG with activity icon
  const svg = `
    <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="${colors.bg}"/>
      <text x="200" y="160" font-size="120" text-anchor="middle" fill="${colors.text}">${emoji}</text>
      <text x="200" y="260" font-size="32" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="${colors.text}">${activityType || 'Activity'}</text>
      <text x="200" y="300" font-size="20" font-family="Arial, sans-serif" text-anchor="middle" fill="${colors.text}" opacity="0.8">Fitness Data</text>
    </svg>
  `

  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Saves raw activity data as a JSON file in fitness storage and creates a fitness icon
 * Returns the fitness file ID that can be stored in the fitness_files table
 *
 * Note: This does NOT count towards media quota - fitness files have separate tracking
 */
export async function saveFitnessActivityData(
  database: Database,
  actor: Actor,
  activityData: unknown,
  activityType: string,
  statusId: string | null,
  provider: string,
  providerId: string
): Promise<string | null> {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    logger.error({ message: 'Media storage not configured' })
    return null
  }

  try {
    // Generate fitness icon as thumbnail
    const iconBuffer = await generateFitnessIcon(activityType)

    // Serialize activity data to JSON
    const jsonData = JSON.stringify(activityData, null, 2)
    const jsonBuffer = Buffer.from(jsonData, 'utf-8')

    // Generate unique filenames
    const timestamp = Date.now()
    const hash = crypto
      .createHash('md5')
      .update(jsonData)
      .digest('hex')
      .substring(0, 8)
    const actorSlug = actor.id.split('/').pop() || 'unknown'
    const timeDirectory = format(timestamp, 'yyyy-MM-dd')

    const jsonFilename = `fitness-${actorSlug}-${timestamp}-${hash}.json`
    const iconFilename = `fitness-${actorSlug}-${timestamp}-${hash}.png`

    let jsonPath: string
    let iconPath: string
    let fileBytes: number
    let iconBytes: number

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      // Local file storage
      const basePath = mediaStorage.path
      const actorDir = path.join(basePath, 'fitness', actorSlug, timeDirectory)

      // Ensure directory exists
      await fs.mkdir(actorDir, { recursive: true })

      // Write JSON file
      const jsonFullPath = path.join(actorDir, jsonFilename)
      await fs.writeFile(jsonFullPath, jsonBuffer)

      // Write icon file
      const iconFullPath = path.join(actorDir, iconFilename)
      await fs.writeFile(iconFullPath, iconBuffer)

      // Paths relative to storage base
      jsonPath = path.join('fitness', actorSlug, timeDirectory, jsonFilename)
      iconPath = path.join('fitness', actorSlug, timeDirectory, iconFilename)
      fileBytes = jsonBuffer.length
      iconBytes = iconBuffer.length

      logger.info({
        message: 'Saved fitness activity data to local storage',
        actorId: actor.id,
        jsonPath,
        iconPath,
        fileBytes,
        iconBytes
      })
    } else if (
      mediaStorage.type === MediaStorageType.S3Storage ||
      mediaStorage.type === MediaStorageType.ObjectStorage
    ) {
      // S3/Object storage
      const { bucket, region } = mediaStorage
      const s3client = new S3Client({ region })

      // S3 paths
      jsonPath = `fitness/${actorSlug}/${timeDirectory}/${jsonFilename}`
      iconPath = `fitness/${actorSlug}/${timeDirectory}/${iconFilename}`

      // Upload JSON file
      const jsonCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: jsonPath,
        ContentType: 'application/json',
        Body: jsonBuffer
      })
      await s3client.send(jsonCommand)

      // Upload icon file
      const iconCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: iconPath,
        ContentType: 'image/png',
        Body: iconBuffer
      })
      await s3client.send(iconCommand)

      fileBytes = jsonBuffer.length
      iconBytes = iconBuffer.length

      logger.info({
        message: 'Saved fitness activity data to S3 storage',
        actorId: actor.id,
        bucket,
        jsonPath,
        iconPath,
        fileBytes,
        iconBytes
      })
    } else {
      logger.error({
        message: 'Unsupported storage type',
        storageType: mediaStorage.type
      })
      return null
    }

    // Create fitness file record in database
    const fitnessFileId = crypto.randomUUID()
    await database.createFitnessFile({
      id: fitnessFileId,
      actorId: actor.id,
      statusId: statusId || undefined,
      provider,
      providerId,
      activityType,
      filePath: jsonPath,
      iconPath,
      fileBytes,
      iconBytes
    })

    return fitnessFileId
  } catch (error) {
    logger.error({
      err: error,
      message: 'Failed to save fitness activity data',
      actorId: actor.id,
      activityType
    })
    return null
  }
}

/**
 * Retrieves raw activity data from fitness storage by fitness file ID
 */
export async function getFitnessActivityData(
  database: Database,
  fitnessFileId: string,
  actorId: string
): Promise<unknown | null> {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    logger.error({ message: 'Media storage not configured' })
    return null
  }

  try {
    // Get the fitness file entry directly by ID
    const fitnessFile = await database.getFitnessFileById({
      id: fitnessFileId,
      actorId
    })

    if (!fitnessFile) {
      logger.error({
        message: 'Fitness file not found',
        fitnessFileId,
        actorId
      })
      return null
    }

    const jsonPath = fitnessFile.filePath

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      // Local file storage
      const fullPath = path.resolve(mediaStorage.path, jsonPath)
      const jsonData = await fs.readFile(fullPath, 'utf-8')
      return JSON.parse(jsonData)
    } else if (
      mediaStorage.type === MediaStorageType.S3Storage ||
      mediaStorage.type === MediaStorageType.ObjectStorage
    ) {
      // S3/Object storage - would need to implement S3 retrieval
      // For now, return null as this is typically not needed
      logger.info({
        message: 'S3 fitness data retrieval not yet implemented',
        fitnessFileId
      })
      return null
    }

    return null
  } catch (error) {
    logger.error({
      err: error,
      message: 'Failed to retrieve fitness activity data',
      fitnessFileId,
      actorId
    })
    return null
  }
}

/**
 * Deletes a fitness file and its associated icon from storage
 * Also deletes the associated status (which cascades to delete attachments and fitness_activities via FK constraints)
 *
 * Cascade deletion flow:
 * 1. Delete JSON + icon files from storage (LocalFile or S3)
 * 2. Delete the associated status (if any) - this cascades to:
 *    - fitness_files record (via ON DELETE CASCADE on statusId FK)
 *    - attachments (via ON DELETE CASCADE on statusId FK)
 *    - fitness_activities record (via ON DELETE CASCADE on statusId FK)
 * 3. If no status, delete the fitness_files record directly
 */
export async function deleteFitnessFile(
  database: Database,
  fitnessFileId: string,
  actorId: string
): Promise<boolean> {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    logger.error({ message: 'Media storage not configured' })
    return false
  }

  try {
    // Get the fitness file record directly by ID
    const fitnessFile = await database.getFitnessFileById({
      id: fitnessFileId,
      actorId
    })

    if (!fitnessFile) {
      logger.error({
        message: 'Fitness file not found',
        fitnessFileId,
        actorId
      })
      return false
    }

    // Delete from storage
    if (mediaStorage.type === MediaStorageType.LocalFile) {
      // Local file storage
      const jsonFullPath = path.resolve(mediaStorage.path, fitnessFile.filePath)
      const iconFullPath = path.resolve(mediaStorage.path, fitnessFile.iconPath)

      await Promise.all([
        fs.unlink(jsonFullPath).catch(() => {}), // Ignore if file doesn't exist
        fs.unlink(iconFullPath).catch(() => {})
      ])

      logger.info({
        message: 'Deleted fitness files from local storage',
        actorId,
        fitnessFileId
      })
    } else if (
      mediaStorage.type === MediaStorageType.S3Storage ||
      mediaStorage.type === MediaStorageType.ObjectStorage
    ) {
      // S3/Object storage
      const { bucket, region } = mediaStorage
      const s3client = new S3Client({ region })

      const jsonCommand = new DeleteObjectCommand({
        Bucket: bucket,
        Key: fitnessFile.filePath
      })
      const iconCommand = new DeleteObjectCommand({
        Bucket: bucket,
        Key: fitnessFile.iconPath
      })

      await Promise.all([
        s3client.send(jsonCommand).catch(() => {}), // Ignore if file doesn't exist
        s3client.send(iconCommand).catch(() => {})
      ])

      logger.info({
        message: 'Deleted fitness files from S3 storage',
        actorId,
        fitnessFileId,
        bucket
      })
    }

    // If there's an associated status, delete it - this will cascade to delete:
    // - The fitness_files record (via ON DELETE CASCADE on statusId FK)
    // - All attachments linked to the status
    // - The fitness_activities record (via ON DELETE CASCADE on statusId FK)
    if (fitnessFile.statusId) {
      await database.deleteStatus({
        statusId: fitnessFile.statusId
      })

      logger.info({
        message: 'Deleted status with cascade to fitness file and attachments',
        statusId: fitnessFile.statusId,
        fitnessFileId,
        actorId
      })
    } else {
      // No status, just delete the fitness file record directly
      await database.deleteFitnessFile({
        id: fitnessFileId,
        actorId
      })

      logger.info({
        message: 'Deleted fitness file record (no status to cascade)',
        fitnessFileId,
        actorId
      })
    }

    return true
  } catch (error) {
    logger.error({
      err: error,
      message: 'Failed to delete fitness file',
      fitnessFileId,
      actorId
    })
    return false
  }
}
