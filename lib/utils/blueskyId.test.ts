import { isBlueskyHostUrl } from '@/lib/utils/blueskyHost'
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

describe('isBlueskyHostUrl', () => {
  it.each([
    'https://bsky.app/profile/did:plc:abc',
    'https://bsky.app/profile/did:plc:abc/post/3k44',
    'https://bsky.app/stamps/1',
    'https://bsky.app/actor#main-key',
    'http://bsky.app/inbox',
    'https://BSKY.APP/followers',
    'https://bsky.app:8443/outbox',
    'https://bsky.app./inbox'
  ])('accepts %s', (url) => expect(isBlueskyHostUrl(url)).toBe(true))

  it.each([
    null,
    undefined,
    '',
    'not a url',
    'https://bsky.brid.gy/ap/did:plc:abc',
    'https://brid.gy/foo',
    'https://bsky.social/xrpc/com.atproto.sync.getRepo',
    'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile',
    'https://evil.bsky.app/profile/x',
    'https://bsky.app.evil.test/profile/x',
    'https://example.com/profile/x'
  ])('rejects %s', (url) => expect(isBlueskyHostUrl(url)).toBe(false))
})
