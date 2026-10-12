import { formatBucketHour, truncateToHour } from './counterBucket'

describe('counterBucket utils', () => {
  describe('formatBucketHour', () => {
    it.each([
      {
        description: 'formats a date to compact UTC hour string',
        input: '2026-03-24T14:30:00Z',
        expected: '2026032414'
      },
      {
        description: 'pads single-digit months, days, and hours',
        input: '2026-01-05T03:00:00Z',
        expected: '2026010503'
      },
      {
        description: 'handles midnight correctly',
        input: '2026-12-31T00:00:00Z',
        expected: '2026123100'
      },
      {
        description: 'handles end of day correctly',
        input: '2026-06-15T23:59:59Z',
        expected: '2026061523'
      }
    ])('$description', ({ input, expected }) => {
      expect(formatBucketHour(new Date(input))).toBe(expected)
    })
  })

  describe('truncateToHour', () => {
    it('truncates minutes, seconds, and milliseconds', () => {
      const date = new Date('2026-03-24T14:45:30.123Z')
      const result = truncateToHour(date)
      expect(result.toISOString()).toBe('2026-03-24T14:00:00.000Z')
    })

    it('returns same value for already-truncated dates', () => {
      const date = new Date('2026-03-24T14:00:00.000Z')
      const result = truncateToHour(date)
      expect(result.toISOString()).toBe('2026-03-24T14:00:00.000Z')
    })

    it('uses UTC, not local time', () => {
      const date = new Date('2026-03-24T00:30:00.000Z')
      const result = truncateToHour(date)
      expect(result.getUTCHours()).toBe(0)
      expect(result.getUTCMinutes()).toBe(0)
    })
  })
})
