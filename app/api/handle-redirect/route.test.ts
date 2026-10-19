import { NextRequest } from 'next/server'

import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import { GET } from './route'

// The global config mock serves test.llun.dev.
const request = (path: string, query: string, host: string) =>
  new NextRequest(
    `https://internal.example/api/handle-redirect?${new URLSearchParams({
      path,
      query
    })}`,
    { headers: { host } }
  )

const call = (req: NextRequest) => GET(req, { params: Promise.resolve({}) })

describe('GET /api/handle-redirect', () => {
  beforeEach(() => {
    resetServedDomainsForTests()
    setServedDomainsForTests(['run.example'])
  })

  afterEach(() => {
    resetServedDomainsForTests()
  })

  it('redirects a bare handle onto the visited active domain', async () => {
    const response = await call(request('/@ana', '', 'run.example'))
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('/@ana@run.example')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('keeps the rest of the path and the query', async () => {
    const response = await call(
      request('/@ana/123/replies', '?page=2', 'run.example')
    )
    expect(response.headers.get('Location')).toBe(
      '/@ana@run.example/123/replies?page=2'
    )
  })

  // Local usernames may hold `.` and `-` (`LOCAL_USERNAME_PATTERN`).
  it.each([
    {
      description: 'a username with a dot',
      path: '/@jane.doe',
      expected: '/@jane.doe@run.example'
    },
    {
      description: 'a username with a dash and a status',
      path: '/@jane-doe/123',
      expected: '/@jane-doe@run.example/123'
    }
  ])('redirects $description', async ({ path, expected }) => {
    const response = await call(request(path, '', 'run.example'))
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(expected)
  })

  it('never echoes an untrusted host: it falls back to the primary', async () => {
    const response = await call(request('/@ana', '', 'evil.example'))
    expect(response.headers.get('Location')).toBe('/@ana@test.llun.dev')
  })

  it('stops using a domain once it is turned off', async () => {
    setServedDomainsForTests([])
    const response = await call(request('/@ana', '', 'run.example'))
    expect(response.headers.get('Location')).toBe('/@ana@test.llun.dev')
  })

  it.each([
    ['/@ana@other.example', ''],
    ['/users/ana', ''],
    ['/@ana', 'page=2'],
    ['//evil.example/@ana', ''],
    ['/@.ana', ''],
    ['/@an%61', '']
  ])('answers 404 for %s %s', async (path, query) => {
    const response = await call(request(path, query, 'run.example'))
    expect(response.status).toBe(404)
  })
})
