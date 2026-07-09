import { getMuteExpiresAt } from './getMuteExpiresAt'

describe('getMuteExpiresAt', () => {
  it.each([
    {
      description: 'returns the ISO 8601 expiry for a timed mute',
      endsAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      expected: '2026-01-02T03:04:05.000Z'
    },
    {
      description: 'returns null for an indefinite mute',
      endsAt: null,
      expected: null
    }
  ])('$description', ({ endsAt, expected }) => {
    expect(getMuteExpiresAt({ endsAt })).toEqual(expected)
  })
})
