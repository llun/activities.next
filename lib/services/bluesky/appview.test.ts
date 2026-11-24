import { BlueskyRequestError } from '@/lib/services/bluesky/agent'
import {
  BLUESKY_APPVIEW_URL,
  appViewGet,
  getPublicAuthorFeed,
  getPublicPosts,
  getPublicProfile
} from '@/lib/services/bluesky/appview'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))

const answer = (body: unknown, statusCode = 200) => ({
  body: JSON.stringify(body),
  bodyTruncated: false,
  headers: {},
  statusCode,
  url: ''
})

const requestedUrls = () =>
  vi.mocked(safeRemoteFetch).mock.calls.map(([options]) => new URL(options.url))

describe('Bluesky AppView', () => {
  beforeEach(() => {
    vi.mocked(safeRemoteFetch).mockReset()
  })

  it('calls the public AppView over HTTPS without following redirects', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue(answer({ ok: true }))
    expect(
      await appViewGet('app.bsky.actor.getProfiles', { actors: ['a', 'b'] })
    ).toEqual({ ok: true })
    const [options] = vi.mocked(safeRemoteFetch).mock.calls[0]
    expect(options).toMatchObject({ method: 'GET', maxRedirects: 0 })
    expect(options.maxBodyBytes).toBeGreaterThan(0)
    expect(options.timeoutInMilliseconds).toBeGreaterThan(0)
    const url = new URL(options.url)
    expect(url.origin).toBe(BLUESKY_APPVIEW_URL)
    expect(url.protocol).toBe('https:')
    expect(url.pathname).toBe('/xrpc/app.bsky.actor.getProfiles')
    expect(url.searchParams.getAll('actors')).toEqual(['a', 'b'])
  })

  it('throws a BlueskyRequestError for a non-2xx answer', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue(
      answer({ error: 'InvalidRequest', message: 'bad' }, 400)
    )
    await expect(appViewGet('app.bsky.feed.getPosts')).rejects.toBeInstanceOf(
      BlueskyRequestError
    )
  })

  it('reads posts in batches of 25 and asks once per uri', async () => {
    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) =>
      answer({
        posts: new URL(url).searchParams.getAll('uris').map((uri) => ({ uri }))
      })
    )
    const uris = Array.from({ length: 30 }, (_, i) => `at://did/p/${i}`)
    const posts = await getPublicPosts([...uris, uris[0]])
    expect(posts).toHaveLength(30)
    expect(
      requestedUrls().map((url) => url.searchParams.getAll('uris').length)
    ).toEqual([25, 5])
  })

  it('answers one profile, or null when the AppView has none', async () => {
    vi.mocked(safeRemoteFetch)
      .mockResolvedValueOnce(answer({ profiles: [{ did: 'did:plc:x' }] }))
      .mockResolvedValueOnce(answer({ profiles: [] }))
    expect(await getPublicProfile('did:plc:x')).toEqual({ did: 'did:plc:x' })
    expect(await getPublicProfile('gone.bsky.social')).toBeNull()
  })

  it('reads an author feed', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue(answer({ feed: [] }))
    await getPublicAuthorFeed('did:plc:x', { limit: 10 })
    const [url] = requestedUrls()
    expect(url.pathname).toBe('/xrpc/app.bsky.feed.getAuthorFeed')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      actor: 'did:plc:x',
      limit: '10'
    })
  })
})
