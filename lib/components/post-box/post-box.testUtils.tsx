import { vi } from 'vitest'

import {
  createNote,
  createPoll,
  updateNote,
  uploadAttachment
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'
import { resizeImage } from '@/lib/utils/resizeImage'

/*
 * Shared fixtures for the post-box test files. Each test file declares its own
 * vi.mock(...) calls (mocks are hoisted per file); the typed handles below
 * resolve to those mocks.
 */

export const updateNoteMock = updateNote as jest.MockedFunction<
  typeof updateNote
>
export const createNoteMock = createNote as jest.MockedFunction<
  typeof createNote
>
export const createPollMock = createPoll as jest.MockedFunction<
  typeof createPoll
>
export const resizeImageMock = resizeImage as jest.MockedFunction<
  typeof resizeImage
>
export const uploadAttachmentMock = uploadAttachment as jest.MockedFunction<
  typeof uploadAttachment
>

export const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()
export const updatedTime = new Date('2026-04-26T11:00:00.000Z').getTime()

export const profile: ActorProfile = {
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

export const existingAttachment: Attachment = {
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

export const legacyAttachmentWithoutMediaId: Attachment = {
  ...existingAttachment,
  id: 'legacy-attachment',
  url: 'https://activities.local/api/v1/files/legacy.jpg',
  name: 'legacy.jpg',
  mediaId: null
}

export const fitnessAttachment: Attachment = {
  ...existingAttachment,
  id: 'fitness-attachment',
  mediaType: 'application/gpx+xml',
  url: 'https://activities.local/api/v1/fitness-files/fitness-file-1',
  name: 'activity.gpx',
  mediaId: 'fitness-media'
}

export const editStatus: EditableStatus = {
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
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [existingAttachment],
  tags: []
}

export const resetEditMediaMocks = () => {
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
}
