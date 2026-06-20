import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { StatusType } from '@/lib/types/domain/status'

enableFetchMocks()

const REMOTE_ACTOR_ID = 'https://mastodon.social/users/testUser'
const REMOTE_STATUS_ID =
  'https://mastodon.social/users/testUser/statuses/123456789'
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
    await database.createAccount({
      ...seedActor1,
      email: `signed-fetch-signer@${TEST_DOMAIN}`,
      username: 'signed-fetch-signer',
      domain: TEST_DOMAIN
    })
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
    const REPLY_ITEM_ID =
      'https://mastodon.social/users/otherUser/statuses/reply1'

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

  it('fetches nested replies across the whole thread', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/thread`
    const REPLIES_ID = `${STATUS_ID}/replies`
    const CHILD_ID = 'https://mastodon.social/users/otherUser/statuses/child'
    const CHILD_REPLIES_ID = `${CHILD_ID}/replies`
    const GRANDCHILD_ID =
      'https://mastodon.social/users/otherUser/statuses/grandchild'

    fetchMock.mockResponse(async (req) => {
      if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Root',
          to: [PUBLIC_STREAM],
          replies: REPLIES_ID,
          published: new Date().toISOString()
        })
      }
      if (req.url === REPLIES_ID) {
        return JSON.stringify({
          id: REPLIES_ID,
          type: 'Collection',
          first: { type: 'CollectionPage', items: [CHILD_ID] }
        })
      }
      if (req.url === CHILD_ID) {
        return JSON.stringify({
          id: CHILD_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Child reply',
          inReplyTo: STATUS_ID,
          replies: CHILD_REPLIES_ID,
          to: [PUBLIC_STREAM],
          published: new Date().toISOString()
        })
      }
      if (req.url === CHILD_REPLIES_ID) {
        return JSON.stringify({
          id: CHILD_REPLIES_ID,
          type: 'Collection',
          first: { type: 'CollectionPage', items: [GRANDCHILD_ID] }
        })
      }
      if (req.url === GRANDCHILD_ID) {
        return JSON.stringify({
          id: GRANDCHILD_ID,
          type: 'Note',
          attributedTo: REMOTE_ACTOR_ID,
          content: 'Grandchild reply',
          inReplyTo: CHILD_ID,
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

    const child = await database.getStatus({ statusId: CHILD_ID })
    const grandchild = await database.getStatus({ statusId: GRANDCHILD_ID })

    expect(child?.reply).toBe(STATUS_ID)
    expect(grandchild).toBeDefined()
    expect(grandchild?.reply).toBe(CHILD_ID)
  })

  it('uses signed GET requests for remote status, actor, and replies fetches', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/signed`
    const REMOTE_SIGNED_ACTOR_ID =
      'https://mastodon.social/users/signedFetchUser'
    const REPLIES_ID = `${STATUS_ID}/replies`
    const REPLY_ITEM_ID =
      'https://mastodon.social/users/otherUser/statuses/signed-reply'
    const signedFetches: string[] = []

    fetchMock.mockResponse(async (req) => {
      if (
        req.url === STATUS_ID ||
        req.url === REMOTE_SIGNED_ACTOR_ID ||
        req.url === REPLIES_ID ||
        req.url === REPLY_ITEM_ID
      ) {
        expect(req.headers.get('signature')).toContain(
          'headers="(request-target) host date"'
        )
        signedFetches.push(req.url)
      }

      if (req.url === REMOTE_SIGNED_ACTOR_ID) {
        return JSON.stringify({
          ...MOCK_ACTOR,
          id: REMOTE_SIGNED_ACTOR_ID,
          preferredUsername: 'signedFetchUser',
          inbox: `${REMOTE_SIGNED_ACTOR_ID}/inbox`,
          outbox: `${REMOTE_SIGNED_ACTOR_ID}/outbox`,
          publicKey: {
            ...MOCK_ACTOR.publicKey,
            id: `${REMOTE_SIGNED_ACTOR_ID}#main-key`,
            owner: REMOTE_SIGNED_ACTOR_ID
          }
        })
      }
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: REMOTE_SIGNED_ACTOR_ID,
          content: 'Signed Main Post',
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
          attributedTo: REMOTE_SIGNED_ACTOR_ID,
          content: 'A signed reply',
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

    expect(signedFetches).toEqual(
      expect.arrayContaining([
        STATUS_ID,
        REMOTE_SIGNED_ACTOR_ID,
        REPLIES_ID,
        REPLY_ITEM_ID
      ])
    )
    expect(signedFetches.filter((url) => url === STATUS_ID)).toHaveLength(1)
  })
})
