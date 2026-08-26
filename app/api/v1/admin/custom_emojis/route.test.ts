import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GET, POST } from './route'

const mockDatabase = {
  getCustomEmojis: vi.fn(),
  getCustomEmojiByShortcode: vi.fn(),
  createCustomEmoji: vi.fn(),
  getAllServerSettings: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({ id: 'actor-1' })
}))

const mockSaveMedia = vi.fn()
const mockDeleteMediaFile = vi.fn()
vi.mock('@/lib/services/medias', () => ({
  saveMedia: (...args: unknown[]) => mockSaveMedia(...args),
  deleteMediaFile: (...args: unknown[]) => mockDeleteMediaFile(...args)
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({
    host: 'llun.test',
    // A multi-domain instance mints media URLs on the owning actor's domain, so
    // the cleanup's host check has to accept a trusted host as well as the
    // primary one. Without an entry here, dropping `trustedHosts` from
    // `getTrustedHostRules` passes every case in this file.
    trustedHosts: ['second.example'],
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
        Origin: 'https://llun.test',
        'Content-Type': 'multipart/form-data; boundary=test-boundary'
      }
    }
  )
  Object.defineProperty(request, 'formData', {
    value: vi.fn().mockResolvedValue(form)
  })
  return request
}

describe('/api/v1/admin/custom_emojis', () => {
  beforeEach(() => {
    mockDatabase.getCustomEmojis.mockReset()
    mockDatabase.getCustomEmojiByShortcode.mockReset()
    mockDatabase.createCustomEmoji.mockReset()
    mockDatabase.getAllServerSettings.mockReset()
    mockDatabase.getAllServerSettings.mockResolvedValue([])
    mockSaveMedia.mockReset()
    mockDeleteMediaFile.mockReset()
    mockDeleteMediaFile.mockResolvedValue(true)
    // The resolver caches per database instance, and this mock is shared across
    // the file, so drop the cached view between cases.
    invalidateServerSettingsCache(mockDatabase as unknown as Database)
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

  it('rejects a 1-character shortcode with 422 (Mastodon requires >= 2)', async () => {
    const form = new FormData()
    form.set('shortcode', 'a')
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

  it('returns 403 when the admin has no session actor to own the upload', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    ;(getActorFromSession as jest.Mock).mockResolvedValueOnce(null)
    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(403)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('rejects an image over the admin-configured media.maxFileSize with 422', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    // The sample image is 3 bytes. `getConfig()` here still reports a 1 MB
    // mediaStorage cap, so a pass here would mean the stored setting is ignored.
    mockDatabase.getAllServerSettings.mockResolvedValue([
      { key: 'media.maxFileSize', value: 2 }
    ])

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

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
  it('removes the orphaned media when the emoji insert fails', async () => {
    mockDatabase.getCustomEmojiByShortcode
      .mockResolvedValueOnce(null)
      // Re-queried after the failure to tell a genuine duplicate from a
      // transient error.
      .mockResolvedValueOnce({ id: 'existing' })
    // The shape `saveMedia` returns: both storage backends build it through
    // `getMediaAttachment`, so it is always `/api/v1/files/<path>` on our own
    // host. The path is percent-encoded here so the decode is covered too.
    mockSaveMedia.mockResolvedValue({
      url: 'https://llun.test/api/v1/files/medias/blob%20cat.png'
    })
    mockDatabase.createCustomEmoji.mockRejectedValue(new Error('duplicate key'))

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'medias/blob cat.png'
    )
  })

  it('removes media minted on a trusted secondary domain', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue({
      url: 'https://second.example/api/v1/files/medias/blobcat.png'
    })
    mockDatabase.createCustomEmoji.mockRejectedValue(new Error('connection'))

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'medias/blobcat.png'
    )
  })

  // The cleanup path ends in an unlink, so it has to refuse anything it cannot
  // prove names one of our own storage paths.
  //
  // Two of these are regression guards against the hand-rolled parse this
  // replaced. It searched the pathname with `indexOf` and never looked at the
  // host, so it deleted a local file named by somebody else's URL; and it left
  // `..%2f..%2f` encoded through `new URL` — which does not decode `%2f` — then
  // decoded it, handing `../../etc/passwd` to the unlink. That second one is
  // refused now only because #1569 put `isTraversingStoragePath` inside the
  // shared parser, which is the argument for recovering the path there rather
  // than at the call site. The literal dot-segment case is the one that refuses
  // under both spellings, and not for a traversal reason: `new URL` normalises
  // that pathname to `/api/etc/passwd`, so it no longer starts with the media
  // route.
  it.each([
    {
      description: 'a host that is not ours',
      url: 'https://other.example/api/v1/files/medias/blobcat.png'
    },
    {
      description: 'a path with dot segments',
      url: 'https://llun.test/api/v1/files/../../etc/passwd'
    },
    {
      description: 'an encoded traversal',
      url: 'https://llun.test/api/v1/files/..%2f..%2fetc/passwd'
    },
    {
      description: 'a URL off the media route',
      url: 'https://llun.test/some/other/place.png'
    }
  ])(
    'touches no storage when the stored URL is $description',
    async ({ url }) => {
      mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
      mockSaveMedia.mockResolvedValue({ url })
      mockDatabase.createCustomEmoji.mockRejectedValue(new Error('connection'))

      const form = new FormData()
      form.set('shortcode', 'blobcat')
      form.set('image', makeImage())

      const response = await POST(makeMultipartRequest(form), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(500)
      expect(mockDeleteMediaFile).not.toHaveBeenCalled()
    }
  )

  it('still removes the orphaned media when the insert fails for a transient reason', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue({
      url: 'https://llun.test/api/v1/files/medias/blobcat.png'
    })
    mockDatabase.createCustomEmoji.mockRejectedValue(new Error('connection'))

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'medias/blobcat.png'
    )
  })

  it('answers 500 when the orphaned media cannot be removed', async () => {
    mockDatabase.getCustomEmojiByShortcode.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue({
      url: 'https://llun.test/api/v1/files/medias/blobcat.png'
    })
    mockDatabase.createCustomEmoji.mockRejectedValue(new Error('connection'))
    // Cleanup is best effort: a storage that throws must not turn the insert
    // failure into an unhandled rejection.
    mockDeleteMediaFile.mockRejectedValue(new Error('storage unreachable'))

    const form = new FormData()
    form.set('shortcode', 'blobcat')
    form.set('image', makeImage())

    const response = await POST(makeMultipartRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
  })
})
