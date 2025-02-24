import { getISOTimeUTC } from './getISOTimeUTC'

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
