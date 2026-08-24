import { getDatabase } from '@/lib/database'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { Visibility } from '@/lib/types/mastodon/visibility'

import { runImportStravaActivity } from './runImportStravaActivity'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/jobs/importStravaActivityJob', () => ({
  importStravaActivityJob: vi.fn()
}))

vi.mock('./describeConnection', () => ({
  printDatabaseBanner: vi.fn()
}))

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>
const mockImportStravaActivityJob =
  importStravaActivityJob as jest.MockedFunction<typeof importStravaActivityJob>

describe('runImportStravaActivity', () => {
  const baseArgs = [
    '--actor-id',
    'https://llun.test/users/test1',
    '--activity-id',
    '123456789',
    '--strava-app-id',
    'strava-app-123',
    '--strava-app-secret',
    'strava-secret-456',
    '--access-token',
    'strava-token-789'
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs import job with credentials and no visibility when --visibility is omitted', async () => {
    const database = {} as ReturnType<typeof getDatabase>
    mockGetDatabase.mockReturnValue(database)

    const exitCode = await runImportStravaActivity(baseArgs)

    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).toHaveBeenCalledWith(database, {
      id: expect.stringMatching(
        /^cli:https:\/\/llun\.test\/users\/test1:123456789:\d+$/
      ),
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/test1',
        stravaActivityId: '123456789',
        stravaAuth: {
          appId: 'strava-app-123',
          appSecret: 'strava-secret-456',
          accessToken: 'strava-token-789'
        }
      }
    })
  })

  it('forwards --visibility to import job when provided', async () => {
    const database = {} as ReturnType<typeof getDatabase>
    mockGetDatabase.mockReturnValue(database)

    const exitCode = await runImportStravaActivity([
      ...baseArgs,
      '--visibility',
      Visibility.enum.public
    ])

    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).toHaveBeenCalledWith(database, {
      id: expect.stringMatching(
        /^cli:https:\/\/llun\.test\/users\/test1:123456789:\d+$/
      ),
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/test1',
        stravaActivityId: '123456789',
        visibility: Visibility.enum.public,
        stravaAuth: {
          appId: 'strava-app-123',
          appSecret: 'strava-secret-456',
          accessToken: 'strava-token-789'
        }
      }
    })
  })

  it('returns 1 on invalid visibility', async () => {
    const exitCode = await runImportStravaActivity([
      ...baseArgs,
      '--visibility',
      'invalid-vis'
    ])

    expect(exitCode).toBe(1)
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
  })

  it('returns 0 on --help', async () => {
    const exitCode = await runImportStravaActivity(['--help'])
    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
  })
})
