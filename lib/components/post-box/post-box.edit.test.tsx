/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { updateNote } from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { createDeferred } from '@/lib/testing/deferred'

import { PostBox } from './post-box'
import {
  currentTime,
  editStatus,
  fitnessAttachment,
  legacyAttachmentWithoutMediaId,
  profile,
  resetEditMediaMocks,
  updateNoteMock,
  updatedTime,
  uploadAttachmentMock
} from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  deleteFitnessFile: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGallerySettings: vi.fn().mockResolvedValue({
    allowEmptyDescription: true,
    altTextAvailable: false
  }),
  getMedia: vi.fn().mockRejectedValue(new Error('details unavailable')),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

describe('PostBox edit media', () => {
  beforeEach(() => {
    resetEditMediaMocks()
  })

  it('initializes and submits edit text without escaping source text characters', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={{
          ...editStatus,
          text: 'a & b < c > d'
        }}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText('What is on your mind?')).toHaveValue(
      'a & b < c > d'
    )
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a & b < c > d!' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'a & b < c > d!'
        })
      )
    })
  })

  it('does not send legacy attachment ids as media ids', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={{
          ...editStatus,
          attachments: [legacyAttachmentWithoutMediaId]
        }}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Remove media legacy.jpg' })
    ).not.toBeInTheDocument()

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: 'uploaded-media'
            })
          ]
        })
      )
    })
    expect(updateNoteMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            id: 'legacy-attachment'
          })
        ])
      })
    )
  })

  it('uses concrete media types when reconciling unmatched server attachments', async () => {
    const onPostUpdated = vi.fn()
    updateNoteMock.mockResolvedValueOnce({
      content: '<p>Updated post text</p>',
      spoilerText: '',
      mediaAttachments: [
        {
          id: 'server-video-attachment',
          type: 'video',
          url: 'https://activities.local/api/v1/files/video.mp4',
          preview_url: null,
          remote_url: null,
          description: 'video.mp4',
          blurhash: null,
          meta: {
            width: 1280,
            height: 720,
            size: '1280x720',
            aspect: 1.7777777777777777,
            duration: 12,
            fps: 30,
            audio_encode: 'aac',
            audio_bitrate: '128000',
            audio_channels: '2',
            original: {
              width: 1280,
              height: 720,
              duration: 12,
              frame_rate: '30/1',
              bitrate: 1000000
            },
            small: {
              width: 640,
              height: 360,
              size: '640x360',
              aspect: 1.7777777777777777
            }
          }
        }
      ],
      status: {
        id: editStatus.id,
        text: 'Updated post text',
        createdAt: currentTime,
        updatedAt: updatedTime,
        reply: ''
      }
    })

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={{
          ...editStatus,
          attachments: []
        }}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Updated post text' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onPostUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: 'server-video-attachment',
              mediaType: 'video/mp4'
            })
          ]
        })
      )
    })
  })

  it('submits an empty message when clearing text from a media edit', async () => {
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

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: '' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ''
        })
      )
    })
  })

  it('keeps update disabled when an edit would remove all content', async () => {
    const { container } = render(
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

    const updateButton = screen.getByRole('button', { name: 'Update' })
    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: '' }
    })
    expect(updateButton).toBeEnabled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media existing.jpg' })
    )

    expect(updateButton).toBeDisabled()
    fireEvent.submit(container.querySelector('form')!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateNoteMock).not.toHaveBeenCalled()
  })

  it('shows an edit-specific alert when updating a post fails', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
    updateNoteMock.mockRejectedValueOnce(new Error('update failed'))

    try {
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

      fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
        target: { value: 'Updated post text' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(alertMock).toHaveBeenCalledWith('update failed')
      })
    } finally {
      alertMock.mockRestore()
    }
  })

  it('shows media upload failure details when edit media upload fails', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
    uploadAttachmentMock.mockRejectedValueOnce(new Error('unsupported file'))

    try {
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

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media existing.jpg' })
      )
      const fileInput = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input[type="file"][name="file"]'
        )
      ).at(-1)!
      fireEvent.change(fileInput, {
        target: {
          files: [
            new File(['replacement'], 'replacement.png', { type: 'image/png' })
          ]
        }
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(alertMock).toHaveBeenCalledWith(
          'Fail to upload replacement.png: unsupported file'
        )
      })
      expect(updateNoteMock).not.toHaveBeenCalled()
    } finally {
      alertMock.mockRestore()
    }
  })

  it('does not submit an edit when text, warning, and media are unchanged', async () => {
    const { container } = render(
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

    fireEvent.submit(container.querySelector('form')!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Original post text updated' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateNoteMock).toHaveBeenCalledTimes(1)
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Original post text updated'
        })
      )
    })
  })

  it('enables update and uploads media when only edit attachments change', async () => {
    const onPostUpdated = vi.fn()

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={vi.fn()}
      />
    )

    const updateButton = screen.getByRole('button', { name: 'Update' })
    expect(updateButton).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Remove media existing.jpg' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media existing.jpg' })
    )
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(updateButton).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Remove media replacement.png' })
      ).toBeInTheDocument()
    })

    fireEvent.click(updateButton)

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'replacement.png' })
      )
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusId: editStatus.id,
          attachments: [
            expect.objectContaining({
              id: 'uploaded-media',
              name: 'replacement.png'
            })
          ]
        })
      )
    })

    expect(onPostUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Original post text',
        summary: null,
        updatedAt: updatedTime,
        attachments: [
          expect.objectContaining({
            id: 'server-attachment',
            mediaId: 'uploaded-media',
            width: 800,
            height: 600,
            createdAt: updatedTime,
            updatedAt: updatedTime
          })
        ]
      })
    )
  })

  it('preserves fitness attachments in the locally updated status', async () => {
    const onPostUpdated = vi.fn()
    updateNoteMock.mockResolvedValueOnce({
      content: '<p>Updated post text</p>',
      spoilerText: '',
      mediaAttachments: [],
      status: {
        id: editStatus.id,
        text: 'Updated post text',
        createdAt: currentTime,
        updatedAt: updatedTime,
        reply: ''
      }
    })

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={{
          ...editStatus,
          attachments: [fitnessAttachment]
        }}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Updated post text' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onPostUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: 'fitness-attachment',
              mediaType: 'application/gpx+xml',
              mediaId: 'fitness-media',
              statusId: editStatus.id,
              updatedAt: updatedTime
            })
          ]
        })
      )
    })
  })

  it('does not duplicate preserved attachments already returned by the update response', async () => {
    const onPostUpdated = vi.fn()
    updateNoteMock.mockResolvedValueOnce({
      content: '<p>Updated post text</p>',
      spoilerText: '',
      mediaAttachments: [
        {
          id: 'legacy-attachment',
          type: 'image',
          url: 'https://activities.local/api/v1/files/legacy.jpg',
          preview_url: null,
          remote_url: null,
          description: 'legacy.jpg',
          blurhash: null,
          meta: {
            original: {
              width: 800,
              height: 600,
              size: '800x600',
              aspect: 1.3333333333333333
            }
          }
        }
      ],
      status: {
        id: editStatus.id,
        text: 'Updated post text',
        createdAt: currentTime,
        updatedAt: updatedTime,
        reply: ''
      }
    })

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={{
          ...editStatus,
          attachments: [legacyAttachmentWithoutMediaId]
        }}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Updated post text' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onPostUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: 'legacy-attachment'
            })
          ]
        })
      )
    })
    expect(onPostUpdated.mock.calls[0][0].attachments).toHaveLength(1)
  })

  it('ignores reentrant submits while edit media upload is in flight', async () => {
    const deferred = createDeferred<Awaited<ReturnType<typeof updateNote>>>()
    updateNoteMock.mockReturnValue(deferred.promise)

    const { container } = render(
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

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media existing.jpg' })
    )
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
    })

    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
      expect(updateNoteMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      deferred.resolve({
        content: '<p>Original post text</p>',
        spoilerText: '',
        mediaAttachments: [],
        status: {
          id: editStatus.id,
          text: 'Original post text',
          createdAt: currentTime,
          updatedAt: updatedTime,
          reply: ''
        }
      })
    })
  })
})

describe('PostBox edit character limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = vi.fn()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id' as never)
    uploadAttachmentMock.mockResolvedValue({
      type: 'upload',
      id: 'uploaded-media',
      mediaType: 'image/png',
      url: 'https://activities.local/api/v1/files/uploaded.png',
      width: 640,
      height: 480,
      name: 'replacement.png'
    })
  })

  const renderEditPostBox = (maxStatusCharacters?: number) =>
    render(
      <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          editStatus={editStatus}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

  it.each([
    {
      description: 'allows an edit past 500 when the instance limit is higher',
      maxStatusCharacters: 1000,
      expectedEnabled: true
    },
    {
      description: 'blocks an edit past a lowered instance limit',
      maxStatusCharacters: 100,
      expectedEnabled: false
    }
  ])('$description', ({ maxStatusCharacters, expectedEnabled }) => {
    renderEditPostBox(maxStatusCharacters)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(700) }
    })

    const updateButton = screen.getByRole('button', { name: 'Update' })
    if (expectedEnabled) expect(updateButton).toBeEnabled()
    else expect(updateButton).toBeDisabled()
  })

  it('keeps an over-limit draft unsubmittable when media is attached', async () => {
    renderEditPostBox(100)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })

    // Attaching media re-derives `allowPost` through a different call site than
    // the textarea handler; it must use the same resolved limit.
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove media replacement.png' })
      ).toBeInTheDocument()
    )
    // hasEditPostChanged runs from the attachment call site here — a hardcoded
    // 500 would wrongly re-enable Post for this 120-character draft.
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()
  })
})
