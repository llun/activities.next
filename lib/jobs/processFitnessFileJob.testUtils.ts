import { expect, vi } from 'vitest'

import type { Database } from '@/lib/database/types'
import { generateRouteAltText } from '@/lib/services/altText/openai'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import {
  deleteMediaFile,
  saveMedia,
  saveMediaImageRendition
} from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Shared by the processFitnessFileJob suites. Each suite repeats the `vi.mock`
// calls (they are hoisted per test file), which also apply to this module.
export const mockGetFitnessFileBuffer =
  getFitnessFileBuffer as jest.MockedFunction<typeof getFitnessFileBuffer>
export const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
export const mockGenerateMapImage = generateMapImage as jest.MockedFunction<
  typeof generateMapImage
>
export const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
export const mockSaveMediaImageRendition =
  saveMediaImageRendition as jest.MockedFunction<typeof saveMediaImageRendition>
export const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

export const defaultActivityData: FitnessActivityData = {
  coordinates: [
    { lat: 37.78, lng: -122.42 },
    { lat: 37.79, lng: -122.41 }
  ],
  trackPoints: [
    { lat: 37.78, lng: -122.42 },
    { lat: 37.79, lng: -122.41 }
  ],
  totalDistanceMeters: 5_200,
  totalDurationSeconds: 1_695,
  elevationGainMeters: 130,
  activityType: 'running',
  startTime: new Date('2026-01-05T06:00:00.000Z'),
  avgPower: 210,
  maxPower: 450,
  avgHeartRate: 145,
  maxHeartRate: 172,
  totalWorkKj: 350,
  elevationSeries: [10, 20, 30]
}

export const createProcessFileHelpers = (
  database: Database,
  getActor: () => Actor
) => {
  const createStatusWithFitnessFile = async ({
    text,
    fileType = 'fit'
  }: {
    text: string
    fileType?: 'fit' | 'gpx' | 'tcx'
  }) => {
    const postId = `process-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const statusId = `${getActor().id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${getActor().domain}/${getActor().username}/${postId}`,
      actorId: getActor().id,
      text,
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${getActor().id}/followers`],
      reply: ''
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: getActor().id,
      statusId,
      path: `fitness/${postId}.${fileType}`,
      fileName: `workout.${fileType}`,
      fileType,
      mimeType:
        fileType === 'fit'
          ? 'application/vnd.ant.fit'
          : fileType === 'gpx'
            ? 'application/gpx+xml'
            : 'application/vnd.garmin.tcx+xml',
      bytes: 4_096
    })

    expect(fitnessFile).toBeDefined()

    return { statusId, fitnessFileId: fitnessFile!.id }
  }

  // Every test in this file shares one actor, and there can be only one
  // `general` fitness settings row per actor — `createFitnessSettings` throws on
  // the second. Tests that need a privacy zone therefore upsert, and restore the
  // row in a `finally`: a radius left behind sits on the default route's first
  // point and trims it to a single visible point, which skips the map block
  // entirely and makes any later test's map assertions pass vacuously.
  const setPrivacyZone = async (
    zone: {
      privacyHomeLatitude?: number | null
      privacyHomeLongitude?: number | null
      privacyHideRadiusMeters?: number | null
      generateRouteDescription?: boolean
    },
    settingsId?: string
  ): Promise<string> => {
    const id =
      settingsId ??
      (
        await database.getFitnessSettings({
          actorId: getActor().id,
          serviceType: 'general'
        })
      )?.id

    if (id) {
      await database.updateFitnessSettings({ id, ...zone })
      return id
    }

    const created = await database.createFitnessSettings({
      actorId: getActor().id,
      serviceType: 'general',
      privacyHomeLatitude: zone.privacyHomeLatitude ?? undefined,
      privacyHomeLongitude: zone.privacyHomeLongitude ?? undefined,
      privacyHideRadiusMeters: zone.privacyHideRadiusMeters ?? undefined,
      generateRouteDescription: zone.generateRouteDescription ?? false
    })
    return created.id
  }

  const clearPrivacyZone = (settingsId: string) =>
    setPrivacyZone(
      {
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: null
      },
      settingsId
    )

  return { createStatusWithFitnessFile, setPrivacyZone, clearPrivacyZone }
}

// Resets every mock to the baseline each suite starts a test from.
export const resetProcessMocks = () => {
  vi.clearAllMocks()
  vi.mocked(generateRouteAltText).mockReset()

  // clearAllMocks resets call history but KEEPS implementations, and
  // publishSendNote defaults to true — so a test that makes this throw would
  // otherwise leave every later test quietly running its federation publish
  // down the failure path.
  ;(getQueue().publish as jest.Mock).mockImplementation(async () => undefined)

  mockGetFitnessFileBuffer.mockResolvedValue(Buffer.from('fitness-file-bytes'))

  mockParseFitnessFile.mockResolvedValue(defaultActivityData)
  mockGenerateMapImage.mockResolvedValue(Buffer.from('png-map-image'))

  mockSaveMedia.mockResolvedValue({
    id: 'generated-map-media-id',
    type: 'image',
    mime_type: 'image/webp',
    url: 'https://llun.test/api/v1/files/medias/route-map.webp',
    preview_url: null,
    text_url: null,
    remote_url: null,
    meta: {
      original: {
        width: 800,
        height: 600,
        size: '800x600',
        aspect: 1.3333333333
      }
    },
    description: 'Route map',
    blurhash: null
  })

  mockDeleteMediaFile.mockResolvedValue(true)

  mockSaveMediaImageRendition.mockResolvedValue({
    path: 'medias/route-map.jpg',
    url: 'https://llun.test/api/v1/files/medias/route-map.jpg',
    bytes: 51_895,
    mimeType: 'image/jpeg',
    metaData: { width: 800, height: 600 }
  })
}
