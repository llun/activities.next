import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getCustomEmojis: jest.fn(),
  getCustomEmojiByShortcode: jest.fn(),
  createCustomEmoji: jest.fn()
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

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue({ id: 'actor-1' })
}))

const mockSaveMedia = jest.fn()
jest.mock('@/lib/services/medias', () => ({
  saveMedia: (...args: unknown[]) => mockSaveMedia(...args)
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: [],
    mediaStorage: { maxFileSize: 1_000_000 }
  })
}))

const makeImage = () =>
  new File([new Uint8Array([1, 2, 3])], 'blobcat.png', { type: 'image/png' })

// NextRequest.formData() is not available in the jest environment, so build the
// request and stub formData with the FormData instance directly (matching the
// pattern in app/api/v1/statuses/route.test.ts).
const makeMultipartRequest = (form: FormData) => {
  const request = new NextRequest(
    'https://llun.test/api/v1/admin/custom_emojis',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=test-boundary',
        Origin: 'https://llun.test'
      }
    }
  )
  Object.defineProperty(request, 'formData', {
    value: jest.fn().mockResolvedValue(form)
  })
  return request
}

describe('/api/v1/admin/custom_emojis', () => {
  beforeEach(() => {
    mockDatabase.getCustomEmojis.mockReset()
    mockDatabase.getCustomEmojiByShortcode.mockReset()
    mockDatabase.createCustomEmoji.mockReset()
    mockSaveMedia.mockReset()
  })

  it('lists all emoji including disabled ones with the admin shape', async () => {
    mockDatabase.getCustomEmojis.mockResolvedValue([
      {
        id: 'emoji-1',
        shortcode: 'blobcat',
        url: 'https://llun.test/emojis/blobcat.png',
        staticUrl: 'https://llun.test/emojis/blobcat.png',
        category: null,
        visibleInPicker: true,
        disabled: true,
        createdAt: 0,
        updatedAt: 0
      }
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/admin/custom_emojis'),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockDatabase.getCustomEmojis).toHaveBeenCalledWith({
      includeDisabled: true
    })
    expect(data[0]).toMatchObject({
      id: 'emoji-1',
      shortcode: 'blobcat',
      static_url: 'https://llun.test/emojis/blobcat.png',
      visible_in_picker: true,
      disabled: true
    })
  })

  it('creates an emoji from a multipart upload through the media pipeline', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue({
      url: 'https://llun.test/medias/blobcat.png'
    })
    mockDatabase.createCustomEmoji.mockResolvedValue({
      id: 'emoji-9',
      shortcode: 'blobcat',
      url: 'https://llun.test/medias/blobcat.png',
      staticUrl: 'https://llun.test/medias/blobcat.png',
      category: 'cats',
      visibleInPicker: true,
      disabled: false,
      createdAt: 0,
      updatedAt: 0
    })

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('category', 'cats')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSaveMedia).toHaveBeenCalled()
    expect(mockDatabase.createCustomEmoji).toHaveBeenCalledWith({
      shortcode: 'blobcat',
      url: 'https://llun.test/medias/blobcat.png',
      staticUrl: 'https://llun.test/medias/blobcat.png',
      category: 'cats',
      visibleInPicker: true
    })
    expect(data).toMatchObject({ id: 'emoji-9', shortcode: 'blobcat' })
  })

  it('rejects an invalid shortcode with 422', async () => {
    const form = new FormData()
    form.set('shortcode', 'bad shortcode!')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('rejects a duplicate shortcode with 422', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue({ id: 'existing' })
    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('rejects a non-image upload with 422', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', new File(['x'], 'note.txt', { type: 'text/plain' }))

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('rejects a video upload with 422 even though the media schema allows video', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set(
      'image',
      new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' })
    )

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })
})
