import {
  isActivityPubContentType,
  isActivityPubDocumentResponse
} from './activityPubResponse'

describe('isActivityPubContentType', () => {
  // The forms real servers label an actor or object with: Mastodon, Misskey,
  // Akkoma and PeerTube send the charset form, Lemmy the bare one, and the JSON-LD form is the one the spec names alongside it.
  it.each([
    'application/activity+json',
    'application/activity+json; charset=utf-8',
    'Application/Activity+JSON; Charset=UTF-8',
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    'application/ld+json;profile="https://www.w3.org/ns/activitystreams"',
    'application/ld+json; charset=utf-8; profile="https://www.w3.org/ns/activitystreams"',
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams https://w3id.org/security/v1"',
    'application/ld+json; PROFILE="https://www.w3.org/ns/activitystreams"'
  ])('accepts %s', (contentType) => {
    expect(isActivityPubContentType(contentType)).toBe(true)
  })

  // Mastodon refuses all of these too (CVE-2024-23832): an upload server
  // labels attacker JSON with one of the first three, and plain JSON-LD is not
  // necessarily ActivityStreams.
  it.each([
    undefined,
    '',
    'application/json',
    'application/octet-stream',
    'text/plain',
    'text/html; charset=utf-8',
    'application/ld+json',
    'application/ld+json; profile="https://example.com/other"',
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams#"',
    'application/activity+json, text/html',
    'application/jrd+json'
  ])('refuses %s', (contentType) => {
    expect(isActivityPubContentType(contentType)).toBe(false)
  })
})

describe('isActivityPubDocumentResponse', () => {
  const url = 'https://remote.test/users/alice'
  const activityJson = { 'content-type': 'application/activity+json' }

  it('reads a 200 labelled ActivityPub', () => {
    expect(
      isActivityPubDocumentResponse(
        { statusCode: 200, headers: activityJson },
        url
      )
    ).toBe(true)
  })

  it('refuses a 200 labelled anything else', () => {
    expect(
      isActivityPubDocumentResponse(
        { statusCode: 200, headers: { 'content-type': 'application/json' } },
        url
      )
    ).toBe(false)
  })

  // A 404 or 410 labelled ActivityPub (a Tombstone body, say) is still not a
  // document to read: callers that care about gone objects read the status.
  it.each([404, 410, 500])(
    'refuses a %i even when labelled ActivityPub',
    (statusCode) => {
      expect(
        isActivityPubDocumentResponse(
          { statusCode, headers: activityJson },
          url
        )
      ).toBe(false)
    }
  )
})
