import {
  ACTIVITYPUB_CONTENT_TYPE,
  ACTIVITYSTREAM_LD_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  negotiateActivityPubContentType
} from './activityPubContentNegotiation'

describe('#negotiateActivityPubContentType', () => {
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

  it('treats a missing Accept header as accepting ActivityPub JSON', () => {
    expect(negotiateActivityPubContentType(null)).toBe(ACTIVITYPUB_CONTENT_TYPE)
  })
})
