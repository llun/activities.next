/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import {
  createNote,
  deleteAccountMedia,
  getGalleryGears,
  getGallerySettings,
  getMedia,
  updateMediaDetails,
  updateNote,
  uploadAttachment
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { UploadedAttachment } from '@/lib/types/domain/attachment'
import { extractVideoPoster } from '@/lib/utils/extractVideoPoster'
import { resizeImage } from '@/lib/utils/resizeImage'

import { PostBox } from './post-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  createPoll: vi.fn(),
  deleteFitnessFile: vi.fn(),
  describeMedia: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGalleryGears: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

const uploadAttachmentMock = vi.mocked(uploadAttachment)
const getMediaMock = vi.mocked(getMedia)
const getGallerySettingsMock = vi.mocked(getGallerySettings)
const updateMediaDetailsMock = vi.mocked(updateMediaDetails)
const createNoteMock = vi.mocked(createNote)

const profile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  totalLikes: 0,
  totalShares: 0
} as unknown as ActorProfile

const uploaded = (
  id: string,
  name: string,
  extra: Partial<UploadedAttachment> = {}
): UploadedAttachment => ({
  type: 'upload',
  id,
  mediaType: 'image/png',
  url: `https://activities.local/api/v1/files/${name}`,
  width: 640,
  height: 480,
  ...extra
})

const mediaEntity = (
  id: string,
  description: string | null,
  details: Record<string, unknown> = {}
) =>
  ({
    id,
    description,
    details: {
      subject: null,
      takenAt: null,
      camera: null,
      lens: null,
      exposure: null,
      place: null,
      inGallery: false,
      ...details
    }
  }) as unknown as Awaited<ReturnType<typeof getMedia>>

const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    allowEmptyDescription: true,
    altTextAvailable: false,
    defaultPlacePrecision: 'hidden',
    ...overrides
  }) as unknown as Awaited<ReturnType<typeof getGallerySettings>>

const renderPostBox = () =>
  render(
    <PostBox
      host="activities.local"
      profile={profile}
      isMediaUploadEnabled
      onDiscardReply={vi.fn()}
      onPostCreated={vi.fn()}
      onPostUpdated={vi.fn()}
      onDiscardEdit={vi.fn()}
    />
  )

const attach = (...names: string[]) => {
  const fileInput = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="file"][name="file"]'
    )
  ).at(-1)!
  fireEvent.change(fileInput, {
    target: {
      files: names.map((name) => new File([name], name, { type: 'image/png' }))
    }
  })
}

describe('PostBox media details', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:media')
    global.URL.revokeObjectURL = vi.fn()
    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `temp-${counter++}` as never)
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    getGallerySettingsMock.mockResolvedValue(settings())
    vi.mocked(getGalleryGears).mockResolvedValue([])
    uploadAttachmentMock.mockImplementation(async (file) =>
      uploaded(`media-${file.name}`, file.name)
    )
    getMediaMock.mockImplementation(async (id) => mediaEntity(id, null))
    updateMediaDetailsMock.mockImplementation(async (id, fields) =>
      mediaEntity(id, (fields.description as string | null) ?? null)
    )
    createNoteMock.mockResolvedValue({
      status: {} as never,
      attachments: []
    })
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('uploads as soon as the file is attached and reads its details', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()

    attach('heron.png')

    await waitFor(() =>
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'heron.png' })
      )
    )
    expect(getGallerySettingsMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Uploading…')).toBeInTheDocument()
    expect(getMediaMock).not.toHaveBeenCalled()

    upload.resolve(uploaded('media-heron', 'heron.png'))

    await waitFor(() =>
      expect(getMediaMock).toHaveBeenCalledWith('media-heron')
    )
    await waitFor(() =>
      expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
    )
    // No description yet: the tile asks for a review.
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(
      screen.getByText('Select an item to review its details.')
    ).toBeInTheDocument()
  })

  it('shows the description and detail icons once the server has read them', async () => {
    getMediaMock.mockResolvedValue(
      mediaEntity('media-heron.png', 'A heron', {
        camera: { id: 'cam', name: 'Z9' },
        place: { name: 'Marsh', latitude: 1, longitude: 2, precision: 'area' }
      })
    )
    renderPostBox()

    attach('heron.png')

    expect(await screen.findByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('ALT')).toBeInTheDocument()
    expect(screen.getByLabelText('Has gear')).toBeInTheDocument()
    expect(screen.getByLabelText('Has place')).toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
  })

  it('makes Post wait for an upload that is still running', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()

    attach('heron.png')
    const post = screen.getByRole('button', { name: 'Post' })
    await waitFor(() => expect(post).toBeEnabled())
    fireEvent.click(post)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Posting...' })).toBeDisabled()
    )
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)

    upload.resolve(uploaded('media-heron', 'heron.png'))

    await waitFor(() =>
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [expect.objectContaining({ id: 'media-heron' })]
        })
      )
    )
  })

  it('marks a failed upload, retries it, and blocks submit while it is failed', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
    uploadAttachmentMock.mockRejectedValueOnce(new Error('disk full'))
    try {
      renderPostBox()

      attach('heron.png')

      expect(await screen.findByText('Upload failed')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() =>
        expect(alertMock).toHaveBeenCalledWith(
          'Fail to upload heron.png: disk full'
        )
      )
      expect(createNoteMock).not.toHaveBeenCalled()

      fireEvent.click(
        screen.getByRole('button', { name: 'Retry upload of heron.png' })
      )

      await waitFor(() =>
        expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
      )
      await waitFor(() =>
        expect(getMediaMock).toHaveBeenCalledWith('media-heron.png')
      )
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(2)
    } finally {
      alertMock.mockRestore()
    }
  })

  it('removes an item with its own remove button', async () => {
    renderPostBox()
    attach('a.png', 'b.png')
    await screen.findAllByText('Review')

    fireEvent.click(screen.getByRole('button', { name: 'Remove media a.png' }))

    expect(
      screen.queryByRole('button', { name: 'Remove media a.png' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove media b.png' })
    ).toBeInTheDocument()
  })

  it('deletes uploaded media and revokes its previews when a poll replaces it', async () => {
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    fireEvent.click(screen.getByRole('button', { name: 'Add poll' }))

    expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
      mediaId: 'media-a.png'
    })
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:media')
    expect(
      screen.queryByRole('button', { name: 'Remove media a.png' })
    ).not.toBeInTheDocument()
    // Nothing of the old media survives into the next attachment.
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
  })

  it('does not open the details dialog for an item removed while its details loaded', async () => {
    const pendingSettings =
      createDeferred<Awaited<ReturnType<typeof getGallerySettings>>>()
    getGallerySettingsMock.mockReturnValueOnce(pendingSettings.promise)
    renderPostBox()
    attach('a.png')
    const open = await screen.findByRole('button', {
      name: 'Review details of a.png'
    })

    fireEvent.click(open)
    fireEvent.click(screen.getByRole('button', { name: 'Remove media a.png' }))
    pendingSettings.resolve(settings())

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not open the details dialog once a submit has started', async () => {
    // The first details read fails, so opening the dialog reads them again.
    const retry = createDeferred<Awaited<ReturnType<typeof getMedia>>>()
    getMediaMock
      .mockRejectedValueOnce(new Error('down'))
      .mockReturnValueOnce(retry.promise)
    const post = createDeferred<Awaited<ReturnType<typeof createNote>>>()
    createNoteMock.mockReturnValueOnce(post.promise)
    renderPostBox()
    attach('a.png')
    const open = await screen.findByRole('button', {
      name: 'Review details of a.png'
    })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello' }
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    )

    fireEvent.click(open)
    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
    retry.resolve(mediaEntity('media-a.png', null))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    post.resolve({ status: {} as never, attachments: [] })
  })

  it('opens the details dialog when a tile is clicked', async () => {
    renderPostBox()
    attach('a.png', 'b.png')
    await screen.findAllByText('Review')

    fireEvent.click(
      screen.getByRole('button', { name: 'Review details of b.png' })
    )

    const dialog = await screen.findByRole('dialog', { name: 'Media details' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('keeps the opener enabled during a details refetch and refocuses it on close', async () => {
    getMediaMock.mockRejectedValueOnce(new Error('offline'))
    renderPostBox()
    attach('a.png')
    const tile = await screen.findByRole('button', {
      name: 'Review details of a.png'
    })
    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(1))
    const refetch = createDeferred<ReturnType<typeof mediaEntity>>()
    getMediaMock.mockReturnValueOnce(refetch.promise)

    tile.focus()
    fireEvent.click(tile)

    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(2))
    expect(tile).toBeEnabled()
    refetch.resolve(mediaEntity('media-a.png', null))
    await screen.findByRole('dialog', { name: 'Media details' })

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review details of a.png' })
      ).toHaveFocus()
    )
  })

  it('does not refetch details that were already fetched, even when empty', async () => {
    getMediaMock.mockResolvedValue({
      id: 'media-a.png',
      description: null,
      details: null
    } as unknown as Awaited<ReturnType<typeof getMedia>>)
    renderPostBox()
    attach('a.png')
    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(1))

    const open = async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Review details of a.png' })
      )
      await screen.findByRole('dialog', { name: 'Media details' })
    }
    await open()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await open()

    expect(getMediaMock).toHaveBeenCalledTimes(1)
  })

  it('removes the right item by id while another upload is still running', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockImplementation(async (file) =>
      file.name === 'b.png'
        ? upload.promise
        : uploaded(`media-${file.name}`, file.name)
    )
    renderPostBox()
    attach('a.png', 'b.png')
    await screen.findByText('Review')

    fireEvent.click(screen.getByRole('button', { name: 'Remove media a.png' }))
    upload.resolve(uploaded('media-b.png', 'b.png'))
    await screen.findByRole('button', { name: 'Review details of b.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove media b.png' }))

    expect(
      screen.queryByRole('button', { name: /details of/ })
    ).not.toBeInTheDocument()
  })

  it('does not ask for a description while an item is uploading or has failed', async () => {
    getGallerySettingsMock.mockResolvedValue(
      settings({ allowEmptyDescription: false })
    )
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('a.png')

    await screen.findByText('Uploading…')
    expect(
      screen.queryByText(
        'Add a description to every item, or mark it decorative'
      )
    ).not.toBeInTheDocument()

    upload.reject(new Error('disk full'))
    await screen.findByText('Upload failed')
    expect(
      screen.queryByText(
        'Add a description to every item, or mark it decorative'
      )
    ).not.toBeInTheDocument()
  })

  it('saves only the edited fields and shows the description on the tile', async () => {
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    fireEvent.click(
      screen.getByRole('button', { name: 'Review details of a.png' })
    )
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(updateMediaDetailsMock).toHaveBeenCalledWith('media-a.png', {
        description: 'A heron'
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(screen.getByText('ALT')).toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
  })

  it('keeps a description saved in the dialog when a late details read resolves', async () => {
    const lateRead = createDeferred<ReturnType<typeof mediaEntity>>()
    getMediaMock.mockReturnValueOnce(lateRead.promise)
    renderPostBox()
    attach('a.png', 'b.png')
    // b's details are read; a's read is still pending.
    await screen.findByRole('button', { name: 'Review details of b.png' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Review details of b.png' })
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Previous item' }))
    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() =>
      expect(updateMediaDetailsMock).toHaveBeenCalledWith('media-a.png', {
        description: 'A heron'
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )

    lateRead.resolve(mediaEntity('media-a.png', 'stale'))
    await waitFor(() =>
      expect(
        screen.queryByText('Reading details of a.png')
      ).not.toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
    const attachments = createNoteMock.mock.calls[0][0].attachments ?? []
    expect(attachments.find((item) => item.id === 'media-a.png')?.name).toBe(
      'A heron'
    )
  })

  it('drops the revoked blob poster when the server returns no poster', async () => {
    vi.mocked(extractVideoPoster).mockResolvedValueOnce(
      new File(['p'], 'poster.jpg', { type: 'image/jpeg' })
    )
    let blobCount = 0
    global.URL.createObjectURL = vi.fn(() =>
      blobCount++ === 0 ? 'blob:video' : 'blob:poster'
    )
    uploadAttachmentMock.mockResolvedValueOnce(
      uploaded('media-clip.mp4', 'clip.mp4', { mediaType: 'video/mp4' })
    )
    renderPostBox()
    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="file"]'
    )!
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })]
      }
    })

    await screen.findByText('Review')
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(File)
    )
    expect(document.querySelector('[style*="blob:poster"]')).toBeNull()
  })

  it('applies the all-items sections across the composer items', async () => {
    renderPostBox()
    attach('a.png', 'b.png')
    await screen.findAllByText('Review')

    fireEvent.click(
      screen.getByRole('button', { name: 'Review details of a.png' })
    )
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Place name'), {
      target: { value: 'Marsh' }
    })
    fireEvent.click(screen.getByLabelText('Use this place for all 2 items'))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalledTimes(2))
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('media-a.png', {
      place_name: 'Marsh'
    })
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('media-b.png', {
      place_name: 'Marsh'
    })
  })

  it('blocks Post until every item has a description or is decorative', async () => {
    getGallerySettingsMock.mockResolvedValue(
      settings({ allowEmptyDescription: false })
    )
    renderPostBox()
    attach('a.png')

    const message = await screen.findByText(
      'Add a description to every item, or mark it decorative'
    )
    expect(message).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Review details of a.png' })
    )
    await screen.findByRole('dialog')
    fireEvent.click(
      screen.getByLabelText('Post without a description (decorative image)')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    )
    expect(
      screen.queryByText(
        'Add a description to every item, or mark it decorative'
      )
    ).not.toBeInTheDocument()
  })

  it('re-checks descriptions after an in-flight upload settles at Post', async () => {
    getGallerySettingsMock.mockResolvedValue(
      settings({ allowEmptyDescription: false })
    )
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('a.png')
    await screen.findByText('Uploading…')

    // Uploading items are not flagged, so Post is clickable mid-upload.
    const post = screen.getByRole('button', { name: 'Post' })
    expect(post).toBeEnabled()
    fireEvent.click(post)
    upload.resolve(uploaded('media-a.png', 'a.png'))

    await screen.findByText(
      'Add a description to every item, or mark it decorative'
    )
    expect(createNoteMock).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    )
  })

  it('keeps focus on Remove when an upload swaps the temporary id', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('a.png')
    await screen.findByText('Uploading…')

    const remove = screen.getByRole('button', { name: 'Remove media a.png' })
    remove.focus()
    expect(remove).toHaveFocus()

    upload.resolve(uploaded('media-a.png', 'a.png'))
    await screen.findByText('Review')

    const after = screen.getByRole('button', { name: 'Remove media a.png' })
    expect(after).toBe(remove)
    expect(after).toHaveFocus()
  })

  it('does not require descriptions when empty ones are allowed', async () => {
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    expect(
      screen.queryByText(
        'Add a description to every item, or mark it decorative'
      )
    ).not.toBeInTheDocument()
  })

  it('shows a generic message when the upload error has no message', async () => {
    uploadAttachmentMock.mockRejectedValueOnce(new Error(''))
    renderPostBox()
    attach('heron.png')

    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Retry upload of heron.png' })
    ).toBeInTheDocument()
  })

  it('leaves no error behind when an item is removed while its upload fails', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('heron.png')
    await screen.findByText('Uploading…')

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media heron.png' })
    )
    upload.reject(new Error('late failure'))

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })

  it('deletes the orphaned media when an item is removed before its upload finishes', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('heron.png')
    await screen.findByText('Uploading…')

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media heron.png' })
    )
    upload.resolve(uploaded('media-heron', 'heron.png'))

    await waitFor(() =>
      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
        mediaId: 'media-heron'
      })
    )
    expect(getMediaMock).not.toHaveBeenCalled()
  })

  it('deletes the server media when an uploaded item is removed', async () => {
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    fireEvent.click(screen.getByRole('button', { name: 'Remove media a.png' }))

    expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
      mediaId: 'media-a.png'
    })
  })

  it('shows Reading details only after the upload, while the details load', async () => {
    const details = createDeferred<ReturnType<typeof mediaEntity>>()
    getMediaMock.mockReturnValueOnce(details.promise)
    renderPostBox()
    attach('heron.png')

    expect(await screen.findByText('Reading details…')).toBeInTheDocument()
    expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
    details.resolve(mediaEntity('media-heron.png', null))
    await screen.findByText('Review')
  })

  it('names the tile button after its visible status text', async () => {
    renderPostBox()
    attach('a.png')
    const button = await screen.findByRole('button', {
      name: 'Review details of a.png'
    })
    // WCAG 2.5.3: the accessible name starts with the visible text.
    expect(button).not.toHaveAttribute('aria-label')
    expect(button.textContent?.trim().startsWith('Review')).toBe(true)
  })

  it('ignores tile controls while a submit is in flight', async () => {
    const post = createDeferred<Awaited<ReturnType<typeof createNote>>>()
    createNoteMock.mockReturnValueOnce(post.promise)
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello' }
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())

    const remove = screen.getByRole('button', { name: 'Remove media a.png' })
    const open = screen.getByRole('button', { name: 'Review details of a.png' })
    expect(remove).toBeDisabled()
    expect(open).toBeDisabled()
    fireEvent.click(remove)
    fireEvent.click(open)
    expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove media a.png' })
    ).toBeInTheDocument()

    post.resolve({ status: {} as never, attachments: [] })
  })

  it('ignores a file that finishes processing after the submit has started', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('a.png')
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))

    // b.png is picked before the submit but is still being resized when the
    // submit begins.
    const resize = createDeferred<File>()
    vi.mocked(resizeImage).mockReturnValueOnce(resize.promise)
    attach('b.png')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Posting...' })).toBeDisabled()
    )

    resize.resolve(new File(['b.png'], 'b.png', { type: 'image/png' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:media')

    upload.resolve(uploaded('media-a.png', 'a.png'))
    await waitFor(() =>
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [expect.objectContaining({ id: 'media-a.png' })]
        })
      )
    )
    expect(createNoteMock.mock.calls[0][0].attachments).toHaveLength(1)
  })

  it('disables the add media button and ignores picks while posting', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('a.png')
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Posting...' })).toBeDisabled()
    )

    expect(screen.getByRole('button', { name: /^Add media/ })).toBeDisabled()
    attach('b.png')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)

    upload.resolve(uploaded('media-a.png', 'a.png'))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    expect(createNoteMock.mock.calls[0][0].attachments).toHaveLength(1)
  })

  it('deletes uploaded media when the composer unmounts without posting', async () => {
    const { unmount } = renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    unmount()

    expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
      mediaId: 'media-a.png'
    })
  })

  it('deletes a late upload result after unmount and sets no state', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    const { unmount } = renderPostBox()
    attach('heron.png')
    await screen.findByText('Uploading…')

    unmount()
    expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    upload.resolve(uploaded('media-heron', 'heron.png'))

    await waitFor(() =>
      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
        mediaId: 'media-heron'
      })
    )
    expect(getMediaMock).not.toHaveBeenCalled()
  })

  it('disables Post while the gallery settings are loading and fails open if they fail', async () => {
    const pending = createDeferred<ReturnType<typeof settings>>()
    getGallerySettingsMock.mockReturnValueOnce(pending.promise)
    renderPostBox()
    attach('a.png')
    await screen.findByText('Review')

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    pending.reject(new Error('settings down'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    )
  })

  it('announces upload status in a live region', async () => {
    const upload = createDeferred<UploadedAttachment>()
    uploadAttachmentMock.mockReturnValueOnce(upload.promise)
    renderPostBox()
    attach('heron.png')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Uploading heron.png'
    )
    upload.resolve(uploaded('media-heron', 'heron.png'))
    await waitFor(() =>
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    )
  })

  it('does not delete the media of a post when the parent unmounts the composer in onPostCreated', async () => {
    const Host = () => {
      const [open, setOpen] = useState(true)
      return open ? (
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={() => setOpen(false)}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      ) : (
        <div>closed</div>
      )
    }
    render(<Host />)
    attach('a.png')
    await screen.findByText('Review')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await screen.findByText('closed')
    expect(createNoteMock).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
  })

  it('sends edited descriptions as media_attributes when updating a status', async () => {
    vi.mocked(updateNote).mockResolvedValue({
      content: '',
      spoilerText: '',
      mediaAttachments: [],
      status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
    } as never)
    getMediaMock.mockImplementation(async (id) => mediaEntity(id, 'old alt'))
    const editStatus = {
      id: 'status-1',
      actorId: profile.id,
      actor: profile,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: 1,
      updatedAt: 1,
      type: 'Note',
      url: 'https://activities.local/@llun/status-1',
      text: 'hello',
      summary: null,
      reply: '',
      replies: [],
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      attachments: [
        {
          id: 'att-1',
          actorId: profile.id,
          statusId: 'status-1',
          type: 'Document',
          mediaType: 'image/png',
          url: 'https://activities.local/api/v1/files/a.png',
          width: 10,
          height: 10,
          name: 'old alt',
          createdAt: 1,
          updatedAt: 1,
          mediaId: 'media-1'
        }
      ],
      tags: []
    } as never
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    fireEvent.click(await screen.findByRole('button', { name: /details of/ }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'new alt' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(vi.mocked(updateNote)).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaAttributes: [{ id: 'media-1', description: 'new alt' }]
        })
      )
    )
  })

  describe('editing a status with existing media', () => {
    const makeEditStatus = () =>
      ({
        id: 'status-1',
        actorId: profile.id,
        actor: profile,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: true,
        createdAt: 1,
        updatedAt: 1,
        type: 'Note',
        url: 'https://activities.local/@llun/status-1',
        text: 'hello',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [
          {
            id: 'att-1',
            actorId: profile.id,
            statusId: 'status-1',
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://activities.local/api/v1/files/a.png',
            width: 10,
            height: 10,
            name: '',
            createdAt: 1,
            updatedAt: 1,
            mediaId: 'media-1'
          }
        ],
        tags: []
      }) as never

    const renderEdit = () =>
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          editStatus={makeEditStatus()}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )

    it('keeps Update disabled when details finish saving mid-submit', async () => {
      const save = createDeferred<ReturnType<typeof mediaEntity>>()
      updateMediaDetailsMock.mockReturnValueOnce(save.promise as never)
      const update = createDeferred<Awaited<ReturnType<typeof updateNote>>>()
      vi.mocked(updateNote).mockReturnValueOnce(update.promise)
      renderEdit()
      fireEvent.change(await screen.findByRole('textbox'), {
        target: { value: 'hello there' }
      })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )

      fireEvent.click(screen.getByRole('button', { name: /details of/ }))
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: 'new alt' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
      await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
      // Update is sent while the details save is still pending.
      fireEvent.click(
        screen.getByRole('button', { name: 'Update', hidden: true })
      )
      await waitFor(() => expect(vi.mocked(updateNote)).toHaveBeenCalled())

      save.resolve(mediaEntity('media-existing', 'new alt'))
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      expect(
        screen.getByRole('button', { name: 'Update', hidden: true })
      ).toBeDisabled()

      update.resolve({
        content: '',
        spoilerText: '',
        mediaAttachments: [],
        status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
      } as never)
    })

    it('does not require a description for legacy undescribed media', async () => {
      getGallerySettingsMock.mockResolvedValue(
        settings({ allowEmptyDescription: false })
      )
      renderEdit()
      await waitFor(() => expect(getGallerySettingsMock).toHaveBeenCalled())
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'hello there' }
      })

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )
      expect(
        screen.queryByText(
          'Add a description to every item, or mark it decorative'
        )
      ).not.toBeInTheDocument()
    })

    it('still requires a description for media added during the edit', async () => {
      getGallerySettingsMock.mockResolvedValue(
        settings({ allowEmptyDescription: false })
      )
      renderEdit()
      attach('new.png')

      expect(
        await screen.findByText(
          'Add a description to every item, or mark it decorative'
        )
      ).toBeInTheDocument()
    })

    it('never deletes the original media when removed or unmounted', async () => {
      const { unmount } = renderEdit()
      fireEvent.click(
        await screen.findByRole('button', { name: /Remove media/ })
      )
      unmount()

      expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    })

    it('does not delete media added during an edit when the parent unmounts the composer in onPostUpdated', async () => {
      vi.mocked(updateNote).mockResolvedValue({
        content: '',
        spoilerText: '',
        mediaAttachments: [],
        status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
      } as never)
      const Host = () => {
        const [open, setOpen] = useState(true)
        return open ? (
          <PostBox
            host="activities.local"
            profile={profile}
            editStatus={makeEditStatus()}
            isMediaUploadEnabled
            onDiscardReply={vi.fn()}
            onPostCreated={vi.fn()}
            onPostUpdated={() => setOpen(false)}
            onDiscardEdit={vi.fn()}
          />
        ) : (
          <div>closed</div>
        )
      }
      render(<Host />)
      attach('new.png')
      await screen.findByRole('button', { name: 'Remove media new.png' })
      await waitFor(() => expect(getMediaMock).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )

      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await screen.findByText('closed')
      expect(vi.mocked(updateNote)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    })

    it('deletes media uploaded during the edit when it is removed', async () => {
      renderEdit()
      attach('new.png')
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Remove media new.png' })
        ).toBeInTheDocument()
      )
      await waitFor(() => expect(getMediaMock).toHaveBeenCalled())
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media new.png' })
      )

      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
        mediaId: 'media-new.png'
      })
    })
  })
})
