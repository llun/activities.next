import { isRealAvatar } from '@/lib/utils/isRealAvatar'

describe('isRealAvatar', () => {
  it.each([
    ['a real uploaded URL', 'https://cdn.example.com/u/avatar.jpg', true],
    ['gravatar', 'https://gravatar.com/avatar/abc', false],
    ['ui-avatars', 'https://ui-avatars.com/api/?name=A', false],
    ['robohash', 'https://robohash.org/abc', false],
    ['dicebear', 'https://api.dicebear.com/7.x/abc.svg', false],
    ['boringavatars', 'https://source.boringavatars.com/beam/abc', false],
    ['a default placeholder', 'https://example.com/default-avatar.png', false],
    ['a placeholder', 'https://example.com/placeholder.png', false]
  ])('treats %s as real=%s', (_label, url, expected) => {
    expect(isRealAvatar(url)).toBe(expected)
  })

  it('returns false for missing values', () => {
    expect(isRealAvatar(undefined)).toBe(false)
    expect(isRealAvatar(null)).toBe(false)
    expect(isRealAvatar('')).toBe(false)
  })
})
