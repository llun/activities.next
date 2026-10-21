import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'

import {
  AdminDomainRequestError,
  addAdminDomain,
  checkAdminDomain,
  getAdminDomains,
  removeAdminDomain,
  setAdminDomainStatus,
  updateAdminDomainIdentity,
  updateAdminDomainPolicies,
  updateAdminDomainRegistrations
} from './adminDomains'

const DOMAIN: AdminDomain = {
  domain: 'photos.example:8443',
  source: 'database',
  name: null,
  status: 'off',
  profiles: 0,
  signupsOpen: false,
  allowedEmails: [],
  allowExistingUsers: false,
  lastCheckedAt: null,
  lastCheck: null
}

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return {
    url,
    method: init?.method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined
  }
}

describe('adminDomains client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('lists the domains', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ domains: [DOMAIN], wildcards: [] })
    )
    await expect(getAdminDomains()).resolves.toEqual({
      domains: [DOMAIN],
      wildcards: []
    })
    expect(lastCall()).toMatchObject({
      url: '/api/v1/admin/domains',
      method: 'GET'
    })
  })

  it('adds a domain with POST', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(DOMAIN))
    await addAdminDomain('photos.example:8443')
    expect(lastCall()).toEqual({
      url: '/api/v1/admin/domains',
      method: 'POST',
      body: { domain: 'photos.example:8443' }
    })
  })

  it('encodes the domain in the path for check, status, save and remove', async () => {
    fetchMock.mockResponse(JSON.stringify(DOMAIN))
    await checkAdminDomain(DOMAIN.domain)
    expect(lastCall()).toMatchObject({
      url: '/api/v1/admin/domains/photos.example%3A8443/check',
      method: 'POST'
    })
    await setAdminDomainStatus(DOMAIN.domain, 'on')
    expect(lastCall()).toEqual({
      url: '/api/v1/admin/domains/photos.example%3A8443',
      method: 'PATCH',
      body: { status: 'on' }
    })
    await updateAdminDomainRegistrations(DOMAIN.domain, { signupsOpen: true })
    expect(lastCall().body).toEqual({ signupsOpen: true })
    await removeAdminDomain(DOMAIN.domain)
    expect(lastCall().method).toBe('DELETE')
  })

  it('PATCHes identity and policies, with null for "Same as server"', async () => {
    fetchMock.mockResponse(JSON.stringify(DOMAIN))
    await updateAdminDomainIdentity(DOMAIN.domain, {
      name: 'Run Club',
      description: null,
      contactEmail: null
    })
    expect(lastCall()).toEqual({
      url: '/api/v1/admin/domains/photos.example%3A8443',
      method: 'PATCH',
      body: { name: 'Run Club', description: null, contactEmail: null }
    })
    await updateAdminDomainPolicies(DOMAIN.domain, {
      termsOfService: null,
      privacyPolicy: '# Privacy'
    })
    expect(lastCall().body).toEqual({
      termsOfService: null,
      privacyPolicy: '# Privacy'
    })
  })

  it('throws the server message, code and domain', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        error: 'The domain did not pass the check, so it stays off.',
        code: 'check-failed',
        domain: DOMAIN
      }),
      { status: 409 }
    )
    const error = await setAdminDomainStatus(DOMAIN.domain, 'on').catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(AdminDomainRequestError)
    expect(error).toMatchObject({
      message: 'The domain did not pass the check, so it stays off.',
      code: 'check-failed',
      domain: DOMAIN
    })
  })

  it('falls back to its own message when the body is not JSON', async () => {
    fetchMock.mockResponseOnce('oops', { status: 500 })
    await expect(addAdminDomain('photos.example')).rejects.toThrow(
      'Failed to add the domain. Please try again.'
    )
  })
})
