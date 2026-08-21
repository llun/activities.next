import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  LINK_PREVIEW_CONNECT_TIMEOUT_MS,
  LINK_PREVIEW_FAILURE_TTL_MS,
  LINK_PREVIEW_MAX_BODY_BYTES,
  LINK_PREVIEW_MAX_REDIRECTS,
  LINK_PREVIEW_READ_TIMEOUT_MS,
  LINK_PREVIEW_REFRESH_TTL_MS,
  LINK_PREVIEW_TIMEOUT_MS,
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

  it('returns null without fetching for a url that cannot be normalized', async () => {
    const card = await fetchLinkPreview({
      database,
      url: 'javascript:alert(1)'
    })

    expect(card).toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('passes its own size, timeout and redirect budget to the fetcher', async () => {
    mockedFetch.mockResolvedValue(
      htmlResponse(PAGE, 'https://example.com/limits')
    )

    await fetchLinkPreview({ database, url: 'https://example.com/limits' })

    const options = mockedFetch.mock.calls[0][0]
    expect(options.maxBodyBytes).toBe(LINK_PREVIEW_MAX_BODY_BYTES)
    expect(options.maxRedirects).toBe(LINK_PREVIEW_MAX_REDIRECTS)
    // Set explicitly, never via the single `timeoutInMilliseconds` knob: that
    // one is used for BOTH connect and read, so a lone value silently buys a
    // hop of double the intended budget.
    expect(options.connectTimeoutInMilliseconds).toBe(
      LINK_PREVIEW_CONNECT_TIMEOUT_MS
    )
    expect(options.readTimeoutInMilliseconds).toBe(LINK_PREVIEW_READ_TIMEOUT_MS)
    expect(options.timeoutInMilliseconds).toBeUndefined()
  })

  // A hop costs connect + read, and every hop pays it, so the worst case a link
  // preview adds to an inline request is (connect + read) x (redirects + 1).
  // That ceiling is what stops a slow third-party host from holding one of this
  // server's request handlers open on a NoQueue deployment.
  it('keeps the worst-case inline cost bounded', () => {
    expect(LINK_PREVIEW_TIMEOUT_MS).toBe(
      LINK_PREVIEW_CONNECT_TIMEOUT_MS + LINK_PREVIEW_READ_TIMEOUT_MS
    )
    expect(
      LINK_PREVIEW_TIMEOUT_MS * (LINK_PREVIEW_MAX_REDIRECTS + 1)
    ).toBeLessThanOrEqual(10_000)
    expect(LINK_PREVIEW_MAX_BODY_BYTES).toBeLessThan(2 * 1024 * 1024)
  })

  // The card's domain is presented to the reader as "where this link goes", so
  // it has to describe where the content actually came from. Keeping the
  // requested url would let an open redirector on a trusted host badge an
  // attacker's title and image with that trusted domain.
  it('stores the url the content actually came from after a redirect', async () => {
    mockedFetch.mockResolvedValue(
      htmlResponse(PAGE, 'https://real-destination.example/article')
    )

    const card = await fetchLinkPreview({
      database,
      url: 'https://trusted.example.com/redirect?to=elsewhere'
    })

    expect(card?.url).toBe('https://real-destination.example/article')
  })

  // The redirect fix fell back to the requested url when the final one could
  // not be normalized — and nothing bounds a Location header, so padding the
  // target past the length cap put the attacker's content back under the
  // trusted domain.
  it('refuses a card when the final url cannot be established', async () => {
    const url = 'https://trusted.example.com/redirect?to=evil'
    mockedFetch.mockResolvedValue({
      body: PAGE,
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      url: `https://evil.example/${'a'.repeat(3000)}`
    })

    const card = await fetchLinkPreview({ database, url })

    expect(card).toBeNull()
    const stored = await database.getLinkPreview({
      urlHash: getHashFromString(url)
    })
    expect(stored?.fetchStatus).toBe('failed')
  })

  // `imageWidth`/`imageHeight` are `integer` columns: SQLite takes a 64-bit
  // value, PostgreSQL rejects it and fails the INSERT — which the catch turns
  // into a negative-cache row, costing that URL its card permanently on PG
  // while it renders fine on SQLite. Run this file with TEST_DATABASE_TYPE=pg
  // to exercise the backend that actually enforces the column.
  it('stores a card whose declared image dimensions overflow the column', async () => {
    const url = 'https://example.com/huge-dimensions'
    mockedFetch.mockResolvedValue({
      body: `<html><head>
        <meta property="og:title" content="Huge">
        <meta property="og:image" content="https://cdn.example.com/a.png">
        <meta property="og:image:width" content="99999999999999">
        <meta property="og:image:height" content="99999999999999">
      </head><body></body></html>`,
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      url
    })

    const card = await fetchLinkPreview({ database, url })

    expect(card?.fetchStatus).toBe('completed')
    expect(card?.title).toBe('Huge')
    // The dimensions are dropped, not the card.
    expect(card?.imageWidth).toBeNull()
    expect(card?.imageHeight).toBeNull()
    expect(card?.imageUrl).toBe('https://cdn.example.com/a.png')
  })

  it('rejects a page that declares a non-utf8 charset in markup only', async () => {
    const url = 'https://example.com/meta-charset'
    mockedFetch.mockResolvedValue({
      body: '<html><head><meta charset="windows-1251"><meta property="og:title" content="T"></head><body></body></html>',
      // A bare text/html header: the encoding is declared only in the markup.
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      url
    })

    expect(await fetchLinkPreview({ database, url })).toBeNull()
  })

  // ASCII is a strict subset of UTF-8, so these decode byte-for-byte the same
  // way and there is nothing to reject. Refusing them lost the card outright
  // for pages that still declare the older label.
  it.each([
    { description: 'us-ascii in the header', charset: 'us-ascii' },
    { description: 'ascii in the header', charset: 'ascii' },
    { description: 'US-ASCII uppercased', charset: 'US-ASCII' }
  ])('accepts a page declaring $description', async ({ charset }) => {
    const url = `https://example.com/ascii-${charset.toLowerCase()}`
    mockedFetch.mockResolvedValue({
      body: PAGE,
      headers: { 'content-type': `text/html; charset=${charset}` },
      statusCode: 200,
      url
    })

    expect((await fetchLinkPreview({ database, url }))?.title).toBe(
      'A good article'
    )
  })

  it('accepts a page declaring us-ascii in markup only', async () => {
    const url = 'https://example.com/meta-ascii'
    mockedFetch.mockResolvedValue({
      body: '<html><head><meta charset="us-ascii"><meta property="og:title" content="T"></head><body></body></html>',
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
      url
    })

    expect((await fetchLinkPreview({ database, url }))?.title).toBe('T')
  })

  // A card is shared by every status linking the URL, so a failed refresh must
  // leave the working one in place rather than blanking it for all of them.
  it('keeps serving a cached card when a later refresh fails', async () => {
    const url = 'https://example.com/refresh-fails'
    mockedFetch.mockResolvedValue(htmlResponse(PAGE, url))
    await fetchLinkPreview({ database, url })

    await ageRow(url, new Date(Date.now() - LINK_PREVIEW_REFRESH_TTL_MS - 1000))
    mockedFetch.mockRejectedValue(new Error('ERR_HTTP_502'))

    const card = await fetchLinkPreview({ database, url })

    expect(card?.title).toBe('A good article')
    expect(card?.fetchStatus).toBe('completed')
  })
})
