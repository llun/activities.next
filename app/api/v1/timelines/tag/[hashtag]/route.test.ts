import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetMastodonStatuses = vi.fn()
const mockDatabase = {
  getBlockRelations: vi.fn(),
  getMuteRelations: vi.fn(),
  getStatusesByHashtag: vi.fn(),
  getActiveFiltersForActor: vi.fn(),
  getActiveServerFilters: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OptionalOAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ hashtag: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ hashtag: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      }),
  corsErrorResponse: vi.fn()
}))

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: (...params: unknown[]) =>
    mockGetMastodonStatuses(...params)
}))

const status = {
  id: 'https://local.test/users/alice/statuses/1',
  actorId: 'https://local.test/users/alice',
  type: StatusType.enum.Note
} as Status

describe('GET /api/v1/timelines/tag/:hashtag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getBlockRelations.mockResolvedValue([])
    mockDatabase.getMuteRelations.mockResolvedValue([])
    mockDatabase.getStatusesByHashtag.mockResolvedValue([status])
    mockGetMastodonStatuses.mockResolvedValue([{ id: '1' }])
    mockDatabase.getActiveFiltersForActor.mockResolvedValue([])
    mockDatabase.getActiveServerFilters.mockResolvedValue([])
  })

  it('passes the current actor id when batch serializing authenticated Mastodon hashtag statuses', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v1/timelines/tag/running'),
      { params: Promise.resolve({ hashtag: 'running' }) }
    )

    expect(response.status).toBe(200)
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      mockDatabase,
      [status],
      mockCurrentActor.id
    )
  })

  it.each([
    { description: 'max_id', field: 'max_id' },
    { description: 'min_id', field: 'min_id' },
    { description: 'since_id', field: 'since_id' }
  ])(
    'returns 400 (not 500) for a malformed $description cursor',
    async ({ field }) => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      url.searchParams.set(field, 'apurl_@@@@')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ hashtag: 'running' })
      })

      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    }
  )

  it('returns an empty array and no Link header when there are no statuses', async () => {
    mockDatabase.getStatusesByHashtag.mockResolvedValue([])
    mockGetMastodonStatuses.mockResolvedValue([])

    const response = await GET(
      new NextRequest('https://local.test/api/v1/timelines/tag/running'),
      { params: Promise.resolve({ hashtag: 'running' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  describe('hashtag name validation', () => {
    it.each([
      { description: 'a decoded Unicode hashtag', param: '日本語' },
      {
        description: 'a percent-encoded Unicode hashtag',
        param: encodeURIComponent('日本語')
      }
    ])(
      'accepts $description and queries the decoded name',
      async ({ param }) => {
        const response = await GET(
          new NextRequest(
            `https://local.test/api/v1/timelines/tag/${encodeURIComponent('日本語')}`
          ),
          { params: Promise.resolve({ hashtag: param }) }
        )
        expect(response.status).toBe(200)
        expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
          expect.objectContaining({ hashtag: '日本語' })
        )
      }
    )

    it.each([
      { description: 'a dash', param: 'foo-bar' },
      { description: 'an encoded space', param: 'foo%20bar' },
      { description: 'an encoded emoji', param: 'fun%F0%9F%8E%89' }
    ])('returns 400 for a name containing $description', async ({ param }) => {
      const response = await GET(
        new NextRequest(`https://local.test/api/v1/timelines/tag/${param}`),
        { params: Promise.resolve({ hashtag: param }) }
      )
      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    })
  })

  describe('tag filters and scope params', () => {
    const requestWithQuery = (query: Record<string, string | string[]>) => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      for (const [key, value] of Object.entries(query)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, item)
        }
      }
      return GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ hashtag: 'running' })
      })
    }

    it('forwards any[]/all[]/none[] tags to the hashtag query', async () => {
      const response = await requestWithQuery({
        'any[]': ['cycling'],
        'all[]': ['fitness'],
        'none[]': ['walking']
      })
      expect(response.status).toBe(200)
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({
          anyTags: ['cycling'],
          allTags: ['fitness'],
          noneTags: ['walking']
        })
      )
    })

    it('caps each tag mode at four tags like Mastodon', async () => {
      await requestWithQuery({ 'any[]': ['a1', 'a2', 'a3', 'a4', 'a5'] })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: ['a1', 'a2', 'a3', 'a4'] })
      )
    })

    it('returns 400 for an invalid additional tag name', async () => {
      const response = await requestWithQuery({ 'any[]': ['bad tag'] })
      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    })

    it('forwards the local scope to the hashtag query', async () => {
      await requestWithQuery({ local: 'true' })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ local: true, remote: false })
      )
    })

    it('forwards the remote scope to the hashtag query', async () => {
      await requestWithQuery({ remote: 'true' })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ local: false, remote: true })
      )
    })

    it('forwards only_media to the hashtag query', async () => {
      await requestWithQuery({ only_media: 'true' })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ onlyMedia: true })
      )
    })

    it('passes the decoded min_id cursor to the hashtag query', async () => {
      await requestWithQuery({ min_id: urlToId(status.id) })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ minStatusId: status.id })
      )
    })
  })

  describe('keyword filters and prev Link', () => {
    it('loads keyword filters with the public context for a signed-in viewer', async () => {
      await GET(
        new NextRequest('https://local.test/api/v1/timelines/tag/running'),
        { params: Promise.resolve({ hashtag: 'running' }) }
      )
      expect(mockDatabase.getActiveFiltersForActor).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        context: 'public'
      })
    })

    it('emits a rel="prev" Link carrying the tag filters', async () => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      url.searchParams.append('any[]', 'cycling')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ hashtag: 'running' })
      })
      const link = response.headers.get('Link')
      expect(link).toContain('rel="prev"')
      const prevPart = link!
        .split(', ')
        .find((part) => part.includes('rel="prev"'))
      const prevUrl = new URL(prevPart!.match(/<([^>]+)>/)![1])
      expect(prevUrl.searchParams.get('min_id')).toBe(urlToId(status.id))
      expect(prevUrl.searchParams.getAll('any[]')).toEqual(['cycling'])
    })
  })
})
