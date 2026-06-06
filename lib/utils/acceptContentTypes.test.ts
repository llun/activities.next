import {
  acceptContentTypes,
  parseAcceptContentTypes
} from './acceptContentTypes'

describe('acceptContentTypes', () => {
  it('returns list of content types that client send in', () => {
    const value = 'application/json'
    expect(acceptContentTypes(value)).toEqual(['application/json'])
  })

  it('returns multiple content types order by quality factor', () => {
    const value =
      'application/json;q=0.9, application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", text/html;q=0.1'
    expect(acceptContentTypes(value)).toEqual([
      'application/activity+json',
      'application/ld+json',
      'application/json',
      'text/html'
    ])
  })

  it('ignores invalid and explicitly unacceptable content types', () => {
    const value =
      'not-a-media-type, application/json;q=0, application/activity+json;q=0.8'
    expect(acceptContentTypes(value)).toEqual(['application/activity+json'])
  })

  it('keeps escaped quotes inside quoted parameter values', () => {
    const value =
      'application/json; note="escaped\\",still quoted";q=0.9, text/html;q=0.8'

    expect(parseAcceptContentTypes(value)).toMatchObject([
      {
        type: 'application/json',
        parameters: { note: 'escaped",still quoted' },
        quality: 0.9
      },
      {
        type: 'text/html',
        quality: 0.8
      }
    ])
  })

  it('unescapes generic quoted-pair parameter values', () => {
    const value = String.raw`application/json; note="a\\b\t\"quoted";q=0.9`

    expect(parseAcceptContentTypes(value)).toMatchObject([
      {
        type: 'application/json',
        parameters: { note: 'a\\bt"quoted' },
        quality: 0.9
      }
    ])
  })
})
