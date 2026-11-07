import { NextRequest } from 'next/server'

import { blockActor } from '@/lib/actions/blockActor'
import { followActor } from '@/lib/actions/followActor'
import { unblockActor } from '@/lib/actions/unblockActor'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import type { Actor } from '@/lib/types/domain/actor'
import { BLUESKY_BRIDGE_ACTOR_ID } from '@/lib/utils/blueskySharing'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { POST } from './route'

vi.mock('@/lib/actions/blockActor', () => ({ blockActor: vi.fn() }))
vi.mock('@/lib/actions/followActor', () => ({ followActor: vi.fn() }))
vi.mock('@/lib/actions/unblockActor', () => ({ unblockActor: vi.fn() }))
vi.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: vi.fn()
}))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))
vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowActorDomains: [] })
}))
vi.mock('@/lib/database', () => ({ getDatabase: () => database }))

const database = {
  getActorFromUsername: vi.fn(),
  getActorFromId: vi.fn(),
  getBlock: vi.fn(),
  getAcceptedOrRequestedFollow: vi.fn()
}
const actor = {
  id: 'https://personal.example/users/alice',
  username: 'alice',
  domain: 'personal.example',
  name: 'Alice Example',
  iconUrl: 'avatar'
} as Actor
const context = { params: Promise.resolve({}) }
const request = (body: unknown, origin = 'https://llun.test') =>
  new NextRequest('https://llun.test/api/v1/accounts/bluesky-sharing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

describe('POST /api/v1/accounts/bluesky-sharing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { email: 'alice@example.com' }
    } as never)
    vi.mocked(getActorFromSession).mockResolvedValue(actor)
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    database.getActorFromUsername.mockResolvedValue({
      id: BLUESKY_BRIDGE_ACTOR_ID
    })
    vi.mocked(followActor).mockResolvedValue({
      type: 'ok',
      targetActorId: BLUESKY_BRIDGE_ACTOR_ID
    })
    vi.mocked(blockActor).mockResolvedValue({
      type: 'ok',
      targetActorId: BLUESKY_BRIDGE_ACTOR_ID
    })
    vi.mocked(unblockActor).mockResolvedValue(true)
  })

  it.each(['not-json', {}, { enabled: 'true' }, { enabled: null }])(
    'rejects invalid input %s before mutation',
    async (body) => {
      const response = await POST(request(body), context)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Bad Request' })
      expect(followActor).not.toHaveBeenCalled()
      expect(blockActor).not.toHaveBeenCalled()
    }
  )

  it('follows with the current actor’s own id and returns relationship status', async () => {
    database.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: 'Requested'
    })
    const response = await POST(request({ enabled: true }), context)
    expect(response.status).toBe(200)
    expect(followActor).toHaveBeenCalledWith({
      database,
      currentActor: actor,
      requestedActorId: BLUESKY_BRIDGE_ACTOR_ID
    })
    expect(await response.json()).toMatchObject({
      status: 'Setting up',
      handle: 'alice.personal.example.ap.brid.gy'
    })
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })

  it('unblocks before following', async () => {
    database.getBlock.mockResolvedValue({ id: 'block' })
    await POST(request({ enabled: true }), context)
    expect(unblockActor).toHaveBeenCalledWith({
      database,
      currentActor: actor,
      targetActorId: BLUESKY_BRIDGE_ACTOR_ID
    })
    expect(vi.mocked(unblockActor).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(followActor).mock.invocationCallOrder[0]
    )
  })

  it('discovers an unstored bridge through WebFinger', async () => {
    database.getActorFromUsername.mockResolvedValue(null)
    vi.mocked(getWebfingerSelf).mockResolvedValue(BLUESKY_BRIDGE_ACTOR_ID)
    expect((await POST(request({ enabled: true }), context)).status).toBe(200)
    expect(getWebfingerSelf).toHaveBeenCalledWith({
      account: 'bsky.brid.gy@bsky.brid.gy'
    })
  })

  it.each([null, 'https://other.example/actor'])(
    'reports failed or unexpected discovery (%s) without following',
    async (id) => {
      database.getActorFromUsername.mockResolvedValue(null)
      vi.mocked(getWebfingerSelf).mockResolvedValue(id)
      const response = await POST(request({ enabled: true }), context)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: expect.stringContaining('unreachable')
      })
      expect(followActor).not.toHaveBeenCalled()
    }
  )

  it.each([
    { iconUrl: '' },
    { name: '' },
    { name: 'ALICE' },
    { username: '_alice' }
  ])('revalidates profile requirements %s on the server', async (invalid) => {
    vi.mocked(getActorFromSession).mockResolvedValue({ ...actor, ...invalid })
    const response = await POST(request({ enabled: true }), context)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: expect.any(String) })
    expect(followActor).not.toHaveBeenCalled()
    expect(unblockActor).not.toHaveBeenCalled()
  })

  it('rejects enabling when federation is disabled', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const response = await POST(request({ enabled: true }), context)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: expect.stringContaining('does not federate')
    })
    expect(followActor).not.toHaveBeenCalled()
  })

  it('blocks to turn off even if requirements and federation policy now fail', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      ...actor,
      name: '',
      iconUrl: ''
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const response = await POST(request({ enabled: false }), context)
    expect(response.status).toBe(200)
    expect(blockActor).toHaveBeenCalledWith({
      database,
      currentActor: expect.objectContaining({ id: actor.id }),
      requestedActorId: BLUESKY_BRIDGE_ACTOR_ID
    })
    expect(followActor).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ status: 'Off' })
  })

  it.each(['not-found', 'forbidden', 'moved'] as const)(
    'reports unsuccessful follow (%s) as an inline-ready error',
    async (type) => {
      vi.mocked(followActor).mockResolvedValue({ type })
      const response = await POST(request({ enabled: true }), context)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: expect.stringContaining('Unable to follow')
      })
    }
  )

  it('handles a bridge failure without exposing a stack', async () => {
    vi.mocked(followActor).mockRejectedValue(new Error('private failure'))
    const response = await POST(request({ enabled: true }), context)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Unable to reach the Bluesky bridge. Please try again.'
    })
  })

  it('keeps session and same-origin guards', async () => {
    expect(
      (await POST(request({ enabled: true }, 'https://evil.example'), context))
        .status
    ).toBe(403)
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    expect((await POST(request({ enabled: true }), context)).status).toBe(307)
    expect(followActor).not.toHaveBeenCalled()
  })

  it.each([
    { suspendedAt: 1 },
    { account: { disabledAt: 1 } },
    { account: { verificationCode: 'pending', emailVerified: false } }
  ])('rejects an actor who cannot act (%s)', async (state) => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      ...actor,
      ...state
    } as Actor)
    expect((await POST(request({ enabled: true }), context)).status).toBe(403)
    expect(followActor).not.toHaveBeenCalled()
    expect(blockActor).not.toHaveBeenCalled()
  })
})
