/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Actor } from '@/lib/types/domain/actor'
import { Client } from '@/lib/types/oauth2/client'

import { AuthorizeCard, getConsentRedirectUrl } from './AuthorizeCard'
import { SearchParams } from './types'

const mockPush = vi.fn()
const mockNavigate = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))

const client: Client = {
  id: 'db-client-id',
  clientId: 'phanpy-client',
  clientSecret: null,
  name: 'Phanpy',
  redirectUris: ['https://phanpy.local/'],
  scopes: ['read', 'write', 'follow', 'push'],
  website: 'https://phanpy.local',
  requirePKCE: true,
  disabled: false,
  createdAt: 0,
  updatedAt: 0
}

const actors = [
  {
    id: 'https://activities.local/users/llun',
    username: 'llun',
    domain: 'activities.local',
    name: 'llun',
    iconUrl: null
  }
] as unknown as Actor[]

const alternateActors = [
  actors[0],
  {
    id: 'https://activities.local/users/testactor2',
    username: 'testactor2',
    domain: 'activities.local',
    name: 'testactor2',
    iconUrl: null
  }
] as unknown as Actor[]

const signedSearchParams: SearchParams = {
  client_id: 'phanpy-client',
  redirect_uri: 'not-a-url',
  response_type: 'code',
  scope: 'read write follow push',
  state: 'return-state',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  sig: 'signed-query',
  exp: '1779800000'
}

// An OIDC authentication request is identified by the `openid` scope (OIDC
// Core §3.1.2.1). The consent screen shows the account identity instead of an
// actor picker for these, because the OIDC subject is the owning account.
const oidcSearchParams: SearchParams = {
  ...signedSearchParams,
  scope: 'openid profile email'
}

const account = {
  email: 'rider@example.com',
  name: 'Ride',
  iconUrl: null
}

describe('AuthorizeCard', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockNavigate.mockReset()
    window.history.replaceState({}, '', '/')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }) as jest.Mock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits selected Phanpy scopes with the signed Better Auth query', async () => {
    window.history.replaceState(
      {},
      '',
      '/oauth/authorize?' +
        'response_type=code' +
        '&client_id=phanpy-client' +
        '&redirect_uri=not-a-url' +
        '&scope=read+write+follow+push' +
        '&state=return-state' +
        '&code_challenge=challenge' +
        '&code_challenge_method=S256' +
        '&exp=1779800000' +
        '&ba_iat=1779800000000' +
        '&ba_pl=payload' +
        '&sig=signed-query'
    )

    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    expect(screen.getByLabelText('read')).toBeChecked()
    expect(screen.getByLabelText('write')).toBeChecked()
    expect(screen.getByLabelText('follow')).toBeChecked()
    expect(screen.getByLabelText('push')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    const consentCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/auth/oauth2/consent'
    )
    const [, requestInit] = consentCall
    const body = JSON.parse(requestInit.body)

    expect(body.accept).toBe(true)
    expect(body.scope).toBe('read write follow push')

    const oauthQuery = new URLSearchParams(body.oauth_query)
    expect(oauthQuery.get('client_id')).toBe('phanpy-client')
    expect(oauthQuery.get('scope')).toBe('read write follow push')
    expect(oauthQuery.get('state')).toBe('return-state')
    expect(oauthQuery.get('code_challenge')).toBe('challenge')
    expect(oauthQuery.get('code_challenge_method')).toBe('S256')
    expect(oauthQuery.get('ba_iat')).toBe('1779800000000')
    expect(oauthQuery.get('ba_pl')).toBe('payload')
    expect(oauthQuery.get('sig')).toBe('signed-query')
    expect(oauthQuery.get('exp')).toBe('1779800000')
    expect(body.oauth_query).toBe(window.location.search.slice(1))
  })

  it('persists the selected actor before approving consent', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={alternateActors}
        currentActorId="https://activities.local/users/testactor2"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))

    const [switchUrl, switchRequestInit] = (global.fetch as jest.Mock).mock
      .calls[0]
    expect(switchUrl).toBe('/api/v1/actors/switch')
    expect(switchRequestInit).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'https://activities.local/users/testactor2'
        })
      })
    )

    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      '/api/auth/oauth2/consent'
    )
  })

  it('reads Better Auth consent redirect URLs from url responses', () => {
    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: 'https://phanpy.local/?code=oauth-code'
      })
    ).toBe('https://phanpy.local/?code=oauth-code')

    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: 'https://phanpy.local/?code=oauth-code',
        redirect_uri: 'https://legacy.example/?code=legacy-code'
      })
    ).toBe('https://phanpy.local/?code=oauth-code')

    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: 'javascript:alert(1)'
      })
    ).toBeUndefined()

    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: '//phanpy.local/?code=oauth-code'
      })
    ).toBeUndefined()

    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: '/oauth/callback?code=oauth-code'
      })
    ).toBeUndefined()

    expect(
      getConsentRedirectUrl({
        redirect: true,
        url: 'mastodon://joinmastodon.org/oauth?code=oauth-code'
      })
    ).toBe('mastodon://joinmastodon.org/oauth?code=oauth-code')
  })

  it('submits denial with the signed Better Auth query and follows url redirects', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://phanpy.local/?error=access_denied&state=return-state'
      })
    })

    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(requestInit.body)

    expect(body.accept).toBe(false)
    expect(body.oauth_query).toBe(
      'response_type=code' +
        '&client_id=phanpy-client' +
        '&redirect_uri=not-a-url' +
        '&scope=read+write+follow+push' +
        '&state=return-state' +
        '&code_challenge=challenge' +
        '&code_challenge_method=S256' +
        '&exp=1779800000' +
        '&sig=signed-query'
    )
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'https://phanpy.local/?error=access_denied&state=return-state'
      )
    })
  })

  it('shows a denying label on the deny button only while denial is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    ;(global.fetch as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )

    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Denying...' })
      ).toBeInTheDocument()
    })
    // The approve button keeps its label, never shows the denial state, and is
    // disabled while the denial is in flight.
    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeInTheDocument()
    expect(approveButton).toBeDisabled()

    resolveFetch({
      ok: true,
      json: async () => ({
        url: 'https://phanpy.local/?error=access_denied&state=return-state'
      })
    })

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })
  })

  it('shows an approving label on the approve button only while approval is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    ;(global.fetch as jest.Mock)
      // persistSelectedActor() posts to /api/v1/actors/switch first.
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // The consent request stays pending so the loading label is observable.
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve
        })
      )

    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Approving...' })
      ).toBeInTheDocument()
    })
    // The deny button keeps its label and is disabled while approval is in
    // flight.
    const denyButton = screen.getByRole('button', { name: 'Deny' })
    expect(denyButton).toBeInTheDocument()
    expect(denyButton).toBeDisabled()

    resolveFetch({
      ok: true,
      json: async () => ({
        url: 'https://phanpy.local/?code=auth-code&state=return-state'
      })
    })

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })
  })

  it('falls back to access_denied redirect when denial has no redirect URL', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={{
          ...signedSearchParams,
          redirect_uri: 'https://phanpy.local/'
        }}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'https://phanpy.local/?error=access_denied&state=return-state'
      )
    })
  })

  it('shows the account identity and hides the actor selector for OIDC requests', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={alternateActors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // The OIDC identity caption and the account identity are shown.
    expect(screen.getByText('Signed in as')).toBeInTheDocument()
    expect(screen.getByText('rider@example.com')).toBeInTheDocument()
    expect(screen.getByText('Ride')).toBeInTheDocument()
    // The multi-actor "Authorize as" picker must NOT appear for an OIDC login:
    // the OIDC subject is the owning account, so persona choice is irrelevant.
    expect(screen.queryByText('Authorize as')).not.toBeInTheDocument()
    // OIDC scopes are still listed and checked.
    expect(screen.getByLabelText('openid')).toBeChecked()
    expect(screen.getByLabelText('profile')).toBeChecked()
    expect(screen.getByLabelText('email')).toBeChecked()
  })

  it('shows the account identity for OIDC even with a single actor', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    expect(screen.getByText('rider@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Authorize as')).not.toBeInTheDocument()
  })

  it('keeps the actor selector and hides the account identity for non-OIDC requests', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={alternateActors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    expect(screen.getByText('Authorize as')).toBeInTheDocument()
    expect(screen.queryByText('rider@example.com')).not.toBeInTheDocument()
  })

  it('submits the OIDC scopes and persists the current actor on approve', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const consentCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/auth/oauth2/consent'
    )
    const body = JSON.parse(consentCall[1].body)
    expect(body.accept).toBe(true)
    expect(body.scope).toBe('openid profile email')

    // persistSelectedActor() still runs in OIDC mode: it switches to (and so
    // persists) the current actor before consent, even though the picker is
    // hidden. The switch is the first fetch call.
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      '/api/v1/actors/switch'
    )
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    ).toEqual({ actorId: 'https://activities.local/users/llun' })
  })

  it('renders the email once as the identity when the account has no name (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{ email: 'rider@example.com', name: null, iconUrl: null }}
        navigate={mockNavigate}
      />
    )

    // With no name, the email is the primary identity and must not be
    // duplicated as a secondary line.
    expect(screen.getAllByText('rider@example.com')).toHaveLength(1)
  })

  it('treats a whitespace-only account name as no name (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{ email: 'rider@example.com', name: '   ', iconUrl: null }}
        navigate={mockNavigate}
      />
    )

    expect(screen.getAllByText('rider@example.com')).toHaveLength(1)
  })

  it('does not treat a scope token merely containing "openid" as OIDC', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={{ ...oidcSearchParams, scope: 'openidfoo profile email' }}
        actors={alternateActors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // 'openidfoo' is not the 'openid' token, so this stays the Mastodon path:
    // the actor picker shows and the account-identity block does not.
    expect(screen.getByText('Authorize as')).toBeInTheDocument()
    expect(screen.queryByText('Signed in as')).not.toBeInTheDocument()
    expect(screen.queryByText('rider@example.com')).not.toBeInTheDocument()
  })

  it('derives the avatar fallback initial from the display name, not the email (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{ email: 'rider@example.com', name: 'Zoe', iconUrl: null }}
        navigate={mockNavigate}
      />
    )

    // With no iconUrl the Avatar shows a fallback initial. It must come from
    // the display name ('Zoe' -> 'Z'), not the email ('rider@…' -> 'R').
    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(screen.queryByText('R')).not.toBeInTheDocument()
  })

  it('derives a Unicode-safe avatar initial for a non-BMP name (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{ email: 'fox@example.com', name: '🦊 Ranger', iconUrl: null }}
        navigate={mockNavigate}
      />
    )

    // The initial is the whole leading code point, not a broken surrogate half
    // (the pre-fix `name[0]` would have sliced the emoji in two).
    expect(screen.getByText('🦊')).toBeInTheDocument()
  })

  it('does not duplicate the email when the account name equals the email (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{
          email: 'rider@example.com',
          name: 'rider@example.com',
          iconUrl: null
        }}
        navigate={mockNavigate}
      />
    )

    // When the display name IS the email, the email must still render exactly
    // once (the secondary line is suppressed), not twice.
    expect(screen.getAllByText('rider@example.com')).toHaveLength(1)
  })

  it('does not duplicate the email when the name matches it case-insensitively (OIDC)', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={{
          email: 'rider@example.com',
          name: 'Rider@Example.com',
          iconUrl: null
        }}
        navigate={mockNavigate}
      />
    )

    // The display name differs from the email only by case; emails are
    // case-insensitive, so the secondary email line is still suppressed.
    expect(screen.getAllByText('Rider@Example.com')).toHaveLength(1)
    expect(screen.queryByText('rider@example.com')).not.toBeInTheDocument()
  })

  it('locks the openid scope so it cannot be stripped from an OIDC consent', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // openid is the OIDC subject scope (gates id_token issuance) and must be
    // locked: checked and not user-toggleable.
    const openidCheckbox = screen.getByLabelText('openid')
    expect(openidCheckbox).toBeChecked()
    expect(openidCheckbox).toBeDisabled()
    // Optional OIDC scopes stay user-controllable.
    expect(screen.getByLabelText('profile')).toBeEnabled()
    expect(screen.getByLabelText('email')).toBeEnabled()

    // Unchecking the optional scopes must not strip openid from the consent.
    fireEvent.click(screen.getByLabelText('profile'))
    fireEvent.click(screen.getByLabelText('email'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const consentCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/auth/oauth2/consent'
    )
    const submittedScopes: string[] = JSON.parse(
      consentCall[1].body
    ).scope.split(' ')
    expect(submittedScopes).toContain('openid')
    expect(submittedScopes).not.toContain('profile')
    expect(submittedScopes).not.toContain('email')
    // openid is submitted exactly once (via the hidden field), never duplicated
    // by the disabled checkbox.
    expect(submittedScopes.filter((s) => s === 'openid')).toHaveLength(1)
  })

  it('renders only the locked openid row for a minimal openid-only OIDC request', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={{ ...oidcSearchParams, scope: 'openid' }}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // The identity block still renders for the minimal OIDC request.
    expect(screen.getByText('rider@example.com')).toBeInTheDocument()
    // openid is the only scope row, and it is locked.
    const openidCheckbox = screen.getByLabelText('openid')
    expect(openidCheckbox).toBeChecked()
    expect(openidCheckbox).toBeDisabled()
    expect(screen.queryByLabelText('profile')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('email')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const consentCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/auth/oauth2/consent'
    )
    expect(JSON.parse(consentCall[1].body).scope).toBe('openid')
  })

  it('flips to the OIDC identity view when openid co-occurs with Mastodon scopes', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={{ ...oidcSearchParams, scope: 'openid read write' }}
        actors={alternateActors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // A single 'openid' token takes precedence: the identity block shows and
    // the actor picker is hidden even though Mastodon scopes are also present.
    expect(screen.getByText('Signed in as')).toBeInTheDocument()
    expect(screen.queryByText('Authorize as')).not.toBeInTheDocument()
    // openid is locked; the co-requested Mastodon scopes stay user-toggleable.
    expect(screen.getByLabelText('openid')).toBeDisabled()
    expect(screen.getByLabelText('read')).toBeEnabled()
    expect(screen.getByLabelText('write')).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const consentCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/auth/oauth2/consent'
    )
    expect(JSON.parse(consentCall[1].body).scope).toBe('openid read write')
  })

  it('uses sign-in header copy for OIDC requests', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // OIDC is an authentication ("Sign in with …") flow, not a resource grant.
    expect(screen.getByText('Sign in to Phanpy')).toBeInTheDocument()
    expect(screen.queryByText('Authorization required')).not.toBeInTheDocument()
  })

  it('uses authorization header copy for non-OIDC requests', () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    expect(screen.getByText('Authorization required')).toBeInTheDocument()
    expect(screen.queryByText(/^Sign in to/)).not.toBeInTheDocument()
  })

  it('uses a fallback name when the OIDC client has no name', () => {
    render(
      <AuthorizeCard
        client={{ ...client, name: null }}
        searchParams={oidcSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
        account={account}
        navigate={mockNavigate}
      />
    )

    // Both the title and the description name the client via the fallback, so
    // neither renders a blank subject.
    expect(screen.getByText('Sign in to this application')).toBeInTheDocument()
    expect(screen.getByText('This application')).toBeInTheDocument()
  })
})
