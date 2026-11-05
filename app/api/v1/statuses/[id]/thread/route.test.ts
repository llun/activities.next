import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { queueThreadGapBackfill } from '@/lib/services/statuses/parentBackfill'
import {
  THREAD_MAX_ANCESTORS_LIMIT,
  THREAD_MAX_DESCENDANTS_LIMIT,
  THREAD_SIGNED_OUT_MAX_ANCESTORS_LIMIT,
  THREAD_SIGNED_OUT_MAX_DESCENDANTS_LIMIT
} from '@/lib/services/statuses/threadPageLimits'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { GET, resetThreadRateLimitsForTesting } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
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

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockTrustProxyIpHeaders = vi.fn(() => false)
vi.mock('@/lib/config/trustProxyIpHeaders', async () => ({
  getTrustProxyIpHeadersConfig: () => mockTrustProxyIpHeaders(),
  getTrustProxyIpHeaderConfig: () => null
}))

// The real loader, spied on to see the limits the route hands it.
vi.mock('@/lib/services/statuses/getStatusContext', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/statuses/getStatusContext')
    >()
  return { ...actual, getStatusContext: vi.fn(actual.getStatusContext) }
})
const mockGetStatusContext = vi.mocked(getStatusContext)

vi.mock('@/lib/services/statuses/parentBackfill', async () => ({
  queueThreadGapBackfill: vi.fn(async () => false)
}))
const mockQueueThreadGapBackfill = vi.mocked(queueThreadGapBackfill)
const MISSING_PARENT_ID = 'https://remote.example/statuses/missing-parent'
// The real thread, reported as stopping at a parent this instance lacks.
const withMissingParent = async (
  params: Parameters<typeof getStatusContext>[0]
) => {
  const actual = await vi.importActual<
    typeof import('@/lib/services/statuses/getStatusContext')
  >('@/lib/services/statuses/getStatusContext')
  return {
    ...(await actual.getStatusContext(params)),
    missingParentId: MISSING_PARENT_ID
  }
}

const ROOT_ID = `${ACTOR1_ID}/statuses/thread-route-root`
const MIDDLE_ID = `${ACTOR1_ID}/statuses/thread-route-middle`
const OPENED_ID = `${ACTOR1_ID}/statuses/thread-route-opened`
const PUBLIC_REPLY_ID = `${ACTOR1_ID}/statuses/thread-route-public-reply`
const FOLLOWERS_REPLY_ID = `${ACTOR1_ID}/statuses/thread-route-followers-reply`
const FOLLOWERS_ONLY_ID = `${ACTOR1_ID}/statuses/thread-route-followers-only`

const requestThread = (statusId: string, query = '', ip?: string) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${toIdPathSegment(statusId)}/thread${query}`,
      ip ? { headers: { 'x-real-ip': ip } } : undefined
    ),
    { params: Promise.resolve({ id: toIdPathSegment(statusId) }) }
  )

describe('GET /api/v1/statuses/[id]/thread', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    const note = (id: string, reply: string, to: string[], text: string) =>
      database.createNote({
        id,
        url: id,
        actorId: ACTOR1_ID,
        text,
        reply,
        to,
        cc: []
      })
    await note(ROOT_ID, '', [ACTIVITY_STREAM_PUBLIC], 'Root')
    await note(MIDDLE_ID, ROOT_ID, [ACTIVITY_STREAM_PUBLIC], 'Middle')
    await note(OPENED_ID, MIDDLE_ID, [ACTIVITY_STREAM_PUBLIC], 'Opened')
    await note(PUBLIC_REPLY_ID, OPENED_ID, [ACTIVITY_STREAM_PUBLIC], 'Public')
    await note(
      FOLLOWERS_REPLY_ID,
      OPENED_ID,
      [ACTOR1_FOLLOWER_URL],
      'Followers only reply'
    )
    await note(FOLLOWERS_ONLY_ID, '', [ACTOR1_FOLLOWER_URL], 'Followers only')
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetThreadRateLimitsForTesting()
    mockTrustProxyIpHeaders.mockReturnValue(false)
    mockGetServerSession.mockResolvedValue(null)
  })

  it('answers the domain statuses of the thread, as the page renders them', async () => {
    const response = await requestThread(OPENED_ID)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ancestors.map((s: { id: string }) => s.id)).toEqual([
      ROOT_ID,
      MIDDLE_ID
    ])
    expect(body.descendants.map((s: { id: string }) => s.id)).toEqual([
      PUBLIC_REPLY_ID
    ])
    expect(body.ancestors[0]).toMatchObject({
      type: 'Note',
      text: 'Root',
      actorId: ACTOR1_ID
    })
    // Dates go out as the page serializes them (`cleanJson`): numbers.
    expect(typeof body.ancestors[0].createdAt).toBe('number')
    expect(body).toMatchObject({
      hasMoreAncestors: false,
      hasMoreDescendants: false
    })
  })

  it('gives a signed-out viewer public statuses only', async () => {
    const response = await requestThread(OPENED_ID)
    const body = await response.json()
    expect(body.descendants.map((s: { id: string }) => s.id)).not.toContain(
      FOLLOWERS_REPLY_ID
    )
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({ currentActor: null })
    )
  })

  it('queues the fetch of a missing parent for a signed-in viewer, as the context route does', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetStatusContext.mockImplementationOnce(withMissingParent)
    const response = await requestThread(OPENED_ID)
    expect(response.status).toBe(200)
    expect(mockQueueThreadGapBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ missingParentId: MISSING_PARENT_ID })
    )
    // Server-side only: the id never goes out.
    expect(await response.json()).not.toHaveProperty('missingParentId')
  })

  it('queues nothing for a signed-out read', async () => {
    mockGetStatusContext.mockImplementationOnce(withMissingParent)
    const response = await requestThread(OPENED_ID)
    expect(response.status).toBe(200)
    expect(mockQueueThreadGapBackfill).not.toHaveBeenCalled()
  })

  it('gives a signed-in viewer what they may read', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await requestThread(OPENED_ID)
    const body = await response.json()
    expect(body.descendants.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining([PUBLIC_REPLY_ID, FOLLOWERS_REPLY_ID])
    )
  })

  it('passes the requested limits and reports what they leave out', async () => {
    const response = await requestThread(
      OPENED_ID,
      '?ancestors_limit=1&descendants_limit=120'
    )
    const body = await response.json()
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({ ancestorsLimit: 1, descendantsLimit: 120 })
    )
    expect(body.ancestors.map((s: { id: string }) => s.id)).toEqual([MIDDLE_ID])
    expect(body.hasMoreAncestors).toBe(true)
  })

  it('caps a signed-in request at the last step', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await requestThread(
      OPENED_ID,
      '?ancestors_limit=100000&descendants_limit=99999999'
    )
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ancestorsLimit: THREAD_MAX_ANCESTORS_LIMIT,
        descendantsLimit: THREAD_MAX_DESCENDANTS_LIMIT
      })
    )
  })

  it('caps a signed-out request at the middle step', async () => {
    expect(THREAD_SIGNED_OUT_MAX_ANCESTORS_LIMIT).toBe(120)
    expect(THREAD_SIGNED_OUT_MAX_DESCENDANTS_LIMIT).toBe(200)
    await requestThread(
      OPENED_ID,
      `?ancestors_limit=${THREAD_MAX_ANCESTORS_LIMIT}&descendants_limit=99999999`
    )
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({
        currentActor: null,
        ancestorsLimit: THREAD_SIGNED_OUT_MAX_ANCESTORS_LIMIT,
        descendantsLimit: THREAD_SIGNED_OUT_MAX_DESCENDANTS_LIMIT
      })
    )
  })

  it('keeps a signed-out request under the cap as asked', async () => {
    await requestThread(OPENED_ID, '?ancestors_limit=40&descendants_limit=200')
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({ ancestorsLimit: 40, descendantsLimit: 200 })
    )
  })

  it('takes the first step for a missing or malformed limit and at least 1', async () => {
    await requestThread(OPENED_ID, '?ancestors_limit=abc&descendants_limit=-5')
    expect(mockGetStatusContext).toHaveBeenCalledWith(
      expect.objectContaining({ ancestorsLimit: 40, descendantsLimit: 1 })
    )
  })

  it('answers 404 with an error body for an unknown status', async () => {
    const response = await requestThread(
      `${ACTOR1_ID}/statuses/thread-route-missing`
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  it('answers 404 to a signed-out viewer for a followers-only status', async () => {
    const response = await requestThread(FOLLOWERS_ONLY_ID)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  it('answers 404 to a signed-in viewer who may not read the status', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })
    const response = await requestThread(FOLLOWERS_ONLY_ID)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  it('limits how often one signed-out address may ask', async () => {
    mockTrustProxyIpHeaders.mockReturnValue(true)
    for (let i = 0; i < 30; i++) {
      expect((await requestThread(OPENED_ID, '', '203.0.113.7')).status).toBe(
        200
      )
    }
    const limited = await requestThread(OPENED_ID, '', '203.0.113.7')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'Too Many Requests' })
    // Another address still gets through.
    expect((await requestThread(OPENED_ID, '', '203.0.113.8')).status).toBe(200)
  })
})
