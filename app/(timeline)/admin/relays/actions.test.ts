import { beforeEach, describe, expect, it, vi } from 'vitest'

import { followRelay, unfollowRelay } from '@/lib/activities'
import { Relay } from '@/lib/types/domain/relay'

import {
  addRelayAction,
  removeRelayAction,
  subscribeRelayAction,
  unsubscribeRelayAction
} from './actions'

const mockDatabase = {
  createRelay: vi.fn(),
  getRelayById: vi.fn(),
  updateRelay: vi.fn(),
  deleteRelay: vi.fn(),
  getRelays: vi.fn()
}

vi.mock('@/lib/database', () => ({ getDatabase: () => mockDatabase }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({ id: 'admin' })
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue({
    id: 'https://local/users/__instance__',
    domain: 'local'
  })
}))
vi.mock('@/lib/activities', () => ({
  followRelay: vi.fn(),
  unfollowRelay: vi.fn()
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
}))

const buildRelay = (overrides: Partial<Relay> = {}): Relay => ({
  id: 'relay-1',
  inboxUrl: 'https://relay.example/inbox',
  actorId: null,
  state: 'idle',
  followActivityId: null,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const formDataOf = (entries: Record<string, string>): FormData => {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value)
  }
  return formData
}

const expectRedirectStatus = async (
  action: Promise<unknown>,
  status: string
) => {
  await expect(action).rejects.toThrow(
    `REDIRECT:/admin/relays?status=${status}`
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addRelayAction', () => {
  it('creates the relay, sends the Follow, and marks it pending when delivery succeeds', async () => {
    const relay = buildRelay()
    mockDatabase.createRelay.mockResolvedValue(relay)
    vi.mocked(followRelay).mockResolvedValue({
      followActivityId: 'https://local/follow-1',
      ok: true
    })

    await expectRedirectStatus(
      addRelayAction(formDataOf({ inboxUrl: 'https://relay.example/inbox' })),
      'relay-added'
    )

    expect(mockDatabase.createRelay).toHaveBeenCalledWith({
      inboxUrl: 'https://relay.example/inbox'
    })
    expect(followRelay).toHaveBeenCalledWith(
      relay,
      expect.objectContaining({ id: 'https://local/users/__instance__' })
    )
    expect(mockDatabase.updateRelay).toHaveBeenCalledWith({
      id: relay.id,
      state: 'pending',
      followActivityId: 'https://local/follow-1',
      lastError: null
    })
  })

  it('does not create a relay when the inbox URL is invalid', async () => {
    await expectRedirectStatus(
      addRelayAction(formDataOf({ inboxUrl: 'not-a-url' })),
      'invalid-inbox-url'
    )

    expect(mockDatabase.createRelay).not.toHaveBeenCalled()
    expect(followRelay).not.toHaveBeenCalled()
  })
})

describe('subscribeRelayAction', () => {
  it('sends the Follow for an existing relay', async () => {
    const relay = buildRelay({ state: 'idle' })
    mockDatabase.getRelayById.mockResolvedValue(relay)
    vi.mocked(followRelay).mockResolvedValue({
      followActivityId: 'https://local/follow-2',
      ok: true
    })

    await expectRedirectStatus(
      subscribeRelayAction(formDataOf({ id: 'relay-1' })),
      'relay-subscribing'
    )

    expect(followRelay).toHaveBeenCalled()
    expect(mockDatabase.updateRelay).toHaveBeenCalledWith({
      id: 'relay-1',
      state: 'pending',
      followActivityId: 'https://local/follow-2',
      lastError: null
    })
  })
})

describe('unsubscribeRelayAction', () => {
  it('sends the Undo and sets the relay back to idle', async () => {
    const relay = buildRelay({ state: 'accepted' })
    mockDatabase.getRelayById.mockResolvedValue(relay)
    vi.mocked(unfollowRelay).mockResolvedValue(true)

    await expectRedirectStatus(
      unsubscribeRelayAction(formDataOf({ id: 'relay-1' })),
      'relay-unsubscribed'
    )

    expect(unfollowRelay).toHaveBeenCalledWith(
      relay,
      expect.objectContaining({ id: 'https://local/users/__instance__' })
    )
    expect(mockDatabase.updateRelay).toHaveBeenCalledWith({
      id: 'relay-1',
      state: 'idle',
      followActivityId: null
    })
  })
})

describe('removeRelayAction', () => {
  it('sends the Undo for an accepted relay and deletes it', async () => {
    const relay = buildRelay({ state: 'accepted' })
    mockDatabase.getRelayById.mockResolvedValue(relay)
    vi.mocked(unfollowRelay).mockResolvedValue(true)

    await expectRedirectStatus(
      removeRelayAction(formDataOf({ id: 'relay-1' })),
      'relay-removed'
    )

    expect(unfollowRelay).toHaveBeenCalledWith(
      relay,
      expect.objectContaining({ id: 'https://local/users/__instance__' })
    )
    expect(mockDatabase.deleteRelay).toHaveBeenCalledWith({ id: 'relay-1' })
  })

  it('deletes an idle relay without sending an Undo', async () => {
    const relay = buildRelay({ state: 'idle' })
    mockDatabase.getRelayById.mockResolvedValue(relay)

    await expectRedirectStatus(
      removeRelayAction(formDataOf({ id: 'relay-1' })),
      'relay-removed'
    )

    expect(unfollowRelay).not.toHaveBeenCalled()
    expect(mockDatabase.deleteRelay).toHaveBeenCalledWith({ id: 'relay-1' })
  })
})
