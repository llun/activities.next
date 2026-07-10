import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const TEST_ACTOR = {
  id: 'https://llun.test/users/test1',
  username: 'test1',
  domain: 'llun.test',
  name: 'Test One',
  followersUrl: 'https://llun.test/users/test1/followers'
}

const STATUS_ID = 'https://llun.test/users/test1/statuses/status-1'

const buildNote = (overrides: Record<string, unknown> = {}) =>
  ({
    id: STATUS_ID,
    url: 'https://llun.test/@test1/status-1',
    type: StatusType.enum.Note,
    actorId: TEST_ACTOR.id,
    actor: TEST_ACTOR,
    text: '<p>Hello &amp; welcome</p>',
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    createdAt: 1700000000000,
    ...overrides
  }) as unknown as Status

const mockDatabase = {
  getActorFromUsername: vi.fn(),
  getStatus: vi.fn(),
  getStatusFromUrlHash: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test'],
    secretPhase: 'test-secret',
    allowEmails: []
  }),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test')
}))

const params = { params: Promise.resolve({}) }

const request = (query: Record<string, string>) =>
  new NextRequest(
    `https://llun.test/api/oembed?${new URLSearchParams(query).toString()}`
  )

describe('GET /api/oembed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorFromUsername.mockResolvedValue({ id: TEST_ACTOR.id })
    mockDatabase.getStatusFromUrlHash.mockResolvedValue(null)
    mockDatabase.getStatus.mockImplementation(async ({ statusId }) =>
      statusId === STATUS_ID ? buildNote() : null
    )
  })

  it.each([
    {
      description: 'the canonical @user@domain page URL',
      url: 'https://llun.test/@test1@llun.test/status-1'
    },
    {
      description: 'the percent-encoded discovery-link form',
      url: 'https://llun.test/%40test1%40llun.test/status-1'
    },
    {
      description: 'the short /@user form qualified by the URL host',
      url: 'https://llun.test/@test1/status-1'
    },
    {
      description: 'a trusted alias host',
      url: 'https://alias.llun.test/@test1@llun.test/status-1'
    }
  ])('returns a rich oEmbed document for $description', async ({ url }) => {
    const response = await GET(request({ url }), params)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      type: 'rich',
      version: '1.0',
      title: 'New status by Test One',
      author_name: 'Test One',
      author_url: 'https://llun.test/@test1',
      provider_name: 'llun.test',
      provider_url: 'https://llun.test',
      cache_age: 86400,
      width: 400,
      height: null
    })
    expect(body.html).toContain('<blockquote class="activities-next-embed">')
    expect(body.html).toContain('Hello &amp; welcome')
    expect(body.html).toContain(url)
  })

  it('echoes maxwidth and maxheight', async () => {
    const response = await GET(
      request({
        url: 'https://llun.test/@test1@llun.test/status-1',
        maxwidth: '550',
        maxheight: '300'
      }),
      params
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      width: 550,
      height: 300
    })
  })

  it('returns 404 for a status that is not publicly readable', async () => {
    mockDatabase.getStatus.mockResolvedValue(
      buildNote({ to: [TEST_ACTOR.followersUrl], cc: [] })
    )

    const response = await GET(
      request({ url: 'https://llun.test/@test1@llun.test/status-1' }),
      params
    )

    expect(response.status).toBe(404)
  })

  it.each([
    {
      description: 'a foreign host',
      url: 'https://mastodon.social/@test1/status-1'
    },
    {
      description: 'a non-status path',
      url: 'https://llun.test/settings'
    },
    {
      description: 'an unknown status',
      url: 'https://llun.test/@test1@llun.test/missing'
    },
    {
      description: 'an unparseable url',
      url: 'not a url'
    }
  ])('returns 404 for $description', async ({ url }) => {
    const response = await GET(request({ url }), params)

    expect(response.status).toBe(404)
  })

  it('returns 400 when the url parameter is missing', async () => {
    const response = await GET(request({}), params)

    expect(response.status).toBe(400)
  })
})
