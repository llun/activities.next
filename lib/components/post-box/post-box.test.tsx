/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { updateNote } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { PostBox } from './post-box'

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children
}))

jest.mock('rehype-sanitize', () => jest.fn())
jest.mock('remark-breaks', () => jest.fn())

jest.mock('@/lib/client', () => ({
  createNote: jest.fn(),
  createPoll: jest.fn(),
  deleteFitnessFile: jest.fn(),
  updateNote: jest.fn().mockResolvedValue({}),
  uploadAttachment: jest.fn(),
  uploadFitnessFile: jest.fn()
}))

const updateNoteMock = updateNote as jest.MockedFunction<typeof updateNote>

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
  text: 'Original message',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [
    {
      id: 'attachment-old',
      mediaId: 'media-old',
      actorId: profile.id,
      statusId: 'https://activities.local/users/llun/statuses/post-1',
      type: 'Document',
      mediaType: 'image/png',
      url: 'https://activities.local/api/v1/files/medias/old.png',
      width: 100,
      height: 100,
      name: 'old.png',
      createdAt: currentTime,
      updatedAt: currentTime
    }
  ],
  tags: []
} as EditableStatus

describe('PostBox edit mode', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('enables update when removing media without changing text', async () => {
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

    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Remove media old.png'))
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusId: urlToId(editStatus.id),
          mediaIds: []
        })
      )
    })
  })
})
