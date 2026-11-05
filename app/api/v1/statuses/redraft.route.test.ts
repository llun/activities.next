import { NextRequest } from 'next/server'

import { DELETE as deleteStatusById } from '@/app/api/v1/statuses/[id]/route'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { publishScheduledStatusJob } from '@/lib/jobs/publishScheduledStatusJob'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'

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

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('POST /api/v1/statuses delete-and-redraft media resolution', () => {
  const { database, prepare, destroy } = createTestDatabase({ isolated: true })

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    fetchMock.resetMocks()
    fetchMock.doMock()
    fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))
  })

  afterEach(() => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
  })

  const createMediaForActor = async (actorId: string, label: string) => {
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/${label}.jpg`,
        bytes: 2048,
        mimeType: 'image/jpeg',
        metaData: { width: 1200, height: 900 }
      },
      description: `Alt text for ${label}`
    })
    if (!media) {
      throw new Error(`Expected media row for ${label}`)
    }
    return media
  }

  const postStatus = (body: Record<string, unknown>) =>
    POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

  const deleteStatus = (clientStatusId: string) =>
    deleteStatusById(
      new NextRequest(`https://llun.test/api/v1/statuses/${clientStatusId}`, {
        method: 'DELETE',
        headers: {
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({ id: clientStatusId }) }
    )

  it('re-attaches media when redrafting with attachment UUIDs from a status deleted via DELETE /api/v1/statuses/:id', async () => {
    const suffix = `${Date.now()}-redraft`
    const mediaOne = await createMediaForActor(ACTOR1_ID, `${suffix}-1`)
    const mediaTwo = await createMediaForActor(ACTOR1_ID, `${suffix}-2`)

    const createResponse = await postStatus({
      status: 'First draft with typo',
      media_ids: [mediaOne.id, mediaTwo.id]
    })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json()
    expect(created.media_attachments).toHaveLength(2)

    const deleteResponse = await deleteStatus(created.id)
    expect(deleteResponse.status).toBe(200)
    const deleted = await deleteResponse.json()
    const deletedAttachmentIds = deleted.media_attachments.map(
      (item: { id: string }) => item.id
    )
    expect(deletedAttachmentIds).toHaveLength(2)
    expect(deletedAttachmentIds).not.toContain(mediaOne.id)
    expect(deletedAttachmentIds).not.toContain(mediaTwo.id)

    const redraftResponse = await postStatus({
      status: 'Fixed draft with same media',
      media_ids: deletedAttachmentIds
    })
    expect(redraftResponse.status).toBe(200)
    const redrafted = await redraftResponse.json()
    expect(redrafted.content).toContain('Fixed draft with same media')
    expect(redrafted.media_attachments).toHaveLength(2)
    expect(
      redrafted.media_attachments.map(
        (item: { url: string; description: string }) => ({
          url: item.url,
          description: item.description
        })
      )
    ).toEqual(
      deleted.media_attachments.map(
        (item: { url: string; description: string }) => ({
          url: item.url,
          description: item.description
        })
      )
    )
  })

  it('rejects an attachment UUID from another actors deleted status with 422 while allowing its owner', async () => {
    const suffix = `${Date.now()}-foreign`
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const actor2Media = await createMediaForActor(ACTOR2_ID, suffix)
    const actor2Create = await postStatus({
      status: 'Actor two draft',
      media_ids: [actor2Media.id]
    })
    expect(actor2Create.status).toBe(200)
    const actor2Created = await actor2Create.json()

    const actor2Delete = await deleteStatus(actor2Created.id)
    expect(actor2Delete.status).toBe(200)
    const actor2Deleted = await actor2Delete.json()
    const actor2AttachmentId = actor2Deleted.media_attachments[0].id as string

    // Actor 1 tries to attach Actor 2's deleted attachment UUID -> 422.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const stealAttempt = await postStatus({
      status: 'Trying another actors attachment uuid',
      media_ids: [actor2AttachmentId]
    })
    expect(stealAttempt.status).toBe(422)

    // Actor 2 can still redraft their own media with the same UUID -> 200.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const ownerRedraft = await postStatus({
      status: 'Actor two redraft',
      media_ids: [actor2AttachmentId]
    })
    expect(ownerRedraft.status).toBe(200)
    const ownerRedrafted = await ownerRedraft.json()
    expect(ownerRedrafted.media_attachments).toHaveLength(1)
  })

  it('counts a deleted attachment UUID and its numeric media id once and checks the attachment cap after deduplication', async () => {
    const suffix = `${Date.now()}-dedupe`
    const medias = await Promise.all(
      Array.from({ length: MAX_STORED_MEDIA_ATTACHMENTS + 1 }, (_, index) =>
        createMediaForActor(ACTOR1_ID, `${suffix}-${index}`)
      )
    )

    const initialCreate = await postStatus({
      status: 'Initial post for dedupe check',
      media_ids: [medias[0].id]
    })
    expect(initialCreate.status).toBe(200)
    const initialCreated = await initialCreate.json()
    const deleteRes = await deleteStatus(initialCreated.id)
    expect(deleteRes.status).toBe(200)
    const deleted = await deleteRes.json()
    const attachmentUuid = deleted.media_attachments[0].id as string

    // Mixing the deleted attachment UUID and its numeric media id attaches once.
    const mixedResponse = await postStatus({
      status: 'Mixed uuid and numeric id',
      media_ids: [attachmentUuid, medias[0].id]
    })
    expect(mixedResponse.status).toBe(200)
    const mixedStatus = await mixedResponse.json()
    expect(mixedStatus.media_attachments).toHaveLength(1)

    // Delete mixedStatus too so its fresh UUID can be tested at the max cap.
    const secondDelete = await deleteStatus(mixedStatus.id)
    expect(secondDelete.status).toBe(200)
    const secondUuid = (await secondDelete.json()).media_attachments[0]
      .id as string

    // MAX_STORED_MEDIA_ATTACHMENTS + 1 entries where two name the same media
    // resolves to MAX_STORED_MEDIA_ATTACHMENTS unique items -> 200.
    const capBoundaryResponse = await postStatus({
      status: 'At exact max attachments after dedupe',
      media_ids: [
        secondUuid,
        `0${medias[0].id}`,
        ...medias
          .slice(1, MAX_STORED_MEDIA_ATTACHMENTS)
          .map((media) => media.id)
      ]
    })
    expect(capBoundaryResponse.status).toBe(200)
    const capBoundaryStatus = await capBoundaryResponse.json()
    expect(capBoundaryStatus.media_attachments).toHaveLength(
      MAX_STORED_MEDIA_ATTACHMENTS
    )

    // Exceeding MAX_STORED_MEDIA_ATTACHMENTS distinct items still fails with 422.
    const overCapResponse = await postStatus({
      status: 'Over max attachments',
      media_ids: [
        secondUuid,
        ...medias
          .slice(1, MAX_STORED_MEDIA_ATTACHMENTS + 1)
          .map((media) => media.id)
      ]
    })
    expect(overCapResponse.status).toBe(422)
  })

  it('rejects an unknown attachment UUID with 422', async () => {
    const response = await postStatus({
      status: 'Post with unknown uuid',
      media_ids: ['00000000-0000-4000-8000-000000000099']
    })
    expect(response.status).toBe(422)
  })

  it('resolves deleted attachment UUIDs when scheduling a redrafted status', async () => {
    const suffix = `${Date.now()}-scheduled`
    const media = await createMediaForActor(ACTOR1_ID, suffix)

    const initialCreate = await postStatus({
      status: 'Immediate draft before scheduling redraft',
      media_ids: [media.id]
    })
    expect(initialCreate.status).toBe(200)
    const created = await initialCreate.json()

    const deleteRes = await deleteStatus(created.id)
    expect(deleteRes.status).toBe(200)
    const deleted = await deleteRes.json()
    const deletedAttachmentId = deleted.media_attachments[0].id as string

    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const scheduleRes = await postStatus({
      status: 'Scheduled redraft with media',
      media_ids: [deletedAttachmentId],
      scheduled_at: scheduledAt
    })
    expect(scheduleRes.status).toBe(200)
    const scheduled = await scheduleRes.json()
    expect(scheduled.media_attachments).toHaveLength(1)
    expect(scheduled.params.media_ids).toEqual([media.id])

    const dueAt = Date.now()
    await database.updateScheduledStatusAt({
      id: scheduled.id,
      actorId: ACTOR1_ID,
      scheduledAt: dueAt
    })
    await publishScheduledStatusJob(database, {
      id: `job-${suffix}`,
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: {
        scheduledStatusId: scheduled.id,
        scheduledAt: dueAt
      }
    })

    const statusesAfterPublish = await database.getActorStatuses({
      actorId: ACTOR1_ID
    })
    const published = statusesAfterPublish.find(
      (item) =>
        'text' in item && item.text.includes('Scheduled redraft with media')
    )
    expect(published).toBeDefined()
    if (published && 'attachments' in published) {
      expect(published.attachments).toHaveLength(1)
    }
  })
})
