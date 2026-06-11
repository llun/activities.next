import { isEmailAllowed, normalizeEmail } from '@/lib/utils/normalizeEmail'

describe('normalizeEmail', () => {
  it.each([
    {
      description: 'lowercases an uppercase address',
      input: 'USER@EXAMPLE.COM',
      expected: 'user@example.com'
    },
    {
      description: 'lowercases a mixed-case address',
      input: 'User@Example.Com',
      expected: 'user@example.com'
    },
    {
      description: 'trims surrounding whitespace',
      input: '  user@example.com  ',
      expected: 'user@example.com'
    },
    {
      description: 'trims and lowercases together',
      input: '  User@Example.Com\n',
      expected: 'user@example.com'
    },
    {
      description: 'leaves an already-canonical address unchanged',
      input: 'user@example.com',
      expected: 'user@example.com'
    }
  ])('$description', ({ input, expected }) => {
    expect(normalizeEmail(input)).toEqual(expected)
  })
})

describe('isEmailAllowed', () => {
  it('allows any email when the allowlist is empty', () => {
    expect(isEmailAllowed([], 'anyone@example.com')).toBeTrue()
  })

  it.each([
    {
      description: 'matches identical casing',
      allow: ['user@example.com'],
      email: 'user@example.com'
    },
    {
      description: 'matches when the input differs in case',
      allow: ['user@example.com'],
      email: 'USER@Example.com'
    },
    {
      description: 'matches when the config entry differs in case',
      allow: ['User@Example.COM'],
      email: 'user@example.com'
    },
    {
      description: 'matches with surrounding whitespace on the input',
      allow: ['user@example.com'],
      email: '  user@example.com '
    }
  ])('$description', ({ allow, email }) => {
    expect(isEmailAllowed(allow, email)).toBeTrue()
  })

  it.each([
    {
      description: 'blocks an address not in the list',
      allow: ['user@example.com'],
      email: 'other@example.com'
    },
    {
      description: 'blocks a near-miss regardless of case',
      allow: ['user@example.com'],
      email: 'USER2@example.com'
    }
  ])('$description', ({ allow, email }) => {
    expect(isEmailAllowed(allow, email)).toBeFalse()
  })
})
