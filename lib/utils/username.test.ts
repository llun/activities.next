import {
  REMOTE_USERNAME_HARD_LIMIT,
  isValidRemoteUsername,
  squishUsername
} from './username'

describe('isValidRemoteUsername', () => {
  it.each([
    'alice',
    'alice.bob',
    'alice_bob',
    'al-ice',
    'Alice9',
    '_x',
    'a.-b'
  ])('accepts %s', (username) => {
    expect(isValidRemoteUsername(username)).toBe(true)
  })

  it.each([
    ['=cmd', '=cmd'],
    ['+1', '+1'],
    ['-x', '-x'],
    ['@x', '@x'],
    ['trailing dot run', 'a..'],
    ['trailing dot', 'alice.'],
    ['leading dot', '.alice'],
    ['trailing dash', 'alice-'],
    ['unicode', 'алиса'],
    ['accented', 'élise'],
    ['Kelvin sign', 'alice\u212a'],
    ['space', 'al ice'],
    ['trailing newline', 'alice\n'],
    ['slash', 'a/b'],
    ['at sign', 'a@b'],
    ['colon', 'a:b'],
    ['empty', '']
  ])('refuses %s', (_name, username) => {
    expect(isValidRemoteUsername(username)).toBe(false)
  })

  it('accepts a dot run between word characters, as Mastodon does', () => {
    expect(isValidRemoteUsername('a..b')).toBe(true)
  })

  it("caps at the smaller of Mastodon's 2048 and the varchar(255) column", () => {
    expect(REMOTE_USERNAME_HARD_LIMIT).toBe(255)
    expect(isValidRemoteUsername('a'.repeat(255))).toBe(true)
    expect(isValidRemoteUsername('a'.repeat(256))).toBe(false)
    expect(isValidRemoteUsername('a'.repeat(2049))).toBe(false)
  })

  it('refuses non-strings', () => {
    expect(isValidRemoteUsername(undefined)).toBe(false)
    expect(isValidRemoteUsername(42)).toBe(false)
  })
})

describe('squishUsername', () => {
  it('trims and collapses whitespace like Rails squish', () => {
    expect(squishUsername('  alice \n ')).toBe('alice')
    expect(squishUsername('al \t ice')).toBe('al ice')
  })

  it('squishes U+0085 (NEL) but keeps U+FEFF, like [[:space:]]', () => {
    expect(squishUsername('\u0085carol\u0085')).toBe('carol')
    expect(squishUsername('\uFEFFcarol')).toBe('\uFEFFcarol')
    expect(isValidRemoteUsername(squishUsername('\uFEFFcarol'))).toBe(false)
    expect(squishUsername('\u00a0 carol\u3000')).toBe('carol')
  })
})
