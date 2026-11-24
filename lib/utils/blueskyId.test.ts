import {
  BLUESKY_DOMAIN,
  BLUESKY_PROFILE_PREFIX,
  isBlueskyId
} from '@/lib/utils/blueskyId'

describe('isBlueskyId', () => {
  it.each([
    'https://bsky.app/profile/did:plc:abc',
    'https://bsky.app/profile/did:plc:abc/post/3k44'
  ])('accepts %s', (id) => expect(isBlueskyId(id)).toBe(true))

  it('accepts an id built from the shared prefix', () => {
    expect(BLUESKY_PROFILE_PREFIX).toBe(`https://${BLUESKY_DOMAIN}/profile/`)
    expect(isBlueskyId(`${BLUESKY_PROFILE_PREFIX}did:plc:abc`)).toBe(true)
  })

  it.each([
    null,
    undefined,
    '',
    'not a url',
    'http://bsky.app/profile/did:plc:abc',
    'https://bsky.app/about',
    'https://evil.bsky.app/profile/x',
    'https://bsky.app.evil.test/profile/x',
    'https://example.com/profile/x'
  ])('rejects %s', (id) => expect(isBlueskyId(id)).toBe(false))
})
