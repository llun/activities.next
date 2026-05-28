/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createNote, updateNote, uploadAttachment } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'

jest.mock('@/lib/client', () => ({
  createNote: jest.fn(),
  createPoll: jest.fn(),
  deleteFitnessFile: jest.fn(),
  updateNote: jest.fn(),
  uploadAttachment: jest.fn(),
  uploadFitnessFile: jest.fn()
}))

const mockReactMarkdown = jest.fn(({ children }: { children: string }) => (
  <div>{children}</div>
))

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: { children: string; remarkPlugins?: unknown[] }) =>
    mockReactMarkdown(props)
}))

jest.mock('rehype-sanitize', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('remark-breaks', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: jest.fn((file) => Promise.resolve(file))
}))

const updateNoteMock = updateNote as jest.MockedFunction<typeof updateNote>
const createNoteMock = createNote as jest.MockedFunction<typeof createNote>
const uploadAttachmentMock = uploadAttachment as jest.MockedFunction<
  typeof uploadAttachment
>

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()
const updatedTime = new Date('2026-04-26T11:00:00.000Z').getTime()

const profile: ActorProfile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  sharedInboxUrl: 'https://activities.local/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime
}

const existingAttachment: Attachment = {
  id: 'existing-attachment',
  actorId: profile.id,
  statusId: 'https://activities.local/users/llun/statuses/post-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://activities.local/api/v1/files/existing.jpg',
  width: 320,
  height: 240,
  name: 'existing.jpg',
  createdAt: currentTime,
  updatedAt: currentTime,
  mediaId: 'existing-media'
}

const legacyAttachmentWithoutMediaId: Attachment = {
  ...existingAttachment,
  id: 'legacy-attachment',
  url: 'https://activities.local/api/v1/files/legacy.jpg',
  name: 'legacy.jpg',
  mediaId: null
}

const fitnessAttachment: Attachment = {
  ...existingAttachment,
  id: 'fitness-attachment',
  mediaType: 'application/gpx+xml',
  url: 'https://activities.local/api/v1/fitness-files/fitness-file-1',
  name: 'activity.gpx',
  mediaId: 'fitness-media'
}

const editStatus: EditableStatus = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Original post text',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [existingAttachment],
  tags: []
}

describe('PostBox edit media', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.URL.createObjectURL = jest.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = jest.fn()
    global.crypto.randomUUID = jest.fn(() => 'temporary-media-id')
    uploadAttachmentMock.mockResolvedValue({
      type: 'upload',
      id: 'uploaded-media',
      mediaType: 'image/png',
      url: 'https://activities.local/api/v1/files/uploaded.png',
      width: 640,
      height: 480,
      name: 'replacement.png'
    })
    updateNoteMock.mockResolvedValue({
      content: '<p>Original post text</p>',
      spoilerText: '',
      mediaAttachments: [
        {
          id: 'server-attachment',
          type: 'image',
          url: 'https://activities.local/api/v1/files/uploaded.png',
          preview_url: null,
          remote_url: null,
          description: 'replacement.png',
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
        text: 'Original post text',
        createdAt: currentTime,
        updatedAt: updatedTime,
        reply: ''
      }
    })
    createNoteMock.mockResolvedValue({
      status: editStatus,
      attachments: []
    })
  })

  it('enables and submits a media-only new post', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Remove media replacement.png' })
      ).toBeInTheDocument()
    })

    fireEvent.click(postButton)

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'replacement.png' })
      )
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          attachments: [
            expect.objectContaining({
              id: 'uploaded-media',
              name: 'replacement.png'
            })
          ]
        })
      )
    })
  })

  it('keeps a new post with media enabled when text is cleared', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    const postButton = screen.getByRole('button', { name: 'Post' })
    const textbox = screen.getByPlaceholderText("What's on your mind?")
    fireEvent.change(textbox, { target: { value: 'caption' } })

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
    })

    fireEvent.change(textbox, { target: { value: '' } })

    expect(postButton).toBeEnabled()
  })

  it('disables a new post when the only media is removed', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    const postButton = screen.getByRole('button', { name: 'Post' })
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media replacement.png' })
    )

    expect(postButton).toBeDisabled()
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    expect(screen.getByPlaceholderText("What's on your mind?")).toHaveValue(
      'a & b < c > d'
    )
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Remove media legacy.jpg' })
    ).not.toBeInTheDocument()

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
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
    const onPostUpdated = jest.fn()
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
              size: '1280x720',
              aspect: 1.7777777777777777,
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    const updateButton = screen.getByRole('button', { name: 'Update' })
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
    const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {})
    updateNoteMock.mockRejectedValueOnce(new Error('update failed'))

    try {
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          editStatus={editStatus}
          isMediaUploadEnabled
          onDiscardReply={jest.fn()}
          onPostCreated={jest.fn()}
          onPostUpdated={jest.fn()}
          onDiscardEdit={jest.fn()}
        />
      )

      fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
    const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {})
    uploadAttachmentMock.mockRejectedValueOnce(new Error('unsupported file'))

    try {
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          editStatus={editStatus}
          isMediaUploadEnabled
          onDiscardReply={jest.fn()}
          onPostCreated={jest.fn()}
          onPostUpdated={jest.fn()}
          onDiscardEdit={jest.fn()}
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media existing.jpg' })
      )
      const fileInput = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]')
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.submit(container.querySelector('form')!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
    const onPostUpdated = jest.fn()

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        isMediaUploadEnabled
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={jest.fn()}
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
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
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
    const onPostUpdated = jest.fn()
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
    const onPostUpdated = jest.fn()
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
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={onPostUpdated}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
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
    let resolveUpdate: (value: Awaited<ReturnType<typeof updateNote>>) => void
    updateNoteMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      })
    )

    const { container } = render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        isMediaUploadEnabled
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media existing.jpg' })
    )
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')
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
      resolveUpdate!({
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

describe('PostBox markdown preview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes remarkGfm and remarkBreaks plugins to the preview renderer', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText("What's on your mind?")
    fireEvent.change(textarea, { target: { value: '~~strikethrough~~' } })

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Preview' }))

    const mockRemarkGfm = jest.requireMock('remark-gfm').default
    const mockRemarkBreaks = jest.requireMock('remark-breaks').default

    await waitFor(() => {
      expect(mockReactMarkdown).toHaveBeenCalled()
    })

    const plugins =
      mockReactMarkdown.mock.calls[mockReactMarkdown.mock.calls.length - 1][0]
        .remarkPlugins ?? []
    expect(plugins).toContain(mockRemarkGfm)
    expect(plugins).toContain(mockRemarkBreaks)
    expect(plugins.indexOf(mockRemarkGfm)).toBeLessThan(
      plugins.indexOf(mockRemarkBreaks)
    )
  })

  it('shows nothing to preview message when textarea is empty', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={jest.fn()}
        onPostCreated={jest.fn()}
        onPostUpdated={jest.fn()}
        onDiscardEdit={jest.fn()}
      />
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Preview' }))

    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
    expect(mockReactMarkdown).not.toHaveBeenCalled()
  })
})
