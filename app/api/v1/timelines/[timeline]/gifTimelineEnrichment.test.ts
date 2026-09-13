import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { clearAnimationMetadataCacheForTests } from '@/lib/services/medias/animationMetadata'
import { Timeline } from '@/lib/services/timelines/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { GET } from './route'

vi.mock('@/lib/services/federation/serverSoftware', () => ({
  getServerSoftware: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/timelines/[timeline] GIFV enrichment regression', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.mocked(getServerSoftware).mockReset()
    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(() => {
    clearAnimationMetadataCacheForTests()
  })

  it('enriches unclassified video attachment to gifv on the first activities_next timeline read', async () => {
    const CHEEAUN_STATUS_URL =
      'https://mastodon.social/@cheeaun/117262540412068294'
    const CHEEAUN_STATUS_ID =
      'https://mastodon.social/users/cheeaun/statuses/117262540412068294'
    const CHEEAUN_ACTOR_ID = 'https://mastodon.social/users/cheeaun'
    const VIDEO_URL =
      'https://files.mastodon.social/media_attachments/files/117/262/540/412/068/294/original/test-api.mp4'
    const PREVIEW_URL =
      'https://files.mastodon.social/media_attachments/files/117/262/540/412/068/294/small/test-api.png'

    // Seed post with unclassified video attachment
    const note = (await database.createNote({
      id: CHEEAUN_STATUS_ID,
      url: CHEEAUN_STATUS_URL,
      actorId: CHEEAUN_ACTOR_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Mastodon GIF note for API'
    })) as StatusNote

    const attachment = await database.createAttachment({
      actorId: CHEEAUN_ACTOR_ID,
      statusId: note.id,
      mediaType: 'video/mp4',
      url: VIDEO_URL,
      width: 400,
      height: 300,
      name: 'Cheeaun GIF animation'
      // playbackType left undefined
    })

    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: {
        ...note,
        attachments: [attachment]
      },
      timeline: Timeline.MAIN
    })

    // Mock Mastodon status endpoint response
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '117262540412068294',
        uri: CHEEAUN_STATUS_ID,
        url: CHEEAUN_STATUS_URL,
        account: {
          url: 'https://mastodon.social/@cheeaun'
        },
        media_attachments: [
          {
            id: 'med-cheeaun-api-1',
            type: 'gifv',
            url: VIDEO_URL,
            preview_url: PREVIEW_URL
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/117262540412068294'
    })

    // First timeline read — format=activities_next
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/timelines/home?format=activities_next'
      ),
      { params: Promise.resolve({ timeline: 'home' }) }
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    const statuses = json.statuses as Array<{
      id: string
      attachments: Array<{ playbackType?: string; thumbnailUrl?: string }>
    }>

    const post = statuses.find((s) => s.id === note.id)
    expect(post).toBeDefined()
    expect(post?.attachments[0]?.playbackType).toBe('gifv')
    expect(post?.attachments[0]?.thumbnailUrl).toBe(PREVIEW_URL)

    // Verify persisted to database
    const dbAttachments = await database.getAttachments({ statusId: note.id })
    expect(dbAttachments[0]?.playbackType).toBe('gifv')
    expect(dbAttachments[0]?.thumbnailUrl).toBe(PREVIEW_URL)
  })
})
