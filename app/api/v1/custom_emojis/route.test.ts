import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getCustomEmojis: jest.fn()
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/api/v1/custom_emojis', () => {
  beforeEach(() => {
    mockDatabase.getCustomEmojis.mockReset()
  })

  it('returns picker-visible emoji as the Mastodon CustomEmoji shape without auth', async () => {
    mockDatabase.getCustomEmojis.mockResolvedValue([
      {
        id: 'emoji-1',
        shortcode: 'blobcat',
        url: 'https://llun.test/emojis/blobcat.png',
        staticUrl: 'https://llun.test/emojis/blobcat-static.png',
        category: 'cats',
        visibleInPicker: true,
        disabled: false,
        createdAt: 0,
        updatedAt: 0
      },
      {
        id: 'emoji-2',
        shortcode: 'hidden',
        url: 'https://llun.test/emojis/hidden.png',
        staticUrl: 'https://llun.test/emojis/hidden.png',
        category: null,
        visibleInPicker: false,
        disabled: false,
        createdAt: 0,
        updatedAt: 0
      }
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/custom_emojis')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    // Default getCustomEmojis() already excludes disabled; the route filters to
    // picker-visible (Mastodon's `listed` scope).
    expect(data).toEqual([
      {
        shortcode: 'blobcat',
        url: 'https://llun.test/emojis/blobcat.png',
        static_url: 'https://llun.test/emojis/blobcat-static.png',
        visible_in_picker: true,
        category: 'cats'
      }
    ])
  })

  it('returns an empty array when there are no emoji', async () => {
    mockDatabase.getCustomEmojis.mockResolvedValue([])
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/custom_emojis')
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})
