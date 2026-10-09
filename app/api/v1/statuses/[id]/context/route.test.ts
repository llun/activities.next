import { NextRequest } from 'next/server'

import { GET } from '@/app/api/v1/statuses/[id]/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusContext } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

// No `deleteStatus` here on purpose: status deletion federates through
// SendDeleteNoteJob now, so the request path never reaches the sender.
vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/statuses/[id]', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
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
  })

  describe('full context tree', () => {
    it('returns the full ancestor chain root-first and recursive descendants', async () => {
      const rootId = `${ACTOR1_ID}/statuses/api-context-root`
      const childId = `${ACTOR1_ID}/statuses/api-context-child`
      const grandchildId = `${ACTOR1_ID}/statuses/api-context-grandchild`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'Root',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: childId,
        url: childId,
        actorId: ACTOR1_ID,
        text: 'Child',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: grandchildId,
        url: grandchildId,
        actorId: ACTOR1_ID,
        text: 'Grandchild',
        reply: childId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Context of the middle node: one ancestor (root), one descendant (grandchild).
      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(childId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(childId) }) }
      )
      expect(response.status).toBe(200)
      const context = await response.json()
      expect(context.ancestors.map((s: { id: string }) => s.id)).toEqual([
        await statusPublicId(database, rootId)
      ])
      expect(context.descendants.map((s: { id: string }) => s.id)).toEqual([
        await statusPublicId(database, grandchildId)
      ])
    })
  })

  describe('context visibility filtering', () => {
    it('excludes unreadable ancestors/descendants for a non-follower but keeps readable ones', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const publicRootId = `${ACTOR1_ID}/statuses/api-context-vis-root`
      const privateMidId = `${ACTOR1_ID}/statuses/api-context-vis-private-mid`
      const publicTargetId = `${ACTOR1_ID}/statuses/api-context-vis-target`
      const privateDescId = `${ACTOR1_ID}/statuses/api-context-vis-private-desc`
      const publicDescId = `${ACTOR1_ID}/statuses/api-context-vis-public-desc`

      await database.createNote({
        id: publicRootId,
        url: publicRootId,
        actorId: ACTOR1_ID,
        text: 'Public root ancestor',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      // A private node in the middle of the chain: must be traversed through but
      // excluded from the response.
      await database.createNote({
        id: privateMidId,
        url: privateMidId,
        actorId: ACTOR1_ID,
        text: 'Private mid ancestor',
        reply: publicRootId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.createNote({
        id: publicTargetId,
        url: publicTargetId,
        actorId: ACTOR1_ID,
        text: 'Public target',
        reply: privateMidId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: privateDescId,
        url: privateDescId,
        actorId: ACTOR1_ID,
        text: 'Private descendant',
        reply: publicTargetId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.createNote({
        id: publicDescId,
        url: publicDescId,
        actorId: ACTOR1_ID,
        text: 'Public descendant',
        reply: publicTargetId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(publicTargetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(publicTargetId) }) }
      )
      expect(response.status).toBe(200)
      const context = await response.json()

      const ancestorIds = context.ancestors.map((s: { id: string }) => s.id)
      const descendantIds = context.descendants.map((s: { id: string }) => s.id)

      // The private mid ancestor is excluded, but the public root above it
      // remains (the chain is not cut short).
      expect(ancestorIds).toContain(
        await statusPublicId(database, publicRootId)
      )
      expect(ancestorIds).not.toContain(
        await statusPublicId(database, privateMidId)
      )

      // The private descendant is excluded; the public sibling remains.
      expect(descendantIds).toContain(
        await statusPublicId(database, publicDescId)
      )
      expect(descendantIds).not.toContain(
        await statusPublicId(database, privateDescId)
      )
    })
  })

  describe('filter annotation on single status and context reads', () => {
    beforeAll(async () => {
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Spoilers',
        context: ['thread'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: [{ keyword: 'spoiler', wholeWord: false }]
      })
    })

    it('annotates the filtered field on a single status the active filter matches', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-match`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'this contains a spoiler about the ending',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.filtered).toHaveLength(1)
      expect(data.filtered[0].filter.title).toBe('Spoilers')
      expect(data.filtered[0].keyword_matches).toEqual(['spoiler'])
    })

    it('leaves filtered empty for a status the active filter does not match', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-nomatch`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'an ordinary post with nothing notable',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.filtered ?? []).toHaveLength(0)
    })

    it('does not annotate filtered for anonymous single status reads', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-anonymous`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'this contains a spoiler for anonymous readers',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.filtered ?? []).toHaveLength(0)
    })

    it('annotates filtered on matching ancestors and descendants in the context response', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const rootId = `${ACTOR1_ID}/statuses/api-filter-context-root`
      const targetId = `${ACTOR1_ID}/statuses/api-filter-context-target`
      const descId = `${ACTOR1_ID}/statuses/api-filter-context-desc`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'root status with a spoiler in it',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: targetId,
        url: targetId,
        actorId: ACTOR1_ID,
        text: 'target status replying to the root',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: descId,
        url: descId,
        actorId: ACTOR1_ID,
        text: 'descendant reply that also has a spoiler',
        reply: targetId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(targetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(targetId) }) }
      )

      expect(response.status).toBe(200)
      const context = await response.json()

      const rootPublicId = await statusPublicId(database, rootId)
      const ancestor = context.ancestors.find(
        (s: { id: string }) => s.id === rootPublicId
      )
      expect(ancestor.filtered).toHaveLength(1)
      expect(ancestor.filtered[0].filter.title).toBe('Spoilers')

      const descPublicId = await statusPublicId(database, descId)
      const descendant = context.descendants.find(
        (s: { id: string }) => s.id === descPublicId
      )
      expect(descendant.filtered).toHaveLength(1)
      expect(descendant.filtered[0].filter.title).toBe('Spoilers')
    })

    it('does not annotate filtered for anonymous context reads', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const rootId = `${ACTOR1_ID}/statuses/api-filter-context-anon-root`
      const targetId = `${ACTOR1_ID}/statuses/api-filter-context-anon-target`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'root status with a spoiler for anonymous context readers',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: targetId,
        url: targetId,
        actorId: ACTOR1_ID,
        text: 'target status replying to the anonymous root',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(targetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(targetId) }) }
      )

      expect(response.status).toBe(200)
      const context = await response.json()

      const rootPublicId = await statusPublicId(database, rootId)
      const ancestor = context.ancestors.find(
        (s: { id: string }) => s.id === rootPublicId
      )
      expect(ancestor.filtered ?? []).toHaveLength(0)
    })
  })
})
