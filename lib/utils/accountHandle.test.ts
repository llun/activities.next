import {
  parseAccountHandle,
  parseAccountUrlHandle,
  parseActorUrlAccountHandle,
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

describe('parseActorUrlAccountHandle', () => {
  it.each([
    {
      description: 'parses a canonical actor url',
      input: 'https://example.com/users/user',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'accepts a trailing slash',
      input: 'https://example.com/users/user/',
      expected: { username: 'user', domain: 'example.com' }
    },
    {
      description: 'decodes a percent encoded username',
      input: 'https://example.com/users/%6eull',
      expected: { username: 'null', domain: 'example.com' }
    },
    {
      description: 'parses a username with underscore',
      input: 'https://example.com/users/user_name',
      expected: { username: 'user_name', domain: 'example.com' }
    },
    {
      description: 'preserves host with explicit port',
      input: 'http://localhost:3000/users/test',
      expected: { username: 'test', domain: 'localhost:3000' }
    },
    {
      description: 'rejects non-http/https protocol',
      input: 'ftp://example.com/users/test',
      expected: null
    },
    {
      description: 'rejects a profile url',
      input: 'https://example.com/@user',
      expected: null
    },
    {
      description: 'rejects a status url under users',
      input: 'https://example.com/users/user/statuses/123',
      expected: null
    },
    {
      description: 'rejects a non-url',
      input: 'user@example.com',
      expected: null
    }
  ])('$description', ({ input, expected }) => {
    expect(parseActorUrlAccountHandle(input)).toEqual(expected)
  })
})

describe('parseAccountUrlHandle', () => {
  it('resolves an ActivityPub actor URL', () => {
    expect(parseAccountUrlHandle('https://example.com/users/test')).toEqual({
      username: 'test',
      domain: 'example.com'
    })
  })

  it('resolves a profile URL', () => {
    expect(parseAccountUrlHandle('https://example.com/@test')).toEqual({
      username: 'test',
      domain: 'example.com'
    })
  })

  it('resolves a profile URL with explicit port', () => {
    expect(parseAccountUrlHandle('http://localhost:3000/@test')).toEqual({
      username: 'test',
      domain: 'localhost:3000'
    })
  })

  it('returns null for non-http protocols', () => {
    expect(parseAccountUrlHandle('ftp://example.com/@test')).toBeNull()
  })

  it('returns null for non-account URLs', () => {
    expect(
      parseAccountUrlHandle('https://example.com/users/test/statuses/1')
    ).toBeNull()
    expect(parseAccountUrlHandle('user@example.com')).toBeNull()
  })
})
