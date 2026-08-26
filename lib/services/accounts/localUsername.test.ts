import {
  LOCAL_USERNAME_MAX_LENGTH,
  localUsernameSchema
} from '@/lib/services/accounts/localUsername'

const parse = (username: string) => localUsernameSchema.safeParse(username)

describe('localUsernameSchema', () => {
  it.each([
    { description: 'a plain name', username: 'alice' },
    { description: 'the reserved-looking word null', username: 'null' },
    { description: 'the word undefined', username: 'undefined' },
    { description: 'digits only', username: '12345' },
    { description: 'a leading underscore', username: '_private' },
    { description: 'dots and dashes inside', username: 'a.b-c_d' },
    { description: 'mixed case', username: 'MixedCase' }
  ])('accepts $description', ({ username }) => {
    const result = parse(username)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe(username)
  })

  it('trims surrounding whitespace rather than rejecting it', () => {
    const result = parse('  null  ')
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe('null')
  })

  // The reason this schema exists. A path segment is percent-decoded on the way
  // back in, so any of these would be stored and federated as an actor id that
  // dereferences to a DIFFERENT actor — on this instance, one whose owner is
  // genuinely named `null`.
  it.each([
    { description: 'lowercase encoded n', username: '%6eull' },
    { description: 'uppercase encoded N', username: '%6Eull' },
    { description: 'a trailing encoded l', username: 'nul%6c' },
    { description: 'an encoded slash', username: 'a%2Fb' },
    { description: 'a bare percent', username: 'ab%' }
  ])(
    'rejects a username that percent-decodes to another id: $description',
    ({ username }) => {
      expect(parse(username).success).toBe(false)
    }
  )

  it.each([
    { description: 'a literal slash', username: 'a/b' },
    { description: 'relative path segments', username: '..' },
    { description: 'a leading dot', username: '.hidden' },
    { description: 'a leading dash', username: '-lead' },
    { description: 'an at sign', username: 'user@host' },
    { description: 'a colon', username: 'a:b' },
    { description: 'inner whitespace', username: 'a b' },
    { description: 'a hash', username: 'a#main-key' },
    { description: 'a question mark', username: 'a?b' },
    { description: 'an empty string', username: '' }
  ])('rejects $description', ({ username }) => {
    expect(parse(username).success).toBe(false)
  })

  it('rejects the federation signing actor username', () => {
    expect(parse('__instance__').success).toBe(false)
    expect(parse('__instance__1').success).toBe(false)
  })

  it('accepts a name at the length limit and rejects one past it', () => {
    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH)).success).toBe(true)
    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH + 1)).success).toBe(false)
  })
})
