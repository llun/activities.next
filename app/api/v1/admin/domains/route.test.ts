import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  getActiveServedDomainNames,
  resetServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { POST as CHECK } from './[domain]/check/route'
import {
  DELETE as DELETE_ONE,
  GET as GET_ONE,
  PATCH as PATCH_ONE
} from './[domain]/route'
import { GET, POST } from './route'

const holder = vi.hoisted(() => ({
  db: null as Database | null,
  checkPasses: true
}))

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
    trustedHosts: ['club.example', '*.preview.example'],
    secretPhase: 'secret'
  })
}))

// The reachability check is unit-tested on its own; here it passes or fails
// on demand, and records which domain it was asked about.
const checked: string[] = []
vi.mock('@/lib/services/domains/domainCheck', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/services/domains/domainCheck')
  >()),
  checkDomainReachability: vi.fn(async ({ domain }: { domain: string }) => {
    checked.push(domain)
    return holder.checkPasses
      ? {
          passed: true,
          reason: 'passed',
          items: [
            { key: 'dns', status: 'passed' },
            { key: 'tls', status: 'passed' },
            { key: 'host', status: 'passed' }
          ]
        }
      : {
          passed: false,
          reason: 'host-header',
          items: [
            { key: 'dns', status: 'passed' },
            { key: 'tls', status: 'passed' },
            { key: 'host', status: 'failed' }
          ]
        }
  })
}))

const ORIGIN = 'https://social.example'
const LIST_URL = `${ORIGIN}/api/v1/admin/domains`

const jsonRequest = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    ...(body === undefined ? null : { body: JSON.stringify(body) })
  })

const one = (domain: string) => ({
  params: Promise.resolve({ domain: encodeURIComponent(domain) })
})

const add = (domain: string) =>
  POST(jsonRequest(LIST_URL, 'POST', { domain }), {
    params: Promise.resolve({})
  })

describe('/api/v1/admin/domains', () => {
  beforeEach(async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue({
      id: 'admin',
      defaultActorId: null
    } as never)
    holder.checkPasses = true
    checked.length = 0
    resetServedDomainsForTests()
    holder.db = getTestSQLDatabase()
    await holder.db.migrate()
  })

  afterEach(async () => {
    resetServedDomainsForTests()
    await holder.db?.destroy()
  })

  it('refuses anyone who is not an admin', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue(null)
    const response = await GET(new NextRequest(LIST_URL), {
      params: Promise.resolve({})
    })
    expect(response.status).toBeGreaterThanOrEqual(401)
    expect(response.status).toBeLessThanOrEqual(403)
    expect((await add('photos.example')).status).toBeGreaterThanOrEqual(401)
  })

  it('lists the env domains and the wildcards', async () => {
    const response = await GET(new NextRequest(LIST_URL), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.domains.map((item: { domain: string; source: string }) => [
        item.domain,
        item.source
      ])
    ).toEqual([
      ['social.example', 'primary'],
      ['club.example', 'env']
    ])
    expect(data.wildcards).toEqual([{ rule: '*.preview.example' }])
  })

  it('adds a domain as off with the check result', async () => {
    holder.checkPasses = false
    const response = await add('Photos.Example')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      domain: 'photos.example',
      status: 'off',
      lastCheck: { passed: false, reason: 'host-header' }
    })
    expect(checked).toEqual(['photos.example'])
  })

  it.each([
    [{ domain: '*.photos.example' }, 422, 'wildcard'],
    [{ domain: 'club.example' }, 422, 'env'],
    [{ domain: 'social.example' }, 422, 'primary'],
    [{ domain: 'a b' }, 422, 'invalid']
  ])('refuses %j', async (body, status, code) => {
    const response = await POST(jsonRequest(LIST_URL, 'POST', body), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
  })

  it('refuses a malformed body', async () => {
    const response = await POST(
      jsonRequest(LIST_URL, 'POST', { domain: 'x'.repeat(256) }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })

  it('answers 409 for a domain already in the list', async () => {
    await add('photos.example')
    expect((await add('photos.example')).status).toBe(409)
  })

  it('turns a domain on only after a passing check', async () => {
    await add('photos.example')
    const url = `${LIST_URL}/photos.example`

    holder.checkPasses = false
    const failed = await PATCH_ONE(
      jsonRequest(url, 'PATCH', { status: 'on' }),
      one('photos.example')
    )
    expect(failed.status).toBe(409)
    const failedBody = await failed.json()
    expect(failedBody.code).toBe('check-failed')
    expect(failedBody.domain.status).toBe('off')
    expect(getActiveServedDomainNames()).toEqual([])

    holder.checkPasses = true
    const on = await PATCH_ONE(
      jsonRequest(url, 'PATCH', { status: 'on' }),
      one('photos.example')
    )
    expect(on.status).toBe(200)
    expect((await on.json()).status).toBe('on')
    expect(getActiveServedDomainNames()).toEqual(['photos.example'])

    const off = await PATCH_ONE(
      jsonRequest(url, 'PATCH', { status: 'off' }),
      one('photos.example')
    )
    expect((await off.json()).status).toBe('off')
    expect(getActiveServedDomainNames()).toEqual([])
  })

  it('saves the Registrations box, normalising the allowed emails', async () => {
    await add('photos.example')
    const response = await PATCH_ONE(
      jsonRequest(`${LIST_URL}/photos.example`, 'PATCH', {
        signupsOpen: true,
        allowedEmails: [' Ana@Mail.Example ', ''],
        allowExistingUsers: true
      }),
      one('photos.example')
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      signupsOpen: true,
      allowedEmails: ['ana@mail.example'],
      allowExistingUsers: true
    })
  })

  it('refuses status mixed with registration fields, and unknown values', async () => {
    await add('photos.example')
    for (const body of [
      { status: 'on', signupsOpen: true },
      { status: 'maybe' },
      { signupsOpen: 'yes' }
    ]) {
      const response = await PATCH_ONE(
        jsonRequest(`${LIST_URL}/photos.example`, 'PATCH', body),
        one('photos.example')
      )
      expect(response.status).toBe(422)
    }
  })

  it('keeps env domains locked on and sends the primary to Server settings', async () => {
    const locked = await PATCH_ONE(
      jsonRequest(`${LIST_URL}/club.example`, 'PATCH', { status: 'off' }),
      one('club.example')
    )
    expect(locked.status).toBe(422)
    expect((await locked.json()).code).toBe('locked')

    const primary = await PATCH_ONE(
      jsonRequest(`${LIST_URL}/social.example`, 'PATCH', { signupsOpen: true }),
      one('social.example')
    )
    expect(primary.status).toBe(422)
    expect((await primary.json()).code).toBe('primary')
  })

  it('checks again without changing the status', async () => {
    holder.checkPasses = false
    await add('photos.example')
    holder.checkPasses = true
    const response = await CHECK(
      jsonRequest(`${LIST_URL}/photos.example/check`, 'POST'),
      one('photos.example')
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'off',
      lastCheck: { passed: true }
    })

    const missing = await CHECK(
      jsonRequest(`${LIST_URL}/nope.example/check`, 'POST'),
      one('nope.example')
    )
    expect(missing.status).toBe(404)
  })

  it('reads one domain and removes an off domain', async () => {
    await add('photos.example')
    const read = await GET_ONE(
      new NextRequest(`${LIST_URL}/photos.example`),
      one('photos.example')
    )
    expect((await read.json()).domain).toBe('photos.example')

    const removed = await DELETE_ONE(
      jsonRequest(`${LIST_URL}/photos.example`, 'DELETE'),
      one('photos.example')
    )
    expect(removed.status).toBe(200)
    const gone = await GET_ONE(
      new NextRequest(`${LIST_URL}/photos.example`),
      one('photos.example')
    )
    expect(gone.status).toBe(404)
  })

  it('refuses to remove a domain that is on', async () => {
    await add('photos.example')
    await PATCH_ONE(
      jsonRequest(`${LIST_URL}/photos.example`, 'PATCH', { status: 'on' }),
      one('photos.example')
    )
    const response = await DELETE_ONE(
      jsonRequest(`${LIST_URL}/photos.example`, 'DELETE'),
      one('photos.example')
    )
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('on')
  })
})
