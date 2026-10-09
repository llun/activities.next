import { lookup } from 'node:dns/promises'
import { vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias/index'
import { getQueue } from '@/lib/services/queue'
import {
  buildGpxFromStravaStreams,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityPhotos,
  getStravaActivityStreams,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Visibility } from '@/lib/types/mastodon/visibility'

// Shared by the importStravaActivityJob suites. Each suite repeats the `vi.mock`
// calls (they are hoisted per test file), which also apply to this module.
export const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
export const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
export const mockImportFitnessFiles = importFitnessFiles as jest.MockedFunction<
  typeof importFitnessFiles
>
export const mockGetStravaActivity = getStravaActivity as jest.MockedFunction<
  typeof getStravaActivity
>
export const mockGetStravaActivityPhotos =
  getStravaActivityPhotos as jest.MockedFunction<typeof getStravaActivityPhotos>
export const mockGetStravaActivityStreams =
  getStravaActivityStreams as jest.MockedFunction<
    typeof getStravaActivityStreams
  >
export const mockBuildGpxFromStravaStreams =
  buildGpxFromStravaStreams as jest.MockedFunction<
    typeof buildGpxFromStravaStreams
  >
export const mockBuildTcxFromStravaStreams =
  buildTcxFromStravaStreams as jest.MockedFunction<
    typeof buildTcxFromStravaStreams
  >
export const mockGetValidStravaAccessToken =
  getValidStravaAccessToken as jest.MockedFunction<
    typeof getValidStravaAccessToken
  >
export const mockGetQueue = getQueue as jest.MockedFunction<typeof getQueue>
export const mockAddStatusToTimelines =
  addStatusToTimelines as jest.MockedFunction<typeof addStatusToTimelines>
export const mockLookup = lookup as jest.MockedFunction<typeof lookup>

type MockDatabase = Pick<
  Database,
  | 'getActorFromId'
  | 'getFitnessSettings'
  | 'getFitnessFilesByBatchId'
  | 'getFitnessFile'
  | 'getFitnessFilesByActor'
  | 'updateFitnessFileActivityData'
  | 'getStatus'
  | 'updateNote'
  | 'getAttachments'
  | 'createAttachment'
  | 'updateFitnessSettings'
  | 'createNote'
  | 'createNotification'
  | 'getActorMutedConversationRootIds'
  | 'acquireImportLock'
  | 'releaseImportLock'
  | 'createFitnessGear'
  | 'assignFitnessFileGearIfUnset'
  | 'findFitnessGearByDeviceKey'
  | 'updateFitnessFileImportStatus'
  | 'updateFitnessFileProcessingStatus'
>

export const createMockStravaDatabase = (): jest.Mocked<MockDatabase> => ({
  getActorFromId: vi.fn(),
  getFitnessSettings: vi.fn(),
  getFitnessFilesByBatchId: vi.fn(),
  getFitnessFile: vi.fn(),
  getFitnessFilesByActor: vi.fn(),
  updateFitnessFileActivityData: vi.fn(),
  getStatus: vi.fn(),
  updateNote: vi.fn(),
  getAttachments: vi.fn(),
  createAttachment: vi.fn(),
  updateFitnessSettings: vi.fn(),
  createNote: vi.fn(),
  createNotification: vi.fn(),
  // createNotificationWithPolicy checks the recipient's conversation-mute
  // list before persisting; the importer's recipients have none.
  getActorMutedConversationRootIds: vi.fn().mockResolvedValue([]),
  // The per-actor import lock serializes concurrent same-ride imports; in
  // tests it is always immediately granted so the critical section runs.
  acquireImportLock: vi.fn().mockResolvedValue({ token: 'lock-token' }),
  releaseImportLock: vi.fn().mockResolvedValue(true),
  createFitnessGear: vi.fn(),
  assignFitnessFileGearIfUnset: vi.fn(),
  findFitnessGearByDeviceKey: vi.fn(),
  updateFitnessFileImportStatus: vi.fn(),
  updateFitnessFileProcessingStatus: vi.fn()
})

export const resetStravaImportMocks = (database: jest.Mocked<MockDatabase>) => {
  vi.clearAllMocks()

  database.getActorFromId.mockResolvedValue({
    id: 'actor-1',
    username: 'testuser',
    domain: 'llun.test',
    followersUrl: 'https://llun.test/@testuser/followers'
  } as never)
  database.getFitnessSettings.mockResolvedValue({
    id: 'fitness-settings-1',
    actorId: 'actor-1',
    serviceType: 'strava',
    accessToken: 'access-token',
    defaultVisibility: Visibility.enum.public,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  database.getFitnessFilesByBatchId.mockReset().mockResolvedValue([])
  database.getFitnessFilesByActor.mockResolvedValue([
    {
      id: 'overlap-file',
      actorId: 'actor-1',
      statusId: 'status-overlap',
      activityStartTime: new Date('2026-01-01T00:10:00.000Z').getTime(),
      totalDurationSeconds: 1_200
    }
  ] as never)
  database.getFitnessFile.mockReset()
  database.getFitnessFile
    .mockResolvedValueOnce({
      id: 'new-file',
      actorId: 'actor-1',
      statusId: undefined
    } as never)
    .mockResolvedValueOnce({
      id: 'new-file',
      actorId: 'actor-1',
      statusId: 'status-1'
    } as never)
  database.getStatus.mockReset()
  database.getStatus.mockImplementation(async ({ statusId }) => {
    if (statusId === 'status-1') {
      return {
        id: 'status-1',
        type: 'Note',
        text: ''
      } as never
    }

    return null
  })
  database.updateNote.mockResolvedValue({} as never)
  database.getAttachments.mockResolvedValue([])
  database.createAttachment.mockResolvedValue({} as never)
  database.updateFitnessSettings.mockResolvedValue({} as never)
  database.createNote.mockResolvedValue({
    id: 'status-new',
    type: 'Note',
    text: ''
  } as never)
  database.createNotification.mockResolvedValue({
    id: 'notification-1',
    actorId: 'actor-1',
    type: 'activity_import',
    sourceActorId: 'actor-1',
    isRead: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as never)
  mockSaveMedia.mockResolvedValue({
    id: 'media-1',
    mime_type: 'image/jpeg',
    url: 'https://llun.test/media-1.jpg',
    meta: {
      original: {
        width: 640,
        height: 480
      }
    }
  } as never)
  mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)

  database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)
  database.assignFitnessFileGearIfUnset.mockResolvedValue(true)
  database.findFitnessGearByDeviceKey.mockReset().mockResolvedValue(null)

  mockGetValidStravaAccessToken.mockResolvedValue('access-token')
  mockBuildTcxFromStravaStreams.mockReturnValue(null)
  mockGetStravaActivity.mockResolvedValue({
    id: 123,
    upload_id: 67890,
    name: 'Morning Run',
    distance: 5_000,
    elapsed_time: 1_500,
    total_elevation_gain: 120,
    start_date: '2026-01-01T00:00:00.000Z',
    sport_type: 'Run',
    visibility: 'everyone'
  })
  // Default: streams with GPS data
  mockGetStravaActivityStreams.mockResolvedValue({
    latlng: {
      type: 'latlng',
      data: [
        [37.7749, -122.4194],
        [37.775, -122.4195]
      ]
    },
    time: { type: 'time', data: [0, 10] }
  })
  mockBuildGpxFromStravaStreams.mockReturnValue(
    '<?xml version="1.0"?><gpx>...</gpx>'
  )
  mockSaveFitnessFile.mockResolvedValue({
    id: 'new-file',
    type: 'fitness',
    file_type: 'gpx',
    mime_type: 'application/gpx+xml',
    url: 'http://llun.test/api/v1/fitness-files/new-file',
    fileName: 'strava-123.gpx',
    size: 42
  })
  mockImportFitnessFiles.mockResolvedValue([])
  mockGetStravaActivityPhotos.mockResolvedValue([])
  mockGetQueue.mockReset().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  } as never)
}
