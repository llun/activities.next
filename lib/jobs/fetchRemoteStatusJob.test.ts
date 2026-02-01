import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { StatusType } from '@/lib/types/domain/status'

enableFetchMocks()

const REMOTE_ACTOR_ID = 'https://mastodon.social/users/testUser'
const REMOTE_STATUS_ID = 'https://mastodon.social/users/testUser/statuses/123456789'
const PUBLIC_STREAM = 'https://www.w3.org/ns/activitystreams#Public'

const MOCK_ACTOR = {
  id: REMOTE_ACTOR_ID,
  type: 'Person',
  preferredUsername: 'testUser',
  inbox: `${REMOTE_ACTOR_ID}/inbox`,
  outbox: `${REMOTE_ACTOR_ID}/outbox`,
  publicKey: {
    id: `${REMOTE_ACTOR_ID}#main-key`,
    owner: REMOTE_ACTOR_ID,
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\n...'
  }
}

describe('fetchRemoteStatusJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('fetches and saves a remote public status', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/1`
    fetchMock.mockResponse(async (req) => {
      if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Hello World',
          to: [PUBLIC_STREAM],
          cc: [],
          published: new Date().toISOString()
        })
      }
      return JSON.stringify({})
    })

    await fetchRemoteStatusJob(database, {
      id: 'job-id',
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: STATUS_ID }
    })

    const status = await database.getStatus({ statusId: STATUS_ID })
    expect(status).toBeDefined()
    expect(status?.id).toBe(STATUS_ID)
    expect(status?.text).toBe('Hello World')
    expect(status?.type).toBe(StatusType.enum.Note)
  })

  it('ignores non-public status', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/2`
    fetchMock.mockResponse(async (req) => {
      if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Private Hello',
          to: [REMOTE_ACTOR_ID],
          cc: [],
          published: new Date().toISOString()
        })
      }
      return JSON.stringify({})
    })

    await fetchRemoteStatusJob(database, {
      id: 'job-id',
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: STATUS_ID }
    })

    const status = await database.getStatus({ statusId: STATUS_ID })
    expect(status).toBeNull()
  })

  it('fetches parent status recursively', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/3`
    const PARENT_ID = 'https://mastodon.social/users/testUser/statuses/parent'
    
    fetchMock.mockResponse(async (req) => {
      if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Child',
          inReplyTo: PARENT_ID,
          to: [PUBLIC_STREAM],
          published: new Date().toISOString()
        })
      }
      if (req.url === PARENT_ID) {
        return JSON.stringify({
          id: PARENT_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Parent',
          to: [PUBLIC_STREAM],
          published: new Date().toISOString()
        })
      }
      return JSON.stringify({})
    })

    await fetchRemoteStatusJob(database, {
      id: 'job-id',
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: STATUS_ID }
    })

    const child = await database.getStatus({ statusId: STATUS_ID })
    const parent = await database.getStatus({ statusId: PARENT_ID })

    expect(child).toBeDefined()
    expect(parent).toBeDefined()
    expect(child?.reply).toBe(PARENT_ID)
  })

  it('fetches replies collection', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/4`
    const REPLIES_ID = `${STATUS_ID}/replies`
    const REPLY_ITEM_ID = 'https://mastodon.social/users/otherUser/statuses/reply1'

    fetchMock.mockResponse(async (req) => {
      if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Main Post',
          to: [PUBLIC_STREAM],
          replies: REPLIES_ID,
          published: new Date().toISOString()
        })
      }
      if (req.url === REPLIES_ID) {
        return JSON.stringify({
          id: REPLIES_ID,
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [REPLY_ITEM_ID]
          }
        })
      }
      if (req.url === REPLY_ITEM_ID) {
        return JSON.stringify({
          id: REPLY_ITEM_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'A reply',
          inReplyTo: STATUS_ID,
          to: [PUBLIC_STREAM],
          published: new Date().toISOString()
        })
      }
      return JSON.stringify({})
    })

    await fetchRemoteStatusJob(database, {
      id: 'job-id',
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: STATUS_ID }
    })

    const main = await database.getStatus({ statusId: STATUS_ID })
    const reply = await database.getStatus({ statusId: REPLY_ITEM_ID })

    expect(main).toBeDefined()
    expect(reply).toBeDefined()
    expect(reply?.reply).toBe(STATUS_ID)
  })
})