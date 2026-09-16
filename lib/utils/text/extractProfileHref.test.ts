import { describe, expect, it } from 'vitest'

import { Tag } from '@/lib/types/domain/tag'

import { extractProfileHref } from './extractProfileHref'

describe('extractProfileHref', () => {
  const host = 'activities.local'

  it('returns undefined for empty or non-URL inputs', () => {
    expect(extractProfileHref(undefined)).toBeUndefined()
    expect(extractProfileHref('')).toBeUndefined()
    expect(extractProfileHref('not a url')).toBeUndefined()
  })

  it('returns undefined for general website links', () => {
    expect(extractProfileHref('https://example.com/about')).toBeUndefined()
    expect(
      extractProfileHref('https://example.com/blog/my-post')
    ).toBeUndefined()
  })

  it('returns undefined for status permalinks', () => {
    expect(
      extractProfileHref('https://mastodon.social/@alice/112345678901234567')
    ).toBeUndefined()
    expect(
      extractProfileHref('https://remote.social/users/bob/statuses/987654')
    ).toBeUndefined()
  })

  it('preserves already-local profile paths', () => {
    expect(extractProfileHref('/@alice')).toBe('/@alice')
    expect(extractProfileHref('/@alice@remote.social')).toBe(
      '/@alice@remote.social'
    )
  })

  it('rewrites remote Mastodon-style profile URL to local profile route', () => {
    expect(extractProfileHref('https://mastodon.social/@alice', { host })).toBe(
      '/@alice@mastodon.social'
    )
  })

  it('rewrites remote actor URL (/users/...) to local profile route', () => {
    expect(
      extractProfileHref('https://remote.social/users/bob', { host })
    ).toBe('/@bob@remote.social')
  })

  it('rewrites local server profile URL to local route without redundant domain', () => {
    expect(extractProfileHref(`https://${host}/@charlie`, { host })).toBe(
      '/@charlie'
    )
  })

  it('rewrites local server handle with remote domain to local route', () => {
    expect(
      extractProfileHref(`https://${host}/@dan@somewhere.test`, { host })
    ).toBe('/@dan@somewhere.test')
  })

  it('resolves unconventional profile URL matching a status mention tag', () => {
    const tags: Tag[] = [
      {
        id: 'tag-1',
        statusId: 'status-1',
        type: 'mention',
        name: '@custom_user@special.org',
        value: 'https://special.org/actors/custom_user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]

    expect(
      extractProfileHref('https://special.org/actors/custom_user', {
        host,
        tags
      })
    ).toBe('/@custom_user@special.org')
  })

  it('derives domain from tag value URL when tag name lacks domain', () => {
    const tags: Tag[] = [
      {
        id: 'tag-2',
        statusId: 'status-1',
        type: 'mention',
        name: '@simple_user',
        value: 'https://fediverse.example/profiles/simple_user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]

    expect(
      extractProfileHref('https://fediverse.example/profiles/simple_user', {
        host,
        tags
      })
    ).toBe('/@simple_user@fediverse.example')
  })

  it('resolves Bluesky profile URL to bridged handle', () => {
    expect(
      extractProfileHref('https://bsky.app/profile/alice.bsky.social')
    ).toBe('/@alice.bsky.social@bsky.brid.gy')
  })
})
