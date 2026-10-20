import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { PRIMARY_DOMAIN_IDENTITY_ERROR } from '@/lib/services/domains/adminDomainTypes'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { GET, PATCH } from './route'

const holder = vi.hoisted(() => ({ db: null as Database | null }))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.db
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@social.example' } })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://social.example',
  getConfig: () => ({
    host: 'social.example',
    allowEmails: [],
    trustedHosts: ['club.example'],
    secretPhase: 'secret'
  })
}))

const ORIGIN = 'https://social.example'

const url = (domain: string) =>
  `${ORIGIN}/api/v1/admin/domains/${encodeURIComponent(domain)}`

const patch = (domain: string, body: unknown) =>
  PATCH(
    new NextRequest(url(domain), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ domain: encodeURIComponent(domain) }) }
  )

const get = (domain: string) =>
  GET(new NextRequest(url(domain)), {
    params: Promise.resolve({ domain: encodeURIComponent(domain) })
  })

describe('/api/v1/admin/domains/:domain identity and policies', () => {
  beforeEach(async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue({
      id: 'admin',
      defaultActorId: null
    } as never)
    resetServedDomainsForTests()
    holder.db = getTestSQLDatabase()
    await holder.db.migrate()
    await holder.db.createServedDomain({ domain: 'run.example', status: 'on' })
    setServedDomainsForTests(['run.example'])
  })

  afterEach(async () => {
    resetServedDomainsForTests()
    await holder.db?.destroy()
  })

  it('refuses anyone who is not an admin', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue(null)
    const response = await patch('run.example', { name: 'Run Club' })
    expect(response.status).toBe(403)
  })

  it('saves trimmed identity and policy fields and returns the detail', async () => {
    const response = await patch('run.example', {
      name: '  Run Club ',
      description: 'Running together',
      contactEmail: ' hello@run.example ',
      termsOfService: '# Terms\n',
      privacyPolicy: '# Privacy'
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      domain: 'run.example',
      source: 'database',
      name: 'Run Club',
      description: 'Running together',
      contactEmail: 'hello@run.example',
      termsOfService: '# Terms',
      privacyPolicy: '# Privacy'
    })
    expect(typeof body.termsOfServiceUpdatedAt).toBe('number')
    expect(typeof body.privacyPolicyUpdatedAt).toBe('number')

    const read = await get('run.example')
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      name: 'Run Club',
      termsOfService: '# Terms'
    })
  })

  it('serves the saved identity to visitors of that domain at once', async () => {
    const database = holder.db as Database
    // Warm the identity cache with the old row.
    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({ name: 'Activities.next' })

    await patch('run.example', { name: 'Run Club', privacyPolicy: 'Ours' })

    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({
      name: 'Run Club',
      privacyPolicy: { markdown: 'Ours', source: 'domain' }
    })

    // Back to "Same as server".
    await patch('run.example', { name: null, privacyPolicy: null })
    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({ name: 'Activities.next', privacyPolicy: null })
  })

  it('clears a field with null', async () => {
    await patch('run.example', { description: 'Running together' })
    const response = await patch('run.example', { description: null })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      description: null
    })
  })

  it.each([
    { name: 'a blank name', body: { name: '   ' } },
    { name: 'a blank terms', body: { termsOfService: '' } },
    { name: 'a name that is too long', body: { name: 'x'.repeat(256) } },
    {
      name: 'a description that is too long',
      body: { description: 'x'.repeat(5001) }
    },
    { name: 'an invalid contact email', body: { contactEmail: 'not-email' } },
    {
      name: 'a privacy policy that is too long',
      body: { privacyPolicy: 'x'.repeat(100_001) }
    },
    {
      name: 'identity sent with status',
      body: { status: 'off', name: 'Run Club' }
    }
  ])('refuses $name with 422', async ({ body }) => {
    const response = await patch('run.example', body)
    expect(response.status).toBe(422)
  })

  it('sends the primary’s identity to Admin › Instance', async () => {
    const response = await patch('social.example', { name: 'Social' })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      code: 'primary',
      error: PRIMARY_DOMAIN_IDENTITY_ERROR
    })
  })

  it('gives an env domain a row on its first identity save', async () => {
    const response = await patch('club.example', { name: 'Club' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      domain: 'club.example',
      source: 'env',
      status: 'on',
      name: 'Club'
    })
  })

  it('answers 404 for a domain it does not know', async () => {
    const response = await patch('nope.example', { name: 'Nope' })
    expect(response.status).toBe(404)
  })

  it('returns the primary’s detail with every override null', async () => {
    const response = await get('social.example')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'primary',
      description: null,
      contactEmail: null,
      termsOfService: null,
      privacyPolicy: null
    })
  })
})
