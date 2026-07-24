/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createNote,
  createPoll,
  getCustomEmojis,
  updateNote,
  uploadAttachment
} from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { EditableStatus, Status, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  deleteFitnessFile: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

const updateNoteMock = updateNote as jest.MockedFunction<typeof updateNote>
const createNoteMock = createNote as jest.MockedFunction<typeof createNote>
const createPollMock = createPoll as jest.MockedFunction<typeof createPoll>
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
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = vi.fn()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id')
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
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()

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
          quoteApprovalPolicy: 'public',
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

  it('shows the quoted preview and sends quotedStatus when composing a quote', async () => {
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByText('Quoting')).toBeInTheDocument()

    const textbox = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textbox, { target: { value: 'my commentary' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'my commentary', quotedStatus })
      )
    })
  })

  it('disables the poll toggle while composing a quote (mutually exclusive)', async () => {
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Add poll' })).toBeDisabled()
  })

  it('keeps a new post with media enabled when text is cleared', async () => {
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

    const postButton = screen.getByRole('button', { name: 'Post' })
    const textbox = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textbox, { target: { value: 'caption' } })

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
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const postButton = screen.getByRole('button', { name: 'Post' })
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
    vi.clearAllMocks()
  })

  it('renders custom emoji shortcodes as inline images in the preview', async () => {
    ;(getCustomEmojis as jest.Mock).mockResolvedValueOnce([
      {
        shortcode: 'blobcat',
        url: 'https://activities.local/emojis/blobcat.png',
        static_url: 'https://activities.local/emojis/blobcat.png',
        visible_in_picker: true,
        category: null
      }
    ])

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'hi :blobcat:' } })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' }))

    const image = await screen.findByAltText(':blobcat:')
    expect(image).toHaveAttribute(
      'src',
      'https://activities.local/emojis/blobcat.png'
    )
  })

  it('shows nothing to preview message when textarea is empty', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' }))

    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
  })
})

describe('PostBox character counter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createNoteMock.mockResolvedValue({ status: editStatus, attachments: [] })
  })

  const renderPostBox = (maxStatusCharacters?: number) =>
    render(
      <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

  it.each([
    {
      description:
        'counts down from the default limit when no limit is provided',
      maxStatusCharacters: undefined,
      text: 'hello',
      expectedRemaining: '495',
      expectedOverLimit: false
    },
    {
      description: 'counts down from the instance-configured limit',
      maxStatusCharacters: 1000,
      text: 'hello',
      expectedRemaining: '995',
      expectedOverLimit: false
    },
    {
      description:
        'stays within budget past 500 characters when the limit is raised',
      maxStatusCharacters: 1000,
      text: 'a'.repeat(700),
      expectedRemaining: '300',
      expectedOverLimit: false
    },
    {
      description: 'goes negative past a lowered instance limit',
      maxStatusCharacters: 100,
      text: 'a'.repeat(120),
      expectedRemaining: '-20',
      expectedOverLimit: true
    }
  ])(
    '$description',
    ({ maxStatusCharacters, text, expectedRemaining, expectedOverLimit }) => {
      renderPostBox(maxStatusCharacters)

      fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
        target: { value: text }
      })

      const counter = screen.getByText(expectedRemaining)
      expect(counter).toBeInTheDocument()
      // The counter turns destructive only past the resolved limit — with a
      // hardcoded 500 both the raised and the lowered case would be wrong.
      if (expectedOverLimit) expect(counter).toHaveClass('text-destructive')
      else expect(counter).toHaveClass('text-muted-foreground')
    }
  )

  it('allows posting past 500 characters when the instance limit is higher', async () => {
    renderPostBox(1000)

    const message = 'a'.repeat(700)
    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: message }
    })

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeEnabled()

    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ message })
    )
  })

  it('blocks posting past a lowered instance limit', () => {
    renderPostBox(100)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('re-enables the submit button when the instance limit is raised under an open draft', () => {
    const { rerender } = renderPostBox(100)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    // The layout re-renders with a new resolved limit (router.refresh()); the
    // draft itself does not change, so nothing re-runs the handlers.
    rerender(
      <InstanceLimitsProvider maxStatusCharacters={1000}>
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })
})

describe('PostBox edit character limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = vi.fn()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id')
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
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()
  })
})

describe('PostBox poll creation', () => {
  // The poll editor renders a Radix Switch, which measures itself; jsdom has no
  // ResizeObserver.
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id')
    createPollMock.mockResolvedValue(undefined)
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('clears the draft after creating a poll so it cannot be re-posted as a note', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add poll' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPollMock).toHaveBeenCalled())

    // The poll UI is gone; if the question text survived, the re-enabled Post
    // button would create a duplicate plain note on the next click.
    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })
})

describe('PostBox new post character limit with attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = vi.fn()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id')
  })

  it('keeps an over-limit new post unsubmittable when media is attached', async () => {
    render(
      <InstanceLimitsProvider maxStatusCharacters={100}>
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['image'], 'image.png', { type: 'image/png' })]
      }
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove media image.png' })
      ).toBeInTheDocument()
    )
    // hasNewPostContent runs from the attachment call site here — a hardcoded
    // 500 would wrongly re-enable Post for this 120-character draft.
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })
})
