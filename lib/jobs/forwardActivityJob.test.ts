import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { forwardActivityJob } from '@/lib/jobs/forwardActivityJob'
import { FORWARD_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

describe('forwardActivityJob', () => {
  const database = getTestSQLDatabase()
  let localActorId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    localActorId = actor1?.id as string
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('delivers forwarded activity to all target inboxes with signed headers', async () => {
    fetchMock.mockResponse(JSON.stringify({}), { status: 202 })

    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://remote.test/statuses/reply-1/activity',
      type: 'Create',
      actor: 'https://remote.test/users/remote-author',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [localActorId],
      object: {
        id: 'https://remote.test/statuses/reply-1',
        type: 'Note',
        attributedTo: 'https://remote.test/users/remote-author',
        inReplyTo: `${localActorId}/statuses/1`,
        content: 'hello'
      }
    }

    const inboxes = [
      'https://follower1.example/inbox',
      'https://follower2.example/inbox'
    ]

    await forwardActivityJob(database, {
      id: 'forward-job-1',
      name: FORWARD_ACTIVITY_JOB_NAME,
      data: {
        activity,
        inboxes,
        localActorId
      }
    })

    const calls = fetchMock.mock.calls
    const deliveryUrls = calls.map((call) => call[0])
    expect(deliveryUrls).toContain('https://follower1.example/inbox')
    expect(deliveryUrls).toContain('https://follower2.example/inbox')

    const firstCallHeaders = (calls[0]?.[1]?.headers ?? {}) as Record<
      string,
      string
    >
    expect(firstCallHeaders.signature).toBeDefined()
    expect(firstCallHeaders.signature).toContain(localActorId)
    expect(calls[0]?.[1]?.body).toEqual(JSON.stringify(activity))
  })

  it('handles delivery errors gracefully without aborting other inboxes', async () => {
    fetchMock.mockImplementation(async (req) => {
      const url =
        typeof req === 'string'
          ? req
          : req && typeof req === 'object' && 'url' in req
            ? (req as Request).url
            : String(req)
      if (url.includes('follower1')) {
        throw new Error('Network error')
      }
      return new Response(JSON.stringify({}), { status: 202 })
    })

    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://remote.test/statuses/reply-2/activity',
      type: 'Create',
      actor: 'https://remote.test/users/remote-author',
      to: [ACTIVITY_STREAM_PUBLIC],
      object: {
        id: 'https://remote.test/statuses/reply-2',
        type: 'Note'
      }
    }

    await expect(
      forwardActivityJob(database, {
        id: 'forward-job-2',
        name: FORWARD_ACTIVITY_JOB_NAME,
        data: {
          activity,
          inboxes: [
            'https://follower1.example/inbox',
            'https://follower2.example/inbox'
          ],
          localActorId
        }
      })
    ).resolves.not.toThrow()

    const deliveryUrls = fetchMock.mock.calls.map((call) => call[0])
    expect(deliveryUrls).toContain('https://follower2.example/inbox')
  })

  it('ignores malformed job data', async () => {
    await expect(
      forwardActivityJob(database, {
        id: 'forward-job-3',
        name: FORWARD_ACTIVITY_JOB_NAME,
        data: {
          invalid: true
        }
      })
    ).resolves.not.toThrow()

    expect(fetchMock.mock.calls).toHaveLength(0)
  })
})
