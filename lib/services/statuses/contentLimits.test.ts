import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'

import { validateStatusContentLimits } from './contentLimits'

const settingsWith = (
  overrides: Partial<{
    maxCharacters: number
    maxOptions: number
    maxCharactersPerOption: number
    minExpirationSeconds: number
    maxExpirationSeconds: number
  }> = {}
) => ({
  ...structuredClone(DEFAULT_SERVER_SETTINGS),
  posts: {
    ...DEFAULT_SERVER_SETTINGS.posts,
    maxCharacters: overrides.maxCharacters ?? 500
  },
  polls: {
    maxOptions: overrides.maxOptions ?? 4,
    maxCharactersPerOption: overrides.maxCharactersPerOption ?? 50,
    minExpirationSeconds: overrides.minExpirationSeconds ?? 300,
    maxExpirationSeconds: overrides.maxExpirationSeconds ?? 2678400
  }
})

describe('validateStatusContentLimits', () => {
  it('accepts text within the character limit', () => {
    expect(
      validateStatusContentLimits({ status: 'hello' }, settingsWith())
    ).toBeNull()
  })

  it('rejects text over the resolved character limit', () => {
    const result = validateStatusContentLimits(
      { status: 'x'.repeat(11) },
      settingsWith({ maxCharacters: 10 })
    )
    expect(result).toBe('Text character limit of 10 exceeded')
  })

  it('allows a longer post when the limit is raised', () => {
    expect(
      validateStatusContentLimits(
        { status: 'x'.repeat(1000) },
        settingsWith({ maxCharacters: 5000 })
      )
    ).toBeNull()
  })

  it('rejects a poll with too many options', () => {
    const result = validateStatusContentLimits(
      { poll: { options: ['a', 'b', 'c', 'd', 'e'], expires_in: 3600 } },
      settingsWith({ maxOptions: 4 })
    )
    expect(result).toBe('Poll cannot have more than 4 options')
  })

  it('accepts more poll options when the limit is raised', () => {
    expect(
      validateStatusContentLimits(
        { poll: { options: ['a', 'b', 'c', 'd', 'e', 'f'], expires_in: 3600 } },
        settingsWith({ maxOptions: 6 })
      )
    ).toBeNull()
  })

  it('rejects a poll option over the per-option character limit', () => {
    const result = validateStatusContentLimits(
      { poll: { options: ['ok', 'x'.repeat(51)], expires_in: 3600 } },
      settingsWith({ maxCharactersPerOption: 50 })
    )
    expect(result).toBe('Poll option character limit of 50 exceeded')
  })

  it('rejects a poll expiry outside the resolved range', () => {
    expect(
      validateStatusContentLimits(
        { poll: { options: ['a', 'b'], expires_in: 60 } },
        settingsWith({ minExpirationSeconds: 300 })
      )
    ).toBe('Poll expiration is out of range')
    expect(
      validateStatusContentLimits(
        { poll: { options: ['a', 'b'], expires_in: 9999999 } },
        settingsWith({ maxExpirationSeconds: 2678400 })
      )
    ).toBe('Poll expiration is out of range')
  })
})
