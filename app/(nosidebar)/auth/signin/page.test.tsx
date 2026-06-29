import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/config')

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

// The sign-in forms are client components that pull in the better-auth client;
// stub them so importing the server page stays light. The logged-in redirect
// branch never renders them anyway.
vi.mock('./CredentialForm', () => ({ CredentialForm: () => null }))
vi.mock('./PasskeySigninButton', () => ({ PasskeySigninButton: () => null }))

const redirectMock = vi.fn((path: string) => path)
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path)
}))

const aSession = { user: { email: 'rider@example.com' } } as Awaited<
  ReturnType<typeof getServerAuthSession>
>
const anActor = { id: 'actor-id' } as Awaited<
  ReturnType<typeof getActorFromSession>
>

describe('/auth/signin already-authenticated resume', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getDatabase).mockReturnValue({} as ReturnType<typeof getDatabase>)
    vi.mocked(getConfig).mockReturnValue({
      auth: { enableCredential: true },
      registrationOpen: false
    } as ReturnType<typeof getConfig>)
    vi.mocked(getBaseURL).mockReturnValue('https://activities.local')
    vi.mocked(getActorFromSession).mockResolvedValue(anActor)
  })

  it('forwards an authenticated user to the resumed OAuth consent page instead of home', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({
      searchParams: Promise.resolve({
        response_type: 'code',
        client_id: 'phanpy',
        redirect_uri: 'https://phanpy.local/',
        scope: 'read write follow push',
        code_challenge: 'abc',
        code_challenge_method: 'S256'
      })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = redirectMock.mock.calls[0][0]
    expect(target.startsWith('/oauth/authorize?')).toBe(true)
    const query = new URLSearchParams(target.split('?')[1])
    expect(query.get('client_id')).toBe('phanpy')
    expect(query.get('code_challenge')).toBe('abc')
  })

  it('forwards an authenticated user to a safe redirectBack instead of home', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({
      searchParams: Promise.resolve({ redirectBack: '/fitness' })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock.mock.calls[0][0]).toBe('/fitness')
  })

  it('sends an authenticated user with no resume target to home', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({ searchParams: Promise.resolve({}) })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock.mock.calls[0][0]).toBe('/')
  })

  it('falls back to home when the authenticated session has no usable actor (avoids a /oauth/authorize redirect loop)', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)
    vi.mocked(getActorFromSession).mockResolvedValue(null)

    await Page({
      searchParams: Promise.resolve({
        response_type: 'code',
        client_id: 'phanpy',
        redirect_uri: 'https://phanpy.local/',
        scope: 'read'
      })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock.mock.calls[0][0]).toBe('/')
  })

  it('renders the sign-in form for a logged-out visitor (no redirect)', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)

    const element = await Page({
      searchParams: Promise.resolve({
        response_type: 'code',
        client_id: 'phanpy'
      })
    })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element).toBeTruthy()
  })
})
