import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  INLINE_DEADLINE_MS,
  INLINE_MAX_REPLY_ITEMS,
  fetchRemoteStatusJob
} from '@/lib/jobs/fetchRemoteStatusJob'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

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

    const status = (await database.getStatus({
      statusId: STATUS_ID
    })) as StatusNote
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

    const child = (await database.getStatus({
      statusId: STATUS_ID
    })) as StatusNote
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

    const main = await database.getStatus({ statusId: STATUS_ID })
    const reply = (await database.getStatus({
      statusId: REPLY_ITEM_ID
    })) as StatusNote

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
          cc: [],
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

    const child = (await database.getStatus({
      statusId: CHILD_ID
    })) as StatusNote
    const grandchild = (await database.getStatus({
      statusId: GRANDCHILD_ID
    })) as StatusNote

    expect(child?.reply).toBe(STATUS_ID)
    expect(grandchild).toBeDefined()
    expect(grandchild?.reply).toBe(CHILD_ID)
  })

  it('stores only direct replies and skips nesting when firstPageOnly is set', async () => {
    const STATUS_ID = `${REMOTE_STATUS_ID}/firstpage`
    const REPLIES_ID = `${STATUS_ID}/replies`
    const CHILD_ID = 'https://mastodon.social/users/otherUser/statuses/fp-child'
    const CHILD_REPLIES_ID = `${CHILD_ID}/replies`
    const GRANDCHILD_ID =
      'https://mastodon.social/users/otherUser/statuses/fp-grandchild'

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
          cc: [],
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
          cc: [],
          published: new Date().toISOString()
        })
      }
      return JSON.stringify({})
    })

    await fetchRemoteStatusJob(database, {
      id: 'job-id',
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: STATUS_ID, firstPageOnly: true }
    })

    const child = (await database.getStatus({
      statusId: CHILD_ID
    })) as StatusNote
    const grandchild = await database.getStatus({ statusId: GRANDCHILD_ID })

    // The direct reply is stored, but its nested thread is not walked.
    expect(child?.reply).toBe(STATUS_ID)
    expect(grandchild).toBeNull()
  })

  describe('inline (firstPageOnly) bounds', () => {
    const rootNote = (statusId: string, repliesId: string) => ({
      id: statusId,
      type: 'Note',
      attributedTo: REMOTE_ACTOR_ID,
      content: 'Root',
      to: [PUBLIC_STREAM],
      replies: repliesId,
      published: new Date().toISOString()
    })
    const itemUrls = (prefix: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          `https://mastodon.social/users/otherUser/${prefix}-${index}`
      )

    afterEach(() => {
      vi.useRealTimers()
    })

    it('considers only a handful of item urls from an opening page', async () => {
      const STATUS_ID = `${REMOTE_STATUS_ID}/inline-cap`
      const REPLIES_ID = `${STATUS_ID}/replies`
      const items = itemUrls('junk-cap', INLINE_MAX_REPLY_ITEMS * 10)
      const fetchedItems: string[] = []

      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        if (req.url === STATUS_ID) {
          return JSON.stringify(rootNote(STATUS_ID, REPLIES_ID))
        }
        if (req.url === REPLIES_ID) {
          return JSON.stringify({
            id: REPLIES_ID,
            type: 'Collection',
            first: { type: 'CollectionPage', items }
          })
        }
        if (items.includes(req.url)) fetchedItems.push(req.url)
        return { status: 404, body: '' }
      })

      await fetchRemoteStatusJob(database, {
        id: 'job-id',
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId: STATUS_ID, firstPageOnly: true }
      })

      expect(new Set(fetchedItems).size).toBeLessThanOrEqual(
        INLINE_MAX_REPLY_ITEMS
      )
      expect(fetchedItems.length).toBeGreaterThan(0)
    })

    it('still walks the whole opening page when run from a queue', async () => {
      const STATUS_ID = `${REMOTE_STATUS_ID}/queued-cap`
      const REPLIES_ID = `${STATUS_ID}/replies`
      const items = itemUrls('junk-queued', INLINE_MAX_REPLY_ITEMS * 2)
      const fetchedItems = new Set<string>()

      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        if (req.url === STATUS_ID) {
          return JSON.stringify(rootNote(STATUS_ID, REPLIES_ID))
        }
        if (req.url === REPLIES_ID) {
          return JSON.stringify({
            id: REPLIES_ID,
            type: 'Collection',
            first: { type: 'CollectionPage', items }
          })
        }
        if (items.includes(req.url)) fetchedItems.add(req.url)
        return { status: 404, body: '' }
      })

      await fetchRemoteStatusJob(database, {
        id: 'job-id',
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId: STATUS_ID }
      })

      expect(fetchedItems.size).toBe(items.length)
    })

    it('stops waiting on a stalled item once the deadline passes', async () => {
      const STATUS_ID = `${REMOTE_STATUS_ID}/inline-deadline`
      const REPLIES_ID = `${STATUS_ID}/replies`
      const items = itemUrls('stalled', 3)
      const fetchedItems: string[] = []

      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        if (req.url === STATUS_ID) {
          return JSON.stringify(rootNote(STATUS_ID, REPLIES_ID))
        }
        if (req.url === REPLIES_ID) {
          return JSON.stringify({
            id: REPLIES_ID,
            type: 'Collection',
            first: { type: 'CollectionPage', items }
          })
        }
        if (items.includes(req.url)) {
          fetchedItems.push(req.url)
          // A remote that accepts the connection and never answers.
          return new Promise<string>(() => undefined)
        }
        return { status: 404, body: '' }
      })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      let settled = false
      const job = fetchRemoteStatusJob(database, {
        id: 'job-id',
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId: STATUS_ID, firstPageOnly: true }
      }).then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(INLINE_DEADLINE_MS + 1000)
      await job

      expect(settled).toBe(true)
      // The deadline ended the walk after the first stalled item, instead of
      // waiting on each of them in turn.
      expect(fetchedItems).toHaveLength(1)
    })
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

  describe('origin binding', () => {
    // A fetched document is a claim by whoever served it: it may only name an
    // id on the origin that served it, and only an author on its own origin.
    const ATTACKER_ORIGIN = 'https://attacker.example'
    const VICTIM_ACTOR_ID = 'https://victim.example/users/victim'

    const publicNote = (fields: Record<string, unknown>) => ({
      type: 'Note',
      content: 'forged',
      to: [PUBLIC_STREAM],
      cc: [],
      published: new Date().toISOString(),
      ...fields
    })

    const runJob = (statusId: string) =>
      fetchRemoteStatusJob(database, {
        id: 'job-id',
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId }
      })

    it('does not store a fetched note that names an id on another origin', async () => {
      const requestedId = `${ATTACKER_ORIGIN}/notes/1`
      const forgedId = `${REMOTE_STATUS_ID}/planted`
      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        if (req.url === requestedId) {
          return JSON.stringify(
            publicNote({ id: forgedId, attributedTo: REMOTE_ACTOR_ID })
          )
        }
        return JSON.stringify({})
      })

      await runJob(requestedId)

      expect(await database.getStatus({ statusId: forgedId })).toBeNull()
    })

    it('does not store a fetched note attributed to an actor on another origin', async () => {
      const requestedId = `${ATTACKER_ORIGIN}/notes/2`
      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        if (req.url === requestedId) {
          return JSON.stringify(
            publicNote({ id: requestedId, attributedTo: REMOTE_ACTOR_ID })
          )
        }
        return JSON.stringify({})
      })

      await runJob(requestedId)

      expect(await database.getStatus({ statusId: requestedId })).toBeNull()
    })

    // The requested note is gated before normalization, so its author may
    // still be an embedded actor object or a multi-valued array. The gate must
    // check the id normalization stores, not refuse the raw shape.
    describe('non-string attributedTo on the requested note', () => {
      const CHANNEL_ID = 'https://mastodon.social/video-channels/channel'

      const mockNote = (statusId: string, attributedTo: unknown) =>
        fetchMock.mockResponse(async (req) => {
          if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
          if (req.url === VICTIM_ACTOR_ID) {
            return JSON.stringify({
              ...MOCK_ACTOR,
              id: VICTIM_ACTOR_ID,
              preferredUsername: 'victim',
              inbox: `${VICTIM_ACTOR_ID}/inbox`,
              outbox: `${VICTIM_ACTOR_ID}/outbox`,
              publicKey: {
                ...MOCK_ACTOR.publicKey,
                id: `${VICTIM_ACTOR_ID}#main-key`,
                owner: VICTIM_ACTOR_ID
              }
            })
          }
          if (req.url === statusId) {
            return JSON.stringify(publicNote({ id: statusId, attributedTo }))
          }
          return JSON.stringify({})
        })

      it('stores a note whose same-origin author is an embedded object', async () => {
        const statusId = `${REMOTE_STATUS_ID}/embedded-author`
        mockNote(statusId, {
          type: 'Person',
          id: REMOTE_ACTOR_ID,
          name: 'testUser'
        })

        await runJob(statusId)

        const stored = await database.getStatus({ statusId })
        expect(stored?.actorId).toBe(REMOTE_ACTOR_ID)
      })

      it('stores a PeerTube-style note naming the account and the channel', async () => {
        const statusId = `${REMOTE_STATUS_ID}/peertube-author`
        mockNote(statusId, [
          { type: 'Person', id: REMOTE_ACTOR_ID },
          { type: 'Group', id: CHANNEL_ID }
        ])

        await runJob(statusId)

        const stored = await database.getStatus({ statusId })
        expect(stored?.actorId).toBe(REMOTE_ACTOR_ID)
      })

      it('refuses an author array whose first entry is on another origin', async () => {
        const statusId = `${REMOTE_STATUS_ID}/cross-origin-first-author`
        mockNote(statusId, [
          { type: 'Person', id: VICTIM_ACTOR_ID },
          { type: 'Person', id: REMOTE_ACTOR_ID }
        ])

        await runJob(statusId)

        expect(await database.getStatus({ statusId })).toBeNull()
      })
    })

    // recordActorIfNeeded keys the author's row on the id its origin names,
    // so a note naming its author by an alias must point at that row.
    it('stores a note whose author is a same-origin alias under the recorded id', async () => {
      const statusId = `${REMOTE_STATUS_ID}/alias-author`
      const aliasActorId = 'https://mastodon.social/@testUser'
      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID || req.url === aliasActorId) {
          return JSON.stringify(MOCK_ACTOR)
        }
        if (req.url === statusId) {
          return JSON.stringify(
            publicNote({ id: statusId, attributedTo: aliasActorId })
          )
        }
        return JSON.stringify({})
      })

      await runJob(statusId)

      const stored = await database.getStatus({ statusId })
      expect(stored?.actorId).toBe(REMOTE_ACTOR_ID)
      expect(await database.getActorFromId({ id: aliasActorId })).toBeNull()
    })

    it('stores only the inlined replies that belong to the origin serving them', async () => {
      const STATUS_ID = `${REMOTE_STATUS_ID}/origin-bound`
      const forgedOtherHostId = 'https://victim.example/users/victim/statuses/1'
      const forgedAuthorId = `${REMOTE_STATUS_ID}/forged-author`
      const genuineReplyId = `${REMOTE_STATUS_ID}/genuine-reply`
      fetchMock.mockResponse(async (req) => {
        if (req.url === REMOTE_ACTOR_ID) return JSON.stringify(MOCK_ACTOR)
        // The victim is a real, resolvable actor: only the origin binding
        // stands between the page and a status stored under their name.
        if (req.url === VICTIM_ACTOR_ID) {
          return JSON.stringify({
            ...MOCK_ACTOR,
            id: VICTIM_ACTOR_ID,
            preferredUsername: 'victim',
            inbox: `${VICTIM_ACTOR_ID}/inbox`,
            outbox: `${VICTIM_ACTOR_ID}/outbox`,
            publicKey: {
              ...MOCK_ACTOR.publicKey,
              id: `${VICTIM_ACTOR_ID}#main-key`,
              owner: VICTIM_ACTOR_ID
            }
          })
        }
        if (req.url === STATUS_ID) {
          return JSON.stringify(
            publicNote({
              id: STATUS_ID,
              attributedTo: REMOTE_ACTOR_ID,
              content: 'Main Post',
              replies: {
                id: `${STATUS_ID}/replies`,
                type: 'Collection',
                first: {
                  type: 'CollectionPage',
                  items: [
                    publicNote({
                      id: forgedOtherHostId,
                      attributedTo: REMOTE_ACTOR_ID,
                      inReplyTo: STATUS_ID
                    }),
                    publicNote({
                      id: forgedAuthorId,
                      attributedTo: VICTIM_ACTOR_ID,
                      inReplyTo: STATUS_ID
                    }),
                    publicNote({
                      id: genuineReplyId,
                      attributedTo: REMOTE_ACTOR_ID,
                      content: 'genuine',
                      inReplyTo: STATUS_ID
                    })
                  ]
                }
              }
            })
          )
        }
        return JSON.stringify({})
      })

      await runJob(STATUS_ID)

      expect(
        await database.getStatus({ statusId: forgedOtherHostId })
      ).toBeNull()
      expect(await database.getStatus({ statusId: forgedAuthorId })).toBeNull()
      expect(
        await database.getStatus({ statusId: genuineReplyId })
      ).not.toBeNull()
    })
  })
})
