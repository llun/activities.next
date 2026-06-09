import { NextRequest } from 'next/server'

import { DELETE, GET, PATCH } from './route'

const mockDatabase = {
  getCustomEmojiById: jest.fn(),
  updateCustomEmoji: jest.fn(),
  deleteCustomEmoji: jest.fn()
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

jest.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: jest.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

const emojiRow = {
  id: 'emoji-1',
  shortcode: 'blobcat',
  url: 'https://llun.test/emojis/blobcat.png',
  staticUrl: 'https://llun.test/emojis/blobcat.png',
  category: null,
  visibleInPicker: true,
  disabled: false,
  createdAt: 0,
  updatedAt: 0
}

describe('/api/v1/admin/custom_emojis/[id]', () => {
  beforeEach(() => {
    mockDatabase.getCustomEmojiById.mockReset()
    mockDatabase.updateCustomEmoji.mockReset()
    mockDatabase.deleteCustomEmoji.mockReset()
  })

  it('gets a single emoji', async () => {
    mockDatabase.getCustomEmojiById.mockResolvedValue(emojiRow)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/emoji-1'),
      { params: Promise.resolve({ id: 'emoji-1' }) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'emoji-1' })
  })

  it('returns 404 for a missing emoji', async () => {
    mockDatabase.getCustomEmojiById.mockResolvedValue(null)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    )
    expect(response.status).toBe(404)
  })

  it('updates disabled/visibility/category via PATCH', async () => {
    mockDatabase.updateCustomEmoji.mockResolvedValue({
      ...emojiRow,
      disabled: true,
      visibleInPicker: false,
      category: 'cats'
    })

    const response = await PATCH(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/emoji-1', {
        method: 'PATCH',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          disabled: true,
          visible_in_picker: false,
          category: 'cats'
        })
      }),
      { params: Promise.resolve({ id: 'emoji-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockDatabase.updateCustomEmoji).toHaveBeenCalledWith({
      id: 'emoji-1',
      disabled: true,
      visibleInPicker: false,
      category: 'cats'
    })
    expect(data).toMatchObject({ disabled: true, visible_in_picker: false })
  })

  it('clears the category when PATCHed with null', async () => {
    mockDatabase.updateCustomEmoji.mockResolvedValue({
      ...emojiRow,
      category: null
    })

    const response = await PATCH(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/emoji-1', {
        method: 'PATCH',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ category: null })
      }),
      { params: Promise.resolve({ id: 'emoji-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateCustomEmoji).toHaveBeenCalledWith({
      id: 'emoji-1',
      category: null,
      visibleInPicker: undefined,
      disabled: undefined
    })
    expect(await response.json()).toMatchObject({ category: null })
  })

  it('returns 422 for an invalid update body', async () => {
    const response = await PATCH(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/emoji-1', {
        method: 'PATCH',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ visible_in_picker: 12 })
      }),
      { params: Promise.resolve({ id: 'emoji-1' }) }
    )
    expect(response.status).toBe(422)
    expect(mockDatabase.updateCustomEmoji).not.toHaveBeenCalled()
  })

  it('returns 404 when updating a missing emoji', async () => {
    mockDatabase.updateCustomEmoji.mockResolvedValue(null)
    const response = await PATCH(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/missing', {
        method: 'PATCH',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ disabled: true })
      }),
      { params: Promise.resolve({ id: 'missing' }) }
    )
    expect(response.status).toBe(404)
  })

  it('deletes an emoji', async () => {
    mockDatabase.deleteCustomEmoji.mockResolvedValue(emojiRow)
    const response = await DELETE(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/emoji-1', {
        method: 'DELETE',
        headers: { Origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id: 'emoji-1' }) }
    )
    expect(response.status).toBe(200)
    expect(mockDatabase.deleteCustomEmoji).toHaveBeenCalledWith('emoji-1')
  })

  it('returns 404 when deleting a missing emoji', async () => {
    mockDatabase.deleteCustomEmoji.mockResolvedValue(null)
    const response = await DELETE(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis/missing', {
        method: 'DELETE',
        headers: { Origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id: 'missing' }) }
    )
    expect(response.status).toBe(404)
  })
})
