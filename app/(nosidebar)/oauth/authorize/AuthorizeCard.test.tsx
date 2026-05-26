/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Actor } from '@/lib/types/domain/actor'
import { Client } from '@/lib/types/oauth2/client'

import { AuthorizeCard, getConsentRedirectUrl } from './AuthorizeCard'
import { SearchParams } from './types'

const mockPush = jest.fn()
const mockNavigate = jest.fn()

jest.mock('next/navigation', () => ({
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

describe('AuthorizeCard', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockNavigate.mockReset()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('submits selected Phanpy scopes with the signed Better Auth query', async () => {
    render(
      <AuthorizeCard
        client={client}
        searchParams={signedSearchParams}
        actors={actors}
        currentActorId="https://activities.local/users/llun"
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

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(requestInit.body)

    expect(body.accept).toBe(true)
    expect(body.scope).toBe('read write follow push')

    const oauthQuery = new URLSearchParams(body.oauth_query)
    expect(oauthQuery.get('client_id')).toBe('phanpy-client')
    expect(oauthQuery.get('scope')).toBe('read write follow push')
    expect(oauthQuery.get('state')).toBe('return-state')
    expect(oauthQuery.get('code_challenge')).toBe('challenge')
    expect(oauthQuery.get('code_challenge_method')).toBe('S256')
    expect(oauthQuery.get('sig')).toBe('signed-query')
    expect(oauthQuery.get('exp')).toBe('1779800000')
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
})
