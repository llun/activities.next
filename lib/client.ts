import { Timeline } from '@/lib/services/timelines/types'

import { Duration } from './components/PostBox/PollChoices'
import { Attachment, PostBoxAttachment } from './models/attachment'
import { Follow, FollowStatus } from './models/follow'
import { StatusData } from './models/status'
import { Assets, Stream } from './services/apple/webstream'
import { TimelineFormat } from './services/timelines/const'

export interface CreateNoteParams {
  message: string
  replyStatus?: StatusData
  attachments?: PostBoxAttachment[]
}
export const createNote = async ({
  message,
  replyStatus,
  attachments = []
}: CreateNoteParams) => {
  if (message.trim().length === 0 && attachments.length === 0) {
    throw new Error('Message or attachments must not be empty')
  }

  const response = await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'note',
      replyStatus,
      message,
      attachments
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to create a new note')
  }

  const json = await response.json()
  return {
    status: json.status as StatusData,
    attachments: json.attachments as Attachment[]
  }
}

export interface UpdateNoteParams {
  statusId: string
  message: string
}
export const updateNote = async ({ statusId, message }: UpdateNoteParams) => {
  if (message.trim().length === 0) {
    throw new Error('Message must not be empty')
  }

  const response = await fetch(`/api/v1/statuses/${statusId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: message
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to create a new note')
  }

  return response.json()
}

export interface CreatePollParams {
  message: string
  choices: string[]
  durationInSeconds: Duration
  replyStatus?: StatusData
}

export const createPoll = async ({
  message,
  choices,
  durationInSeconds,
  replyStatus
}: CreatePollParams) => {
  if (message.trim().length === 0 && choices.length === 0) {
    throw new Error('Message or choices must not be empty')
  }

  for (const choice of choices) {
    if (choice.trim().length === 0) {
      throw new Error('Choice text must not be empty')
    }
  }

  // TODO: Continue on create poll
  await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'poll',
      replyStatus,
      message,
      durationInSeconds,
      choices
    })
  })
}

export interface DefaultStatusParams {
  statusId: string
}

export const deleteStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(`/api/v1/accounts/outbox`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      statusId
    })
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return false
  }

  return true
}

export const repostStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch('/api/v1/accounts/repost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

export const undoRepostStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch('/api/v1/accounts/repost', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

export const likeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch('/api/v1/accounts/like', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

interface DefaultUUIDStatusParams {
  uuid: string
}

export const getStatusFavouritedBy = async ({
  uuid
}: DefaultUUIDStatusParams) => {
  const response = await fetch(`/api/v1/statuses/${uuid}/favourited_by`, {
    headers: { 'Content-Type': 'application/json' }
  })
  if (response.status !== 200) return []
  return response.json()
}

export const undoLikeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch('/api/v1/accounts/like', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

interface GetAppleSharedGalleryParams {
  albumToken: string
}
export const getAppleSharedGallery = async ({
  albumToken
}: GetAppleSharedGalleryParams) => {
  const response = await fetch(`/api/v1/medias/apple/${albumToken}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return
  }

  const data = await response.json()
  return data.stream as Stream
}

interface GetAppleSharedAlbumAssetsParams {
  albumToken: string
  photoGuids: string[]
}
export const getAppleSharedAlbumAssets = async ({
  albumToken,
  photoGuids
}: GetAppleSharedAlbumAssetsParams) => {
  const response = await fetch(`/api/v1/medias/apple/${albumToken}/assetsUrl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      photoGuids
    })
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return
  }

  const data = await response.json()
  return data.assets as Assets
}

interface FollowParams {
  targetActorId: string
}
export const isFollowing = async ({ targetActorId }: FollowParams) => {
  const searchParams = new URLSearchParams({ targetActorId })
  const response = await fetch(`/api/v1/accounts/follow?${searchParams}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return false
  }

  const data = await response.json()
  if (!data.follow) return false
  const follow = Follow.parse(data.follow)
  return follow.status === FollowStatus.enum.Accepted
}

export const follow = async ({ targetActorId }: FollowParams) => {
  const response = await fetch(`/api/v1/accounts/follow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ target: targetActorId })
  })
  if (response.status !== 202) return false
  return true
}

export const unfollow = async ({ targetActorId }: FollowParams) => {
  const response = await fetch(`/api/v1/accounts/follow`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ target: targetActorId })
  })
  if (response.status !== 202) return false
  return true
}

interface GetTimelineParams {
  timeline: Timeline
  startAfterStatusId?: string
}
export const getTimeline = async ({
  timeline,
  startAfterStatusId
}: GetTimelineParams) => {
  const path = `/api/v1/timelines/${timeline}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (startAfterStatusId) {
    url.searchParams.append('startAfterStatusId', startAfterStatusId)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) return []
  const data = await response.json()
  return data.statuses as StatusData[]
}

interface DeleteSessionParams {
  token: string
}
export const deleteSession = async ({ token }: DeleteSessionParams) => {
  const path = `/api/v1/accounts/sessions/${token}`
  const response = await fetch(path, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

interface UploadMediaParams {
  media: File
  thumbnail?: File
  description?: string
}
export const uploadMedia = async ({
  media,
  thumbnail,
  description
}: UploadMediaParams) => {
  const path = '/api/v2/media'
  const form = new FormData()
  form.append('file', media)
  if (thumbnail) form.append('thumbnail', thumbnail)
  if (description) form.append('description', description)
  const response = await fetch(path, {
    method: 'POST',
    body: form
  })
  if (response.status !== 200) return null
  return response.json()
}
