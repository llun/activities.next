import { type ReactNode, isValidElement } from 'react'

import { DraftsPage } from './DraftsPage'
import Page, { dynamic, metadata } from './page'

const mockGetConfig = vi.fn()
const mockGetDatabase = vi.fn()
const mockGetServerAuthSession = vi.fn()
const mockGetActorFromSession = vi.fn()
const mockRedirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  })
)

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('@/lib/config', () => ({ getConfig: () => mockGetConfig() }))
vi.mock('@/lib/database', () => ({ getDatabase: () => mockGetDatabase() }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))
// The page forwards the profile; the full Actor shape is not the subject here.
vi.mock('@/lib/types/domain/actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/types/domain/actor')>()),
  getActorProfile: (value: { id: string; username: string }) => ({
    id: value.id,
    username: value.username
  })
}))
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const actor = {
  id: 'https://llun.test/users/me',
  username: 'me',
  domain: 'llun.test',
  account: { id: 'account-1' }
}

describe('drafts page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'))
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      mediaStorage: { type: 'fs' }
    })
    mockGetDatabase.mockReturnValue({})
    mockGetServerAuthSession.mockResolvedValue({ session: {} })
    mockGetActorFromSession.mockResolvedValue(actor)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('is dynamic and titled Drafts', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(metadata).toEqual({ title: 'Drafts' })
  })

  it('redirects to sign-in without an actor', async () => {
    mockGetActorFromSession.mockResolvedValue(undefined)

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT /auth/signin')
    expect(mockRedirect).toHaveBeenCalledWith('/auth/signin')
  })

  it('hands the client the host, the actor profile and a numeric currentTime', async () => {
    const element: ReactNode = await Page()

    expect(isValidElement(element)).toBe(true)
    const { type, props } = element as {
      type: unknown
      props: Record<string, unknown>
    }
    expect(type).toBe(DraftsPage)
    expect(props).toMatchObject({
      host: 'llun.test',
      profile: { id: actor.id, username: 'me' },
      // A number, never a Date: it crosses the server/client boundary.
      currentTime: new Date('2026-10-21T12:00:00.000Z').getTime(),
      isMediaUploadEnabled: true
    })
  })

  it('turns media upload off when no media storage is configured', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test' })

    const { props } = (await Page()) as { props: Record<string, unknown> }

    expect(props.isMediaUploadEnabled).toBe(false)
  })
})
