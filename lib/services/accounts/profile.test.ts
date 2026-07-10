import { Mastodon } from '@/lib/types/activitypub'
import { ActorSettings } from '@/lib/types/database/rows'

import { buildProfile } from './profile'

const baseSettings: ActorSettings = {
  followersUrl: 'https://llun.test/users/alice/followers',
  inboxUrl: 'https://llun.test/users/alice/inbox',
  sharedInboxUrl: 'https://llun.test/inbox'
}

const account: Mastodon.Account = {
  id: 'abc123',
  username: 'alice',
  acct: 'alice',
  url: 'https://llun.test/users/alice',
  display_name: 'Alice',
  note: '<p>rendered bio</p>',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {
    note: 'raw bio *not html*',
    fields: [{ name: 'site', value: 'https://alice.test', verified_at: null }],
    privacy: 'public',
    sensitive: false,
    language: 'en',
    follow_requests_count: 0
  },
  fields: [{ name: 'site', value: 'https://alice.test', verified_at: null }],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z',
  last_status_at: null,
  statuses_count: 0,
  followers_count: 0,
  following_count: 0
}

describe('buildProfile', () => {
  it('emits null avatar/header when unset and the raw source note and fields', () => {
    expect(buildProfile({ account, settings: baseSettings })).toEqual({
      id: 'abc123',
      display_name: 'Alice',
      note: 'raw bio *not html*',
      fields: [
        { name: 'site', value: 'https://alice.test', verified_at: null }
      ],
      avatar: null,
      avatar_static: null,
      avatar_description: '',
      header: null,
      header_static: null,
      header_description: '',
      locked: false,
      bot: false,
      hide_collections: null,
      discoverable: true,
      indexable: false,
      show_media: true,
      show_media_replies: true,
      show_featured: true,
      attribution_domains: []
    })
  })

  it('carries stored image urls and appearance settings through', () => {
    const profile = buildProfile({
      account,
      settings: {
        ...baseSettings,
        iconUrl: 'https://llun.test/avatar.png',
        headerImageUrl: 'https://llun.test/header.png',
        avatarDescription: 'Coffee cup close-up',
        headerDescription: 'Mountains at dawn',
        showMedia: false,
        showMediaReplies: false,
        showFeatured: false,
        attributionDomains: ['news.example.com']
      }
    })
    expect(profile).toMatchObject({
      avatar: 'https://llun.test/avatar.png',
      avatar_static: 'https://llun.test/avatar.png',
      avatar_description: 'Coffee cup close-up',
      header: 'https://llun.test/header.png',
      header_static: 'https://llun.test/header.png',
      header_description: 'Mountains at dawn',
      show_media: false,
      show_media_replies: false,
      show_featured: false,
      attribution_domains: ['news.example.com']
    })
  })

  it('handles missing settings with documented defaults', () => {
    const profile = buildProfile({ account, settings: undefined })
    expect(profile.avatar).toBeNull()
    expect(profile.show_media).toBe(true)
    expect(profile.attribution_domains).toEqual([])
  })
})
