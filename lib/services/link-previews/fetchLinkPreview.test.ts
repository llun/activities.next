import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  LINK_PREVIEW_FAILURE_TTL_MS,
  LINK_PREVIEW_REFRESH_TTL_MS,
  fetchLinkPreview
} from '@/lib/services/link-previews/fetchLinkPreview'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import {
  SafeRemoteFetchError,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

// Only the network call is replaced; SafeRemoteFetchError stays real so the
// error-code handling under test sees the shape production throws.
vi.mock('@/lib/utils/safeRemoteFetch', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/utils/safeRemoteFetch')
  >('@/lib/utils/safeRemoteFetch')
  return { ...actual, safeRemoteFetch: vi.fn() }
})

const mockedFetch = vi.mocked(safeRemoteFetch)

const htmlResponse = (html: string, url = 'https://example.com/article') => ({
  body: html,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  statusCode: 200,
  url
})

const PAGE = `<!doctype html><html><head>
  <meta property="og:title" content="A good article">
  <meta property="og:description" content="Worth reading">
  <meta property="og:site_name" content="Example">
  <meta property="og:image" content="https://cdn.example.com/hero.jpg">
</head><body></body></html>`

describe('fetchLinkPreview', () => {
  // The cache/negative-cache windows are read back out of real timestamp
  // columns, which the two backends store differently — run against whichever
  // one the suite is pointed at.
  const {
    database,
    instance,
    prepare: prepareDatabase
  } = getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepareDatabase()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockedFetch.mockReset()
  })

  const ageRow = (url: string, updatedAt: Date) =>
    instance('link_previews')
      .where('urlHash', getHashFromString(url))
      .update({ updatedAt })

  it('fetches a page and stores the card', async () => {
    mockedFetch.mockResolvedValue(htmlResponse(PAGE))

    const card = await fetchLinkPreview({
      database,
      url: 'https://example.com/article'
    })

    expect(card).toMatchObject({
      url: 'https://example.com/article',
      title: 'A good article',
      description: 'Worth reading',
      siteName: 'Example',
      imageUrl: 'https://cdn.example.com/hero.jpg',
      fetchStatus: 'completed'
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('sends a descriptive user agent', async () => {
    mockedFetch.mockResolvedValue(htmlResponse(PAGE, 'https://example.com/ua'))

    await fetchLinkPreview({ database, url: 'https://example.com/ua' })

    const options = mockedFetch.mock.calls[0][0]
    const headers = options.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('activities.next')
    expect(headers.Accept).toContain('text/html')
  })

  it('serves a fresh cached card without fetching again', async () => {
    mockedFetch.mockResolvedValue(
      htmlResponse(PAGE, 'https://example.com/cached')
    )
    await fetchLinkPreview({ database, url: 'https://example.com/cached' })
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    const second = await fetchLinkPreview({
      database,
      url: 'https://example.com/cached'
    })

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(second?.title).toBe('A good article')
  })

  it('refetches a card that has gone stale', async () => {
    const url = 'https://example.com/stale'
    mockedFetch.mockResolvedValue(htmlResponse(PAGE, url))
    await fetchLinkPreview({ database, url })

    // Age the stored row past the refresh window.
    await ageRow(url, new Date(Date.now() - LINK_PREVIEW_REFRESH_TTL_MS - 1000))

    const refreshed = await fetchLinkPreview({ database, url })

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(refreshed?.title).toBe('A good article')
  })

  it('stores a failed row when the page cannot be fetched', async () => {
    mockedFetch.mockRejectedValue(
      new SafeRemoteFetchError('Unsafe url', 'ERR_UNSAFE_REMOTE_URL')
    )

    const card = await fetchLinkPreview({
      database,
      url: 'https://blocked.example.com/x'
    })

    expect(card).toBeNull()
    const stored = await database.getLinkPreview({
      urlHash: getHashFromString('https://blocked.example.com/x')
    })
    expect(stored).toMatchObject({
      fetchStatus: 'failed',
      error: 'ERR_UNSAFE_REMOTE_URL'
    })
  })

  it('does not refetch inside the failure window', async () => {
    const url = 'https://failing.example.com/x'
    mockedFetch.mockRejectedValue(new Error('boom'))
    await fetchLinkPreview({ database, url })
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    const second = await fetchLinkPreview({ database, url })

    expect(second).toBeNull()
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('retries a failure once the failure window has passed', async () => {
    const url = 'https://recovering.example.com/x'
    mockedFetch.mockRejectedValueOnce(new Error('boom'))
    await fetchLinkPreview({ database, url })

    await ageRow(url, new Date(Date.now() - LINK_PREVIEW_FAILURE_TTL_MS - 1000))

    mockedFetch.mockResolvedValue(htmlResponse(PAGE, url))
    const card = await fetchLinkPreview({ database, url })

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(card?.fetchStatus).toBe('completed')
  })

  it.each([
    {
      description: 'rejects a non-200 response',
      response: {
        body: PAGE,
        headers: { 'content-type': 'text/html' },
        statusCode: 404,
        url: 'https://example.com/missing'
      },
      url: 'https://example.com/missing'
    },
    {
      description: 'rejects a non-html content type',
      response: {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        statusCode: 200,
        url: 'https://example.com/json'
      },
      url: 'https://example.com/json'
    },
    {
      description: 'rejects a pdf',
      response: {
        body: '%PDF-1.4',
        headers: { 'content-type': 'application/pdf' },
        statusCode: 200,
        url: 'https://example.com/doc.pdf'
      },
      url: 'https://example.com/doc.pdf'
    },
    {
      description: 'rejects a non-utf8 charset',
      response: {
        body: PAGE,
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
        statusCode: 200,
        url: 'https://example.com/latin'
      },
      url: 'https://example.com/latin'
    },
    {
      description: 'rejects a response with no content type',
      response: {
        body: PAGE,
        headers: {},
        statusCode: 200,
        url: 'https://example.com/notype'
      },
      url: 'https://example.com/notype'
    }
  ])('$description', async ({ response, url }) => {
    mockedFetch.mockResolvedValue(response)

    const card = await fetchLinkPreview({ database, url })

    expect(card).toBeNull()
    const stored = await database.getLinkPreview({
      urlHash: getHashFromString(url)
    })
    expect(stored?.fetchStatus).toBe('failed')
  })

  it('accepts an xhtml content type', async () => {
    const url = 'https://example.com/xhtml'
    mockedFetch.mockResolvedValue({
      body: PAGE,
      headers: { 'content-type': 'application/xhtml+xml' },
      statusCode: 200,
      url
    })

    const card = await fetchLinkPreview({ database, url })
    expect(card?.fetchStatus).toBe('completed')
  })

  it('stores a failed row when the page has no usable metadata', async () => {
    const url = 'https://example.com/empty'
    mockedFetch.mockResolvedValue({
      body: '<html><head></head><body>nothing</body></html>',
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      url
    })

    const card = await fetchLinkPreview({ database, url })

    expect(card).toBeNull()
    const stored = await database.getLinkPreview({
      urlHash: getHashFromString(url)
    })
    expect(stored?.fetchStatus).toBe('failed')
  })

  it('resolves a relative image against the final url after redirects', async () => {
    const requestedUrl = 'https://example.com/redirecting'
    mockedFetch.mockResolvedValue({
      body: `<html><head><meta property="og:title" content="Moved">
             <meta property="og:image" content="/img/a.png"></head><body></body></html>`,
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      // safeRemoteFetch reports where the redirect chain actually ended.
      url: 'https://final.example.com/landing'
    })

    const card = await fetchLinkPreview({ database, url: requestedUrl })

    expect(card?.imageUrl).toBe('https://final.example.com/img/a.png')
  })

  it('keeps the requested url as the card url after a redirect', async () => {
    const requestedUrl = 'https://short.example.com/abc'
    mockedFetch.mockResolvedValue(
      htmlResponse(PAGE, 'https://example.com/full-article')
    )

    const card = await fetchLinkPreview({ database, url: requestedUrl })

    expect(card?.url).toBe(requestedUrl)
  })

  it('returns null without fetching for a url that cannot be normalized', async () => {
    const card = await fetchLinkPreview({
      database,
      url: 'javascript:alert(1)'
    })

    expect(card).toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('caps the fetch size and timeout', async () => {
    mockedFetch.mockResolvedValue(
      htmlResponse(PAGE, 'https://example.com/limits')
    )

    await fetchLinkPreview({ database, url: 'https://example.com/limits' })

    const options = mockedFetch.mock.calls[0][0]
    expect(options.maxBodyBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(options.timeoutInMilliseconds).toBeLessThanOrEqual(10_000)
  })
})
