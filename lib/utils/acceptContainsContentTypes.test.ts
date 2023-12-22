import { acceptContainsContentTypes } from './acceptContainsContentTypes'

describe('#acceptContainsContentTypes', () => {
  it('returns true when header value contains one in the content type list', () => {
    const value =
      'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", text/html;q=0.1'
    expect(
      acceptContainsContentTypes(value, [
        'application/activity+json',
        'application/ld+json',
        'application/json'
      ])
    ).toBeTrue()
  })

  it('returns false when header value does not contains any in the list', () => {
    const value =
      'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", text/html;q=0.1'
    expect(acceptContainsContentTypes(value, ['application/json'])).toBeFalse()
  })
})
