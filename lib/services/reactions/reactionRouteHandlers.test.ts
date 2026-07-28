import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { reactionWriteHandler } from '@/lib/services/reactions/reactionRouteHandlers'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'

const mockReactStatus = vi.fn()
const mockUnreactStatus = vi.fn()
const mockRefetchedStatusResponse = vi.fn()

vi.mock('@/lib/services/reactions/reactStatus', () => ({
  reactStatus: (...params: unknown[]) => mockReactStatus(...params),
  unreactStatus: (...params: unknown[]) => mockUnreactStatus(...params)
}))

vi.mock('@/lib/services/mastodon/statusActionResponse', () => ({
  refetchedStatusResponse: (...params: unknown[]) =>
    mockRefetchedStatusResponse(...params)
}))

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.PUT]
const database = {} as Database
const currentActor = { id: 'https://test.llun.dev/users/alice' } as Actor

const request = () =>
  new NextRequest('https://test.llun.dev/api/v1/pleroma/statuses/x/reactions/y')

const invoke = (
  mode: 'react' | 'unreact',
  params: { id: string; emoji?: string; name?: string }
) =>
  reactionWriteHandler(mode, CORS_HEADERS)(request(), {
    database,
    currentActor,
    params: Promise.resolve(params)
  })

describe('reactionWriteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReactStatus.mockResolvedValue({ ok: true, changed: true })
    mockUnreactStatus.mockResolvedValue({ ok: true, changed: true })
    mockRefetchedStatusResponse.mockResolvedValue(
      new Response(null, { status: 200 })
    )
  })

  // The Pleroma dialect names the segment `emoji`, glitch-soc names it `name`.
  // Both must reach the same service with the same arguments — that is the whole
  // point of serving two dialects over one store.
  it.each([
    {
      description: 'the pleroma :emoji segment',
      params: { id: 'status-1', emoji: '🔥' }
    },
    {
      description: 'the glitch :name segment',
      params: { id: 'status-1', name: '🔥' }
    }
  ])('reacts through $description', async ({ params }) => {
    const response = await invoke('react', params)

    expect(response.status).toBe(200)
    expect(mockReactStatus).toHaveBeenCalledWith({
      database,
      currentActor,
      statusId: expect.stringContaining('status-1'),
      name: '🔥'
    })
    expect(mockUnreactStatus).not.toHaveBeenCalled()
  })

  it('routes unreact to unreactStatus', async () => {
    await invoke('unreact', { id: 'status-1', emoji: '🔥' })

    expect(mockUnreactStatus).toHaveBeenCalledTimes(1)
    expect(mockReactStatus).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'an unreadable or missing status',
      reason: 'not-found',
      expected: 404
    },
    {
      description: 'an emoji this instance cannot render',
      reason: 'invalid-emoji',
      expected: 422
    }
  ])('answers $expected for $description', async ({ reason, expected }) => {
    mockReactStatus.mockResolvedValue({ ok: false, reason })

    const response = await invoke('react', { id: 'status-1', emoji: '🔥' })

    expect(response.status).toBe(expected)
    expect(mockRefetchedStatusResponse).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'an empty segment',
      params: { id: 'status-1', emoji: '   ' }
    },
    {
      description: 'an over-long segment',
      params: { id: 'status-1', emoji: 'x'.repeat(200) }
    },
    { description: 'a missing segment', params: { id: 'status-1' } }
  ])(
    'answers 422 for $description without calling the service',
    async ({ params }) => {
      const response = await invoke('react', params)

      expect(response.status).toBe(422)
      expect(mockReactStatus).not.toHaveBeenCalled()
    }
  )

  it('returns the refetched status so the caller sees its own reaction', async () => {
    await invoke('react', { id: 'status-1', emoji: '🔥' })

    expect(mockRefetchedStatusResponse).toHaveBeenCalledWith(
      expect.objectContaining({ database, currentActor })
    )
  })

  it('still returns the status when nothing changed', async () => {
    mockReactStatus.mockResolvedValue({ ok: true, changed: false })

    const response = await invoke('react', { id: 'status-1', emoji: '🔥' })

    expect(response.status).toBe(200)
    expect(mockRefetchedStatusResponse).toHaveBeenCalledTimes(1)
  })
})
