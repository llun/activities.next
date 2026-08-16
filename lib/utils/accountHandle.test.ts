import {
  parseAccountHandle,
  parseProfileUrlAccountHandle,
  stripAcctPrefix
} from './accountHandle'

describe('parseAccountHandle', () => {
  it.each([
    {
      description: 'parses a bare handle',
      input: 'user@example.com',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'strips a leading at sign',
      input: '@user@example.com',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'lowercases the domain',
      input: 'user@Example.COM',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'trims surrounding whitespace',
      input: '  user@example.com  ',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'rejects an extra domain part',
      input: 'user@example.com@evil.test',
      expected: null
    },
    { description: 'rejects a bare username', input: 'user', expected: null },
    {
      description: 'rejects a missing username',
      input: '@example.com',
      expected: null
    },
    { description: 'rejects an empty value', input: '', expected: null }
  ])('$description', ({ input, expected }) => {
    expect(parseAccountHandle(input)).toEqual(expected)
  })
})

describe('stripAcctPrefix', () => {
  it.each([
    {
      description: 'removes a lowercase acct prefix',
      input: 'acct:user@example.com',
      expected: 'user@example.com'
    },
    {
      description: 'removes an uppercase acct prefix',
      input: 'ACCT:user@example.com',
      expected: 'user@example.com'
    },
    {
      description: 'removes a mixed case acct prefix',
      input: 'Acct:user@example.com',
      expected: 'user@example.com'
    },
    {
      description: 'leaves a value without the prefix alone',
      input: 'user@example.com',
      expected: 'user@example.com'
    },
    {
      description: 'trims surrounding whitespace',
      input: '  acct:user@example.com ',
      expected: 'user@example.com'
    },
    {
      description: 'does not strip acct inside a username',
      input: 'acctuser@example.com',
      expected: 'acctuser@example.com'
    }
  ])('$description', ({ input, expected }) => {
    expect(stripAcctPrefix(input)).toEqual(expected)
  })
})

describe('parseProfileUrlAccountHandle', () => {
  it.each([
    {
      description: 'qualifies a bare profile handle with the url host',
      input: 'https://example.com/@user',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'keeps a fully qualified profile handle',
      input: 'https://example.com/@user@other.test',
      expected: { username: 'user', domain: 'other.test' }
    },
    {
      description: 'accepts a trailing slash',
      input: 'https://example.com/@user/',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'decodes a percent encoded segment',
      input: 'https://example.com/@user%40other.test',
      expected: { username: 'user', domain: 'other.test' }
    },
    {
      description: 'rejects a status permalink',
      input: 'https://example.com/@user/12345',
      expected: null
    },
    {
      description: 'rejects an actor uri without the profile path shape',
      input: 'https://example.com/users/user',
      expected: null
    },
    {
      description: 'rejects a non url value',
      input: 'user@example.com',
      expected: null
    }
  ])('$description', ({ input, expected }) => {
    expect(parseProfileUrlAccountHandle(input)).toEqual(expected)
  })
})
