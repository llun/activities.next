import { getISOTimeUTC } from './getISOTimeUTC'

describe('getISOTimeUTC', () => {
  // Always emit fractional seconds for Mastodon compatibility: clients (e.g. the
  // official iOS app) decode REST `Date` fields with an ISO8601 formatter that
  // requires them, and ActivityPub `published` accepts them too.
  it('returns date time in +0 timezone with fractional seconds', () => {
    const timestamp = 1630702800000
    const result = getISOTimeUTC(timestamp)
    expect(result).toBe('2021-09-03T21:00:00.000Z')
  })

  it('keeps millisecond precision', () => {
    expect(getISOTimeUTC(1630702800123)).toBe('2021-09-03T21:00:00.123Z')
  })

  it('returns date without time', () => {
    const timestamp = 1630702800000
    const result = getISOTimeUTC(timestamp, true)
    expect(result).toBe('2021-09-03')
  })
})
