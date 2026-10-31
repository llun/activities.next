import { NextRequest } from 'next/server'

import { sendLike } from '@/lib/activities'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

const { mockGetNote, mockSendLike } = vi.hoisted(() => ({
  mockGetNote: vi.fn(),
  mockSendLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    sendLike: mockSendLike,
    getNote: mockGetNote
  }
})

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const favourite = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourite`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/favourite', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // llun.dev is the one fixture domain that answers on the real internet:
    // it served HTTP 404 for the fixture actor's document. Serve the same 404
    // at the fetch boundary so the refresh path fails the same way without a
    // connection.
    fetchMock.resetMocks()
    fetchMock.doMock()
    fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))
  })

  afterEach(() => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
  })

  // The signed-in actor (actor1) favourites a status by actor2.
  const seedNote = async (suffix: string, to: string[]) => {
    const statusId = `${ACTOR2_ID}/statuses/favourite-${suffix}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'like me',
      to,
      cc: []
    })
    return statusId
  }

  it('records the like, federates it and returns the status as favourited', async () => {
    const statusId = await seedNote('readable', [ACTIVITY_STREAM_PUBLIC])

    const response = await favourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: true,
      favourites_count: 1
    })
    await expect(
      database.isActorLikedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBeTrue()
    expect(sendLike).toHaveBeenCalledTimes(1)
  })

  it('is idempotent and does not federate a second Like activity', async () => {
    const statusId = await seedNote('twice', [ACTIVITY_STREAM_PUBLIC])

    await favourite(statusId)
    const response = await favourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: true,
      favourites_count: 1
    })
    expect(sendLike).toHaveBeenCalledTimes(1)
  })

  it('returns 404 and records nothing for a status the actor cannot read', async () => {
    const statusId = await seedNote('private', [])

    const response = await favourite(statusId)

    expect(response.status).toBe(404)
    await expect(
      database.isActorLikedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBeFalse()
    expect(sendLike).not.toHaveBeenCalled()
  })

  it('returns 404 for a status that does not exist', async () => {
    const response = await favourite(`${ACTOR2_ID}/statuses/favourite-missing`)

    expect(response.status).toBe(404)
    expect(sendLike).not.toHaveBeenCalled()
  })

  describe('unstored remote status', () => {
    const remoteActorId = EXTERNAL_ACTOR1
    const remoteStatusId = `${remoteActorId}/statuses/remote-public-1`

    it('unstored remote public status → fetched, stored, 200', async () => {
      mockGetNote.mockResolvedValueOnce({
        id: remoteStatusId,
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'hello remote world',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await favourite(remoteStatusId)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        uri: remoteStatusId,
        favourited: true,
        favourites_count: 1
      })
      const stored = await database.getStatus({ statusId: remoteStatusId })
      expect(stored?.type).toBe(StatusType.enum.Note)
      if (stored?.type === StatusType.enum.Note) {
        expect(stored.text).toBe('hello remote world')
      }
      expect(mockSendLike).toHaveBeenCalledTimes(1)
    })

    it('unstored remote public status with attachments → fetched, stored via real dispatch with attachments, 200', async () => {
      const remoteStatusWithAttachmentId = `${remoteActorId}/statuses/remote-public-attachment-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteStatusWithAttachmentId,
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'hello with attachment',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z',
        attachment: [
          {
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://somewhere.test/media/photo.jpg',
            width: 1200,
            height: 800,
            name: 'A scenic mountain'
          }
        ]
      })

      const response = await favourite(remoteStatusWithAttachmentId)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toMatchObject({
        uri: remoteStatusWithAttachmentId,
        favourited: true,
        favourites_count: 1
      })
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        type: 'image',
        url: 'https://somewhere.test/media/photo.jpg',
        description: 'A scenic mountain'
      })

      const attachments = await database.getAttachments({
        statusId: remoteStatusWithAttachmentId
      })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        statusId: remoteStatusWithAttachmentId,
        actorId: remoteActorId,
        mediaType: 'image/jpeg',
        url: 'https://somewhere.test/media/photo.jpg',
        name: 'A scenic mountain'
      })
      expect(mockSendLike).toHaveBeenCalledTimes(1)
    })

    it('a local-domain id → 404, nothing stored, no fetch', async () => {
      const localStatusId =
        'https://llun.test/users/test2/statuses/local-missing-1'
      const response = await favourite(localStatusId)

      expect(response.status).toBe(404)
      expect(mockGetNote).not.toHaveBeenCalled()
      const stored = await database.getStatus({ statusId: localStatusId })
      expect(stored).toBeNull()
    })

    it('a non-public note → 404, nothing stored', async () => {
      const nonPublicId = `${remoteActorId}/statuses/remote-private-1`
      mockGetNote.mockResolvedValueOnce({
        id: nonPublicId,
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'followers only',
        to: [`${remoteActorId}/followers`],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await favourite(nonPublicId)

      expect(response.status).toBe(404)
      const stored = await database.getStatus({ statusId: nonPublicId })
      expect(stored).toBeNull()
    })

    it('an origin-mismatched note → 404, nothing stored', async () => {
      const mismatchedId = `${remoteActorId}/statuses/remote-mismatched-1`
      mockGetNote.mockResolvedValueOnce({
        id: 'https://evil.test/users/bob/statuses/remote-mismatched-1',
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'forged note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await favourite(mismatchedId)

      expect(response.status).toBe(404)
      const stored = await database.getStatus({ statusId: mismatchedId })
      expect(stored).toBeNull()
    })

    it('a cross-host attributedTo → 404, nothing stored', async () => {
      const crossHostId = `${remoteActorId}/statuses/remote-crosshost-1`
      mockGetNote.mockResolvedValueOnce({
        id: crossHostId,
        type: 'Note',
        attributedTo: 'https://other.test/users/carol',
        content: 'note attributed elsewhere',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await favourite(crossHostId)

      expect(response.status).toBe(404)
      const stored = await database.getStatus({ statusId: crossHostId })
      expect(stored).toBeNull()
    })

    it('an existing row the viewer cannot read → 404 and no fetch', async () => {
      // A remote actor the signed-in actor1 does not follow, so the seeded
      // followers-only row is genuinely unreadable to the viewer.
      const unfollowedActorId = 'https://llun.dev/users/unfollowed'
      await database.createActor({
        actorId: unfollowedActorId,
        username: 'unfollowed',
        domain: 'llun.dev',
        publicKey: 'publicKey-unfollowed',
        inboxUrl: `${unfollowedActorId}/inbox`,
        sharedInboxUrl: 'https://llun.dev/inbox',
        followersUrl: `${unfollowedActorId}/followers`,
        createdAt: Date.now()
      })
      const unreadableId = `${unfollowedActorId}/statuses/unreadable-existing-1`
      await database.createNote({
        id: unreadableId,
        url: unreadableId,
        actorId: unfollowedActorId,
        text: 'secret',
        to: [`${unfollowedActorId}/followers`],
        cc: []
      })

      const response = await favourite(unreadableId)

      expect(response.status).toBe(404)
      expect(mockGetNote).not.toHaveBeenCalled()
    })
  })
})
