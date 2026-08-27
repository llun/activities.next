import {
  LOCAL_USERNAME_MAX_LENGTH,
  localUsernameSchema
} from '@/lib/services/accounts/localUsername'
import { normalizeUsername } from '@/lib/utils/normalizeUsername'

const parse = (username: string) => localUsernameSchema.safeParse(username)

describe('localUsernameSchema', () => {
  it.each([
    { description: 'a plain name', username: 'alice' },
    { description: 'the reserved-looking word null', username: 'null' },
    { description: 'the word undefined', username: 'undefined' },
    { description: 'digits only', username: '12345' },
    { description: 'a leading underscore', username: '_private' },
    { description: 'dots and dashes inside', username: 'a.b-c_d' }
  ])('accepts $description unchanged', ({ username }) => {
    const result = parse(username)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe(username)
  })

  it('trims surrounding whitespace rather than rejecting it', () => {
    const result = parse('  null  ')
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe('null')
  })

  // A local username IS the actor id's last path segment, so accepting both
  // spellings would mint two actors no case-insensitive client can tell apart.
  it.each([
    { description: 'all caps', username: 'ALICE', expected: 'alice' },
    { description: 'mixed case', username: 'MixedCase', expected: 'mixedcase' },
    { description: 'one capital', username: 'Alice', expected: 'alice' },
    {
      description: 'case plus surrounding whitespace',
      username: '  Alice  ',
      expected: 'alice'
    }
  ])(
    'lowercases $description rather than rejecting it',
    ({ username, expected }) => {
      const result = parse(username)
      expect(result.success).toBe(true)
      expect(result.success && result.data).toBe(expected)
    }
  )

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

  // isFederationSigningActorUsername is a case-SENSITIVE startsWith, so before
  // the schema folded first these minted a confusable neighbour of the instance
  // actor: refused as `__instance__`, accepted as `__INSTANCE__`. The fold has
  // to run before the refine, not after it.
  it.each([
    { description: 'all caps', username: '__INSTANCE__' },
    { description: 'mixed case', username: '__Instance__' },
    { description: 'an indexed one in caps', username: '__INSTANCE__1' }
  ])(
    'rejects the reserved username spelled with $description',
    ({ username }) => {
      expect(parse(username).success).toBe(false)
    }
  )

  // The schema folds with Zod's own `.trim().toLowerCase()` rather than by
  // calling `normalizeUsername`, mirroring how the email schemas relate to
  // `normalizeEmail`. That means the mint-time rule has TWO spellings, and
  // nothing else makes them agree: teach `normalizeUsername` to strip a
  // trailing dot and `registerAccount`/`createAccount` would follow while this
  // schema kept validating the unstripped name. This is the pin.
  it.each([
    { description: 'a plain name', username: 'alice' },
    { description: 'mixed case', username: 'MixedCase' },
    { description: 'all caps', username: 'ALICE' },
    { description: 'surrounding whitespace', username: '  Alice  ' },
    { description: 'dots and dashes', username: 'A.b-C_d' },
    // `LOCAL_USERNAME_PATTERN` allows a trailing dot, and this is the exact
    // divergence the comment above names — teach `normalizeUsername` to strip
    // one and only a fixture ending in one can notice. Without this row that
    // scenario passed.
    { description: 'a trailing dot', username: 'Alice.' }
  ])('agrees with normalizeUsername on $description', ({ username }) => {
    const result = parse(username)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe(normalizeUsername(username))
  })

  it('accepts a name at the length limit and rejects one past it', () => {
    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH)).success).toBe(true)
    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH + 1)).success).toBe(false)
  })
})
