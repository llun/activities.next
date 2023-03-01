import { acceptContainsContentTypes, acceptContentTypes } from './accept'

describe('#acceptContentTypes', () => {
  it('returns list of content types that client send in', () => {
    const value = 'application/json'
    expect(acceptContentTypes(value)).toEqual(['application/json'])
  })

  it('returns multiple content types order by quality factor', () => {
    const value =
      'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", text/html;q=0.1'
    expect(acceptContentTypes(value)).toEqual([
      'application/activity+json',
      'application/ld+json',
      'text/html'
    ])
  })
})

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
