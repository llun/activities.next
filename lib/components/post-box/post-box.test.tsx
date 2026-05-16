/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { updateNote, uploadAttachment } from '@/lib/client'
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

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div>{children}</div>
}))

jest.mock('rehype-sanitize', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('remark-breaks', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: jest.fn((file) => Promise.resolve(file))
}))

const updateNoteMock = updateNote as jest.MockedFunction<typeof updateNote>
const uploadAttachmentMock = uploadAttachment as jest.MockedFunction<
  typeof uploadAttachment
>

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

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
      status: {
        id: editStatus.id,
        text: '<p>Original post text</p>',
        createdAt: new Date(currentTime),
        updatedAt: new Date(currentTime),
        reply: ''
      }
    })
  })

  it('enables update and uploads media when only edit attachments change', async () => {
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
          statusId: 'activities.local:users:llun:statuses:post-1',
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
})
