import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import {
  getStatusVisibility,
  getTrustedFollowersUrl,
  getVisibility,
  isFollowersCollection
} from './getVisibility'

describe('getVisibility', () => {
  it('returns public when to contains ACTIVITY_STREAM_PUBLIC', () => {
    expect(getVisibility([ACTIVITY_STREAM_PUBLIC], [])).toEqual('public')
    expect(
      getVisibility(
        [ACTIVITY_STREAM_PUBLIC, 'https://example.com/users/test/followers'],
        ['https://example.com/users/someone']
      )
    ).toEqual('public')
  })

  it('returns public when to contains as:Public compact form', () => {
    expect(getVisibility([ACTIVITY_STREAM_PUBLIC_COMPACT], [])).toEqual(
      'public'
    )
    expect(
      getVisibility(
        [
          ACTIVITY_STREAM_PUBLIC_COMPACT,
          'https://example.com/users/test/followers'
        ],
        ['https://example.com/users/someone']
      )
    ).toEqual('public')
  })

  it('returns unlisted when cc contains Public but to does not', () => {
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC]
      )
    ).toEqual('unlisted')
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC_COMPACT]
      )
    ).toEqual('unlisted')
  })

  it('returns private when to/cc contains followers URL but no Public', () => {
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        ['https://example.com/users/someone']
      )
    ).toEqual('private')
    expect(
      getVisibility(
        ['https://example.com/users/someone'],
        ['https://example.com/users/test/followers']
      )
    ).toEqual('private')
  })

  it('returns direct when to contains specific users only', () => {
    expect(getVisibility(['https://example.com/users/someone'], [])).toEqual(
      'direct'
    )
    expect(
      getVisibility(
        [
          'https://example.com/users/someone',
          'https://example.com/users/another'
        ],
        ['https://example.com/users/third']
      )
    ).toEqual('direct')
  })

  it('returns direct when to and cc are empty', () => {
    expect(getVisibility([], [])).toEqual('direct')
  })

  it('returns public/unlisted for the bare Public term', () => {
    expect(getVisibility(['Public'], [])).toEqual('public')
    expect(getVisibility([], ['Public'])).toEqual('unlisted')
  })

  it('detects a followers collection that does not end in /followers', () => {
    const followersUrl = 'https://friendica.example/followers/alice'
    expect(getVisibility([followersUrl], [])).toEqual('direct')
    expect(getVisibility([followersUrl], [], followersUrl)).toEqual('private')
    expect(
      getVisibility([], [followersUrl], 'https://friendica.example/other')
    ).toEqual('direct')
  })

  it('keeps the /followers suffix as a fallback', () => {
    expect(
      getVisibility(
        ['https://misskey.example/users/x/followers'],
        [],
        'https://misskey.example/different'
      )
    ).toEqual('private')
  })
})

describe('isFollowersCollection', () => {
  it('matches the known followers URL exactly', () => {
    expect(
      isFollowersCollection(
        'https://friendica.example/followers/alice',
        'https://friendica.example/followers/alice'
      )
    ).toBe(true)
  })

  it('matches any recipient ending in /followers', () => {
    expect(
      isFollowersCollection('https://misskey.example/users/x/followers')
    ).toBe(true)
    expect(
      isFollowersCollection(
        'https://misskey.example/users/x/followers',
        'https://misskey.example/different'
      )
    ).toBe(true)
  })

  it('does not match a plain actor or a different collection', () => {
    expect(isFollowersCollection('https://example.com/users/someone')).toBe(
      false
    )
    expect(
      isFollowersCollection(
        'https://friendica.example/followers/alice',
        'https://friendica.example/followers/bob'
      )
    ).toBe(false)
  })

  it('does not match when the known followers URL is absent', () => {
    expect(
      isFollowersCollection('https://friendica.example/followers/alice', null)
    ).toBe(false)
    expect(
      isFollowersCollection('https://friendica.example/followers/alice')
    ).toBe(false)
  })
})

describe('getTrustedFollowersUrl', () => {
  const actorId = 'https://friendica.test/profile/alice'

  it('keeps a followers URL on the author origin', () => {
    expect(
      getTrustedFollowersUrl(actorId, 'https://friendica.test/followers/alice')
    ).toEqual('https://friendica.test/followers/alice')
  })

  it('drops a followers URL on another origin', () => {
    expect(
      getTrustedFollowersUrl(actorId, 'https://local.test/users/victim')
    ).toBeNull()
  })

  it('drops a followers URL equal to the author id', () => {
    expect(getTrustedFollowersUrl(actorId, actorId)).toBeNull()
  })

  it('drops a missing followers URL', () => {
    expect(getTrustedFollowersUrl(actorId, null)).toBeNull()
    expect(getTrustedFollowersUrl(actorId, undefined)).toBeNull()
  })
})

describe('getStatusVisibility', () => {
  // Friendica names the collection `/followers/<nick>`, so the suffix rule
  // alone reads a followers-only post as direct.
  const actorId = 'https://friendica.test/profile/alice'
  const followersUrl = 'https://friendica.test/followers/alice'
  const friendicaFollowersOnly = {
    actorId,
    to: [followersUrl],
    cc: [],
    actor: { followersUrl }
  }

  it('reads a Friendica followers-only status as private', () => {
    expect(getStatusVisibility(friendicaFollowersOnly)).toEqual('private')
  })

  it('keeps a mentioned account in cc private, not direct', () => {
    expect(
      getStatusVisibility({
        ...friendicaFollowersOnly,
        cc: ['https://friendica.test/profile/bob']
      })
    ).toEqual('private')
  })

  it('reads it as direct when the author is unknown', () => {
    expect(
      getStatusVisibility({ ...friendicaFollowersOnly, actor: null })
    ).toEqual('direct')
    expect(
      getStatusVisibility({
        actorId,
        to: friendicaFollowersOnly.to,
        cc: friendicaFollowersOnly.cc
      })
    ).toEqual('direct')
  })

  it('ignores a followers URL that names another account', () => {
    // A remote actor whose document claims a local user's id as its followers
    // collection must not turn a DM to that user into a followers-only post.
    expect(
      getStatusVisibility({
        actorId: 'https://evil.test/users/mallory',
        to: ['https://local.test/users/victim'],
        cc: [],
        actor: { followersUrl: 'https://local.test/users/victim' }
      })
    ).toEqual('direct')
  })
})
