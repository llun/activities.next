import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

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
  const emoji = activityType === 'Run' ? '🏃' : 
                activityType === 'Ride' ? '🚴' :
                activityType === 'Swim' ? '🏊' :
                activityType === 'Walk' ? '🚶' :
                activityType === 'Hike' ? '🥾' : '📊'

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
 * Saves raw activity data as a JSON file in media storage and creates a fitness icon
 * Returns the media ID that can be stored in the fitness_activities table
 */
export async function saveFitnessActivityData(
  database: Database,
  actor: Actor,
  activityData: unknown,
  activityType: string
): Promise<string | null> {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    console.error('Media storage not configured')
    return null
  }

  try {
    // Generate fitness icon as thumbnail
    const iconBuffer = await generateFitnessIcon(activityType)

    // Serialize activity data to JSON
    const jsonData = JSON.stringify(activityData, null, 2)
    const jsonBuffer = Buffer.from(jsonData, 'utf-8')

    // Generate unique filename
    const timestamp = Date.now()
    const hash = crypto.createHash('md5').update(jsonData).digest('hex').substring(0, 8)
    const filename = `fitness-${actor.id.split('/').pop()}-${timestamp}-${hash}.json`

    // Save JSON file to media storage
    const basePath = mediaStorage.type === MediaStorageType.LocalFile
      ? mediaStorage.path
      : 'fitness-data'

    const jsonPath = path.join(basePath, actor.id.split('/').pop() || 'unknown', filename)
    const iconPath = path.join(basePath, actor.id.split('/').pop() || 'unknown', `${filename}.png`)

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      // Ensure directory exists
      const dir = path.dirname(path.resolve(mediaStorage.path, jsonPath))
      await fs.mkdir(dir, { recursive: true })

      // Write JSON file
      await fs.writeFile(path.resolve(mediaStorage.path, jsonPath), jsonBuffer)
      
      // Write icon file
      await fs.writeFile(path.resolve(mediaStorage.path, iconPath), iconBuffer)
    }

    // Create media entry in database with the icon as the visual representation
    const media = await database.createMedia({
      actorId: actor.id,
      original: {
        path: iconPath,
        bytes: iconBuffer.length,
        mimeType: 'image/png',
        metaData: {
          width: 400,
          height: 400
        },
        fileName: `${filename}.png`
      },
      description: `Fitness activity data: ${activityType}`
    })

    return media?.id || null
  } catch (error) {
    console.error('Failed to save fitness activity data:', error)
    return null
  }
}

/**
 * Retrieves raw activity data from media storage by media ID
 */
export async function getFitnessActivityData(
  mediaId: string,
  actorId: string
): Promise<unknown | null> {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    console.error('Media storage not configured')
    return null
  }

  try {
    // Get the media entry to find the JSON file path
    const database = require('@/lib/database').getDatabase()
    if (!database) return null

    const media = await database.getMediaByIdForAccount({
      mediaId,
      accountId: actorId
    })

    if (!media) {
      return null
    }

    // Derive JSON file path from icon path
    const iconPath = media.original.path
    const jsonPath = iconPath.replace('.png', '')

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      const fullPath = path.resolve(mediaStorage.path, jsonPath)
      const jsonData = await fs.readFile(fullPath, 'utf-8')
      return JSON.parse(jsonData)
    }

    return null
  } catch (error) {
    console.error('Failed to retrieve fitness activity data:', error)
    return null
  }
}
