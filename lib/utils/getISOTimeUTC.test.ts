import { getISOTimeUTC, getMastodonTimeUTC } from './getISOTimeUTC'

describe('getISOTimeUTC', () => {
  it('returns date time in +0 timezone with date', () => {
    const timestamp = 1630702800000
    const result = getISOTimeUTC(timestamp)
    expect(result).toBe('2021-09-03T21:00:00Z')
  })

  it('returns date without time', () => {
    const timestamp = 1630702800000
    const result = getISOTimeUTC(timestamp, true)
    expect(result).toBe('2021-09-03')
  })
})

describe('getMastodonTimeUTC', () => {
  // Mastodon clients (e.g. the official iOS app) decode REST `Date` fields with
  // an ISO8601 formatter that requires fractional seconds; a timestamp without
  // them fails to decode and blanks the whole entity. Always emit `.SSS`.
  it('returns ISO8601 in +0 timezone WITH fractional seconds', () => {
    const timestamp = 1630702800000
    expect(getMastodonTimeUTC(timestamp)).toBe('2021-09-03T21:00:00.000Z')
  })

  it('keeps millisecond precision', () => {
    expect(getMastodonTimeUTC(1630702800123)).toBe('2021-09-03T21:00:00.123Z')
  })
})
