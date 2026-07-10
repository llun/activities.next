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
  getActiveServerFilters: vi.fn(),
  getActorDomainBlocks: vi.fn(async () => [])
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}
// Overridable per test so the anonymous (signed-out) path can be exercised.
let currentActorForRequest: typeof mockCurrentActor | undefined =
  mockCurrentActor

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
        currentActor: currentActorForRequest,
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
    currentActorForRequest = mockCurrentActor
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

    it('returns 400 for an over-length primary hashtag (decoded > 255)', async () => {
      // The 255-char cap is enforced on the decoded name, the only length guard
      // on this path, so an unbounded name never reaches getStatusesByHashtag.
      const param = 'a'.repeat(256)
      const response = await GET(
        new NextRequest(`https://local.test/api/v1/timelines/tag/${param}`),
        { params: Promise.resolve({ hashtag: param }) }
      )
      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    })

    it('accepts a Unicode hashtag whose percent-encoded length exceeds 255', async () => {
      // Each Japanese char percent-encodes to 9 chars, so a 30-char name is 270
      // encoded — over the decoded 255 limit but a valid short name. The raw
      // param cap must not reject it before decoding.
      const name = 'あ'.repeat(30)
      const encoded = encodeURIComponent(name)
      expect(encoded.length).toBeGreaterThan(255)
      const response = await GET(
        new NextRequest(`https://local.test/api/v1/timelines/tag/${encoded}`),
        { params: Promise.resolve({ hashtag: encoded }) }
      )
      expect(response.status).toBe(200)
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ hashtag: name })
      )
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

    it('strips a leading # from an additional tag before querying', async () => {
      // isMastodonHashtagName rejects '#', so parseAdditionalTags must strip the
      // leading hash; otherwise a `#cycling` additional tag would 400 the request.
      await requestWithQuery({ 'any[]': ['#cycling'] })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: ['cycling'] })
      )
    })

    it('accepts the bare-key (no []) additional tag form', async () => {
      // Mastodon reads Array(params[:any]), so `any=cycling` without the []
      // suffix must widen the OR-set the same as `any[]=cycling`.
      await requestWithQuery({ any: 'cycling' })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: ['cycling'] })
      )
    })

    it('caps all[]/none[] at four tags like Mastodon', async () => {
      await requestWithQuery({
        'all[]': ['a1', 'a2', 'a3', 'a4', 'a5'],
        'none[]': ['n1', 'n2', 'n3', 'n4', 'n5']
      })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({
          allTags: ['a1', 'a2', 'a3', 'a4'],
          noneTags: ['n1', 'n2', 'n3', 'n4']
        })
      )
    })

    it('counts the primary hashtag toward the any[] cap (three extra max)', async () => {
      // Mastodon unions the primary tag into the any[] OR-set before capping
      // at four (tags_for(Array(tag.name) | Array(params[:any]))), so the
      // primary counts toward the limit and only three additional names pass.
      await requestWithQuery({ 'any[]': ['a1', 'a2', 'a3', 'a4', 'a5'] })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: ['a1', 'a2', 'a3'] })
      )
    })

    it('drops the primary hashtag from any[] to avoid double-counting', async () => {
      // any[]=running on tag `running` is redundant with the primary term, so
      // the OR-set stays {running, a1, a2, a3} rather than spending a slot on it.
      await requestWithQuery({ 'any[]': ['running', 'a1', 'a2', 'a3'] })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: ['a1', 'a2', 'a3'] })
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

    it('deduplicates repeated tags before querying', async () => {
      await requestWithQuery({ 'all[]': ['cycling', 'cycling', 'running'] })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ allTags: ['cycling', 'running'] })
      )
    })

    it('rejects an over-length additional tag name with 400', async () => {
      const response = await requestWithQuery({ 'any[]': 'a'.repeat(256) })
      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    })

    it('ignores a blank additional tag value instead of 400ing', async () => {
      // An empty filter slot (`?any[]=`) is not a malformed tag — serve the
      // timeline with that mode empty rather than rejecting the whole request.
      const response = await requestWithQuery({ 'any[]': '' })
      expect(response.status).toBe(200)
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ anyTags: [] })
      )
    })

    it('forwards only_media to the hashtag query', async () => {
      await requestWithQuery({ only_media: 'true' })
      expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
        expect.objectContaining({ onlyMedia: true })
      )
    })

    it.each([{ param: 'min_id' }, { param: 'since_id' }])(
      'passes the decoded $param cursor as minStatusId to the hashtag query',
      async ({ param }) => {
        await requestWithQuery({ [param]: urlToId(status.id) })
        expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalledWith(
          expect.objectContaining({ minStatusId: status.id })
        )
      }
    )

    it('prefers min_id over since_id when both are provided', async () => {
      // The route collapses both lower-bound cursors with min_id-wins
      // precedence (matching the public timeline). Pin it so a swapped operand
      // order can't regress silently.
      await requestWithQuery({
        min_id: urlToId(status.id),
        since_id: urlToId('https://local.test/users/alice/statuses/other')
      })
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

    it('drops a status matched by a hide keyword filter before serializing', async () => {
      const spoilerStatus = {
        id: 'https://local.test/users/alice/statuses/spoiler',
        actorId: 'https://local.test/users/alice',
        type: StatusType.enum.Note,
        text: 'major blockword spoiler',
        summary: null
      } as unknown as Status
      mockDatabase.getStatusesByHashtag.mockResolvedValue([spoilerStatus])
      mockDatabase.getActiveFiltersForActor.mockResolvedValue([
        {
          filter: {
            id: 'f-hide',
            actorId: mockCurrentActor.id,
            title: 'Spoilers',
            context: ['public'],
            filterAction: 'hide',
            expiresAt: null,
            createdAt: 0,
            updatedAt: 0
          },
          keywords: [
            {
              id: 'f-hide:kw',
              filterId: 'f-hide',
              keyword: 'blockword',
              wholeWord: false,
              createdAt: 0,
              updatedAt: 0
            }
          ],
          statuses: []
        }
      ])

      await GET(
        new NextRequest('https://local.test/api/v1/timelines/tag/running'),
        { params: Promise.resolve({ hashtag: 'running' }) }
      )

      // getFilteredStatusPage drops the hide match before serialization, so the
      // Mastodon serializer receives an empty list (not the leaked statuses).
      expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
        mockDatabase,
        [],
        mockCurrentActor.id
      )
    })

    it('applies instance-wide server hide filters for signed-out viewers', async () => {
      currentActorForRequest = undefined
      const serverBlocked = {
        id: 'https://local.test/users/alice/statuses/server-blocked',
        actorId: 'https://local.test/users/alice',
        type: StatusType.enum.Note,
        text: 'serverblock content',
        summary: null
      } as unknown as Status
      mockDatabase.getStatusesByHashtag.mockResolvedValue([serverBlocked])
      mockDatabase.getActiveServerFilters.mockResolvedValue([
        {
          filter: {
            id: 'sf-hide',
            title: 'Server hide',
            context: ['public'],
            filterAction: 'hide',
            expiresAt: null,
            createdAt: 0,
            updatedAt: 0
          },
          keywords: [
            {
              id: 'sf-hide:kw',
              filterId: 'sf-hide',
              keyword: 'serverblock',
              wholeWord: false,
              createdAt: 0,
              updatedAt: 0
            }
          ]
        }
      ])

      await GET(
        new NextRequest('https://local.test/api/v1/timelines/tag/running'),
        { params: Promise.resolve({ hashtag: 'running' }) }
      )

      // Anonymous: per-actor filters are skipped (no actor), but instance-wide
      // server filters still load and drop the matching status.
      expect(mockDatabase.getActiveFiltersForActor).not.toHaveBeenCalled()
      expect(mockDatabase.getActiveServerFilters).toHaveBeenCalledWith({
        context: 'public'
      })
      expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
        mockDatabase,
        [],
        undefined
      )
    })

    it('annotates a warn-filtered status via the response filtered field', async () => {
      const warnStatus = {
        id: 'https://local.test/users/alice/statuses/warn',
        actorId: 'https://local.test/users/alice',
        type: StatusType.enum.Note,
        text: 'contains warnword here',
        summary: null
      } as unknown as Status
      mockDatabase.getStatusesByHashtag.mockResolvedValue([warnStatus])
      // annotateMastodonStatusesWithFilters pairs by status id, so the mock
      // Mastodon status must carry the domain status's id.
      mockGetMastodonStatuses.mockResolvedValue([
        { id: urlToId(warnStatus.id) }
      ])
      mockDatabase.getActiveFiltersForActor.mockResolvedValue([
        {
          filter: {
            id: 'f-warn',
            actorId: mockCurrentActor.id,
            title: 'Warn',
            context: ['public'],
            filterAction: 'warn',
            expiresAt: null,
            createdAt: 0,
            updatedAt: 0
          },
          keywords: [
            {
              id: 'f-warn:kw',
              filterId: 'f-warn',
              keyword: 'warnword',
              wholeWord: false,
              createdAt: 0,
              updatedAt: 0
            }
          ],
          statuses: []
        }
      ])

      const response = await GET(
        new NextRequest('https://local.test/api/v1/timelines/tag/running'),
        { params: Promise.resolve({ hashtag: 'running' }) }
      )
      const data = await response.json()
      // Warn matches are kept but annotated: the response uses
      // annotateMastodonStatusesWithFilters, not the raw serialized statuses.
      expect(data).toHaveLength(1)
      expect(data[0].filtered?.length ?? 0).toBeGreaterThan(0)
    })

    // buildLink shares one linkBaseParams between the prev and next Links, so
    // asserting the prev Link's base params covers the shared param-building
    // path (the any/all/none loop plus the local/remote/only_media setters).
    it('emits a rel="prev" Link carrying every tag filter and scope param', async () => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      url.searchParams.append('any[]', 'cycling')
      url.searchParams.append('all[]', 'fitness')
      url.searchParams.append('none[]', 'walking')
      url.searchParams.set('only_media', 'true')
      url.searchParams.set('local', 'true')
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
      expect(prevUrl.searchParams.getAll('all[]')).toEqual(['fitness'])
      expect(prevUrl.searchParams.getAll('none[]')).toEqual(['walking'])
      expect(prevUrl.searchParams.get('only_media')).toBe('true')
      expect(prevUrl.searchParams.get('local')).toBe('true')
    })

    it('carries the remote scope (not local) into the prev Link', async () => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      url.searchParams.set('remote', 'true')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ hashtag: 'running' })
      })
      const prevPart = response.headers
        .get('Link')!
        .split(', ')
        .find((part) => part.includes('rel="prev"'))
      const prevUrl = new URL(prevPart!.match(/<([^>]+)>/)![1])
      expect(prevUrl.searchParams.get('remote')).toBe('true')
      expect(prevUrl.searchParams.has('local')).toBe(false)
    })
  })
})
