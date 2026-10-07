/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
    defaultPlacePrecision: 'area',
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
    expect(screen.getByText('Reading details…')).toBeInTheDocument()
    expect(getMediaMock).not.toHaveBeenCalled()

    upload.resolve(uploaded('media-heron', 'heron.png'))

    await waitFor(() =>
      expect(getMediaMock).toHaveBeenCalledWith('media-heron')
    )
    await waitFor(() =>
      expect(screen.queryByText('Reading details…')).not.toBeInTheDocument()
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
    await screen.findByText('Reading details…')

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
    await screen.findByText('Reading details…')

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

    fireEvent.click(
      await screen.findByRole('button', { name: /Review details of/ })
    )
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
})
