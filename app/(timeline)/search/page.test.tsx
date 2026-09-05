import { Suspense, isValidElement } from 'react'

import { Actor } from '@/lib/types/domain/actor'

import { SearchPageClient } from './SearchPageClient'
import { SearchLoading } from './loading'
import Page from './page'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mockRedirect(path)
    throw new Error(`REDIRECT:${path}`)
  }
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

const mockGetDatabase = vi.fn()
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

const mockGetServerAuthSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: () => mockGetActorFromSession()
}))

describe('search page', () => {
  const fakeActor: Actor = {
    id: 'https://example.com/users/alice',
    username: 'alice',
    domain: 'example.com',
    name: 'Alice',
    summary: 'Hello world',
    followersUrl: 'https://example.com/users/alice/followers',
    inboxUrl: 'https://example.com/users/alice/inbox',
    sharedInboxUrl: 'https://example.com/inbox',
    publicKey: 'pubkey',
    followingCount: 10,
    followersCount: 20,
    statusCount: 30,
    lastStatusAt: 1000,
    createdAt: 1000,
    updatedAt: 1000
  }

  const fakeDatabase = {
    getActorSettings: vi.fn().mockResolvedValue({ postLineLimit: 5 })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      host: 'example.com',
      mediaStorage: null
    })
    mockGetDatabase.mockReturnValue(fakeDatabase)
  })

  it('redirects unauthenticated sessions to /auth/signin', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)

    await expect(Page()).rejects.toThrow('REDIRECT:/auth/signin')
    expect(mockRedirect).toHaveBeenCalledWith('/auth/signin')
  })

  it('renders SearchPageClient wrapped in Suspense with SearchLoading fallback', async () => {
    mockGetServerAuthSession.mockResolvedValue({ user: { id: 'user_1' } })
    mockGetActorFromSession.mockResolvedValue(fakeActor)

    const rendered = await Page()
    expect(isValidElement(rendered)).toBe(true)
    expect(rendered.type).toBe(Suspense)
    expect(rendered.props.fallback).toEqual(<SearchLoading />)

    const child = rendered.props.children
    expect(isValidElement(child)).toBe(true)
    expect(child.type).toBe(SearchPageClient)
    expect(child.props.host).toBe('example.com')
    expect(child.props.currentActor.username).toBe('alice')
  })
})
