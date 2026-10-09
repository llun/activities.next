import { fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'

import {
  createNote,
  getGalleryGears,
  getGallerySettings,
  getMedia,
  getMediaAlbums,
  suggestMediaSubjects,
  updateMediaDetails,
  uploadAttachment
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { UploadedAttachment } from '@/lib/types/domain/attachment'

import { PostBox } from './post-box'

/*
 * Shared fixtures and render helpers for the post-box-media test files. Each
 * test file declares its own vi.mock(...) calls (mocks are hoisted per file);
 * the vi.mocked handles below resolve to those mocks.
 */

export const uploadAttachmentMock = vi.mocked(uploadAttachment)
export const getMediaMock = vi.mocked(getMedia)
export const suggestMock = vi.mocked(suggestMediaSubjects)
export const getGallerySettingsMock = vi.mocked(getGallerySettings)
export const updateMediaDetailsMock = vi.mocked(updateMediaDetails)
export const createNoteMock = vi.mocked(createNote)
export const getMediaAlbumsMock = vi.mocked(getMediaAlbums)

export const profile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  totalLikes: 0,
  totalShares: 0
} as unknown as ActorProfile

export const uploaded = (
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

export const mediaEntity = (
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

export const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    allowEmptyDescription: true,
    altTextAvailable: false,
    defaultPlacePrecision: 'hidden',
    ...overrides
  }) as unknown as Awaited<ReturnType<typeof getGallerySettings>>

export const renderPostBox = () =>
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

export const attach = (...names: string[]) => {
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

export const resetPostBoxMediaMocks = () => {
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
  getMediaAlbumsMock.mockResolvedValue({
    albums: [
      { id: 'a1', title: 'Kruger', visibility: 'public', itemCount: 14 }
    ],
    albumIds: [],
    addable: false
  })
}
