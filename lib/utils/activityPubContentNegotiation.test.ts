import {
  ACTIVITYPUB_CONTENT_TYPE,
  ACTIVITYSTREAM_LD_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  activityPubResponse,
  negotiateActivityPubContentType
} from './activityPubContentNegotiation'

describe('negotiateActivityPubContentType', () => {
  it('returns the most preferred ActivityPub content type from weighted headers', () => {
    expect(
      negotiateActivityPubContentType(
        'application/json;q=0.9, application/activity+json;q=1, text/html;q=0.8'
      )
    ).toBe(ACTIVITYPUB_CONTENT_TYPE)
  })

  it('recognizes ActivityStreams JSON-LD profile requests', () => {
    expect(
      negotiateActivityPubContentType(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
      )
    ).toBe(ACTIVITYSTREAM_LD_CONTENT_TYPE)
  })

  it('recognizes ActivityStreams JSON-LD profile requests with multiple profile tokens', () => {
    expect(
      negotiateActivityPubContentType(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams https://example.com/other"'
      )
    ).toBe(ACTIVITYSTREAM_LD_CONTENT_TYPE)
  })

  it('does not treat blank JSON-LD profiles as ActivityStreams requests', () => {
    expect(
      negotiateActivityPubContentType('application/ld+json; profile=""')
    ).toBeNull()
  })

  it('recognizes generic JSON requests', () => {
    expect(negotiateActivityPubContentType('application/json')).toBe(
      JSON_CONTENT_TYPE
    )
  })

  it('recognizes wildcard requests as ActivityPub JSON', () => {
    expect(negotiateActivityPubContentType('*/*')).toBe(
      ACTIVITYPUB_CONTENT_TYPE
    )
  })

  it('lets a preferred HTML representation win over wildcard JSON', () => {
    expect(
      negotiateActivityPubContentType(
        'text/html, application/xhtml+xml, */*;q=0.8'
      )
    ).toBeNull()
  })

  it('uses header order to break equal preference ties between ActivityPub and HTML', () => {
    expect(
      negotiateActivityPubContentType('application/activity+json, text/html')
    ).toBe(ACTIVITYPUB_CONTENT_TYPE)
    expect(
      negotiateActivityPubContentType('text/html, application/activity+json')
    ).toBeNull()
  })

  it('treats a missing Accept header as accepting ActivityPub JSON', () => {
    expect(negotiateActivityPubContentType(null)).toBe(ACTIVITYPUB_CONTENT_TYPE)
  })
})

describe('activityPubResponse', () => {
  it('marks negotiated responses as varying by Accept', () => {
    const response = activityPubResponse({
      req: new Request('https://example.com', {
        headers: { accept: 'application/activity+json' }
      }) as never,
      data: { ok: true }
    })

    expect(response.headers.get('vary')).toBe('Accept')
  })

  it('allows callers to override CORS methods', () => {
    const response = activityPubResponse({
      req: new Request('https://example.com', {
        headers: { accept: 'application/activity+json' }
      }) as never,
      data: { ok: true },
      allowedMethods: ['GET', 'POST']
    })

    expect(response.headers.get('access-control-allow-methods')).toBe(
      'GET,POST'
    )
  })
})
