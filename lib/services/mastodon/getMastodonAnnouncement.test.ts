import { AnnouncementData } from '@/lib/types/database/operations'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

import { getMastodonAnnouncement } from './getMastodonAnnouncement'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
}))

const baseAnnouncement: AnnouncementData = {
  id: 'announcement-1',
  text: 'Hello **world**',
  published: true,
  allDay: false,
  startsAt: Date.UTC(2024, 0, 1, 0, 0, 0),
  endsAt: Date.UTC(2024, 0, 2, 0, 0, 0),
  publishedAt: Date.UTC(2024, 0, 1, 12, 0, 0),
  createdAt: Date.UTC(2024, 0, 1, 11, 0, 0),
  updatedAt: Date.UTC(2024, 0, 1, 12, 30, 0)
}

const tadaEmoji: CustomEmojiData = {
  id: 'emoji-1',
  shortcode: 'tada',
  url: 'https://llun.test/emojis/tada.png',
  staticUrl: 'https://llun.test/emojis/tada-static.png',
  category: null,
  visibleInPicker: true,
  disabled: false,
  createdAt: 1000,
  updatedAt: 1000
}

describe('getMastodonAnnouncement', () => {
  it('renders the content as HTML rather than the raw markdown text', () => {
    const announcement = getMastodonAnnouncement({
      announcement: baseAnnouncement,
      read: false,
      reactions: [],
      customEmojis: []
    })
    expect(announcement.content).not.toBe(baseAnnouncement.text)
    expect(announcement.content).toContain('<strong>world</strong>')
  })

  it.each([
    {
      description: 'strips a script tag',
      text: '<script>alert(1)</script>',
      forbidden: '<script'
    },
    {
      description: 'strips an img onerror handler',
      text: '<img src=x onerror=alert(1)>',
      forbidden: 'onerror'
    },
    {
      description: 'strips a javascript: link',
      text: '[x](javascript:alert(1))',
      forbidden: 'javascript:'
    },
    {
      description: 'strips an iframe tag',
      text: '<iframe src="https://evil.example"></iframe>',
      forbidden: '<iframe'
    },
    {
      description: 'strips an inline event handler attribute',
      text: '<div onclick="evil()">x</div>',
      forbidden: 'onclick'
    }
  ])(
    'sanitizes admin-entered HTML in content: $description',
    ({ text, forbidden }) => {
      const announcement = getMastodonAnnouncement({
        announcement: { ...baseAnnouncement, text },
        read: false,
        reactions: [],
        customEmojis: []
      })
      expect(announcement.content).not.toContain(forbidden)
    }
  )

  it('serializes the timestamps as ISO strings and empty entity arrays', () => {
    const announcement = getMastodonAnnouncement({
      announcement: baseAnnouncement,
      read: true,
      reactions: [],
      customEmojis: []
    })
    expect(announcement.starts_at).toBe(
      new Date(baseAnnouncement.startsAt as number).toISOString()
    )
    expect(announcement.ends_at).toBe(
      new Date(baseAnnouncement.endsAt as number).toISOString()
    )
    expect(announcement.published_at).toBe(
      new Date(baseAnnouncement.publishedAt as number).toISOString()
    )
    expect(announcement.updated_at).toBe(
      new Date(baseAnnouncement.updatedAt).toISOString()
    )
    expect(announcement.all_day).toBe(false)
    expect(announcement.read).toBe(true)
    expect(announcement.mentions).toEqual([])
    expect(announcement.statuses).toEqual([])
    expect(announcement.tags).toEqual([])
    expect(announcement.emojis).toEqual([])
  })

  it('serializes null starts_at and ends_at when the announcement is open ended', () => {
    const announcement = getMastodonAnnouncement({
      announcement: { ...baseAnnouncement, startsAt: null, endsAt: null },
      read: false,
      reactions: [],
      customEmojis: []
    })
    expect(announcement.starts_at).toBeNull()
    expect(announcement.ends_at).toBeNull()
  })

  it('fills url and static_url for a reaction matching a custom emoji shortcode', () => {
    const announcement = getMastodonAnnouncement({
      announcement: baseAnnouncement,
      read: false,
      reactions: [{ name: 'tada', count: 2, me: true }],
      customEmojis: [tadaEmoji]
    })
    expect(announcement.reactions).toEqual([
      {
        name: 'tada',
        count: 2,
        me: true,
        url: tadaEmoji.url,
        static_url: tadaEmoji.staticUrl
      }
    ])
  })

  it('omits url and static_url for a plain unicode reaction', () => {
    const announcement = getMastodonAnnouncement({
      announcement: baseAnnouncement,
      read: false,
      reactions: [{ name: '🎉', count: 1, me: false }],
      customEmojis: [tadaEmoji]
    })
    expect(announcement.reactions).toEqual([
      { name: '🎉', count: 1, me: false }
    ])
  })
})
