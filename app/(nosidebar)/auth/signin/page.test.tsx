import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

// The page reads the sign-ups of the domain it is visited on, which needs a
// request; these tests render the page directly, so answer for the primary.
vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn(async () => ({
    domain: 'test.llun.dev',
    displayName: 'Activities',
    source: 'primary',
    open: false,
    allowEmails: []
  }))
}))

// The heading names the domain the page is visited on.
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

const anIdentity = (name: string, domain = 'test.llun.dev') => ({
  domain,
  source: 'primary' as const,
  name,
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null
})

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
    vi.mocked(getVisitedDomainIdentity).mockReset()
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(
      anIdentity('Activities.next')
    )
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

  it('renders the sign-in form for an authenticated user when force_login is true', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    const element = await Page({
      searchParams: Promise.resolve({
        redirectBack: '/oauth/authorize?client_id=phanpy&scope=read',
        force_login: 'true'
      })
    })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element).toBeTruthy()
  })

  it('still resumes an authenticated user when force_login is the falsy value "false"', async () => {
    // force_login='false' is a legitimate Mastodon value meaning "do NOT force
    // re-login": Booleanish parses it as success:true/data:false, so the page
    // must still auto-resume. Pins that the gate reads `.data`, not just
    // `.success` (which absent-param and 'true' cases can't distinguish).
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({
      searchParams: Promise.resolve({
        redirectBack: '/fitness',
        force_login: 'false'
      })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock.mock.calls[0][0]).toBe('/fitness')
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

describe('/auth/signin heading', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getDatabase).mockReturnValue({} as ReturnType<typeof getDatabase>)
    vi.mocked(getConfig).mockReturnValue({
      auth: { enableCredential: true },
      serviceName: 'Env name'
    } as ReturnType<typeof getConfig>)
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    vi.mocked(getVisitedDomainIdentity).mockReset()
  })

  const render = async () =>
    (await Page({ searchParams: Promise.resolve({}) })) as {
      props: { title: string; children: { props: { providerName: string } } }
    }

  // The visited domain's name (Admin › Domains, else Admin › Instance), not
  // ACTIVITIES_SERVICE_NAME, which only seeds the server setting.
  it.each([
    {
      description: 'the primary',
      name: 'Activities.next',
      domain: 'test.llun.dev',
      expected: 'Activities.next'
    },
    {
      description: 'a served domain',
      name: 'Run Club',
      domain: 'run.example',
      expected: 'Run Club'
    },
    {
      description: 'a domain with a blank name',
      name: '',
      domain: 'run.example',
      expected: 'run.example'
    }
  ])('names $description', async ({ name, domain, expected }) => {
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(
      anIdentity(name, domain)
    )

    const element = await render()

    expect(element.props.title).toBe(`Sign in to ${expected}`)
    expect(element.props.children.props.providerName).toBe(expected)
  })
})
