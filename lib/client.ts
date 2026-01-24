import { Duration } from '@/lib/components/post-box/poll-choices'
import {
  Attachment,
  PostBoxAttachment,
  UploadedAttachment
} from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { PresignedUrlOutput } from '@/lib/services/medias/types'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { urlToId } from '@/lib/utils/urlToId'

export interface CreateNoteParams {
  message: string
  replyStatus?: Status
  attachments?: PostBoxAttachment[]
  visibility?: MastodonVisibility
}
export const createNote = async ({
  message,
  replyStatus,
  attachments = [],
  visibility
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
      attachments,
      visibility
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to create a new note')
  }

  const json = await response.json()
  return {
    status: json.status as Status,
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

  const mastodonStatus = await response.json()
  return {
    content: mastodonStatus.content,
    status: {
      id: mastodonStatus.id,
      text: mastodonStatus.content,
      createdAt: new Date(mastodonStatus.created_at),
      updatedAt: mastodonStatus.edited_at
        ? new Date(mastodonStatus.edited_at)
        : undefined,
      reply: mastodonStatus.in_reply_to_id || ''
    }
  }
}

export interface CreatePollParams {
  message: string
  choices: string[]
  durationInSeconds: Duration
  pollType?: 'oneOf' | 'anyOf'
  replyStatus?: Status
  visibility?: MastodonVisibility
}

export const createPoll = async ({
  message,
  choices,
  durationInSeconds,
  pollType,
  replyStatus,
  visibility
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
      pollType,
      choices,
      visibility
    })
  })
}

export interface DefaultStatusParams {
  statusId: string
}

/**
 * Deletes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#delete
 */
export const deleteStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(`/api/v1/statuses/${urlToId(statusId)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) {
    return false
  }

  return true
}

/**
 * Reblogs/reposts a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#boost
 */
export const repostStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(`/api/v1/statuses/${urlToId(statusId)}/reblog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return null
  const mastodonStatus = await response.json()
  return { statusId: mastodonStatus.id }
}

/**
 * Undoes a reblog/repost using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unreblog
 */
export const undoRepostStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/unreblog`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  if (response.status !== 200) return null
  const mastodonStatus = await response.json()
  return { statusId: mastodonStatus.id }
}

/**
 * Favourites/likes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#favourite
 */
export const likeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch(`/api/v1/statuses/${urlToId(statusId)}/favourite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

export const getStatusFavouritedBy = async ({
  statusId
}: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/favourited_by`,
    {
      headers: { 'Content-Type': 'application/json' }
    }
  )
  if (response.status !== 200) return []
  return response.json()
}

/**
 * Unfavourites/unlikes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unfavourite
 */
export const undoLikeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch(`/api/v1/statuses/${urlToId(statusId)}/unfavourite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

interface VotePollParams {
  statusId: string
  choices: number[]
}

export const votePoll = async ({ statusId, choices }: VotePollParams) => {
  const response = await fetch('/api/v1/accounts/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId, choices })
  })
  if (response.status !== 200) {
    throw new Error('Failed to vote')
  }
  return response.json()
}

interface FollowParams {
  targetActorId: string
}

/**
 * Checks if current user is following the target actor using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const isFollowing = async ({ targetActorId }: FollowParams) => {
  const encodedId = urlToId(targetActorId)
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodedId}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) {
    return false
  }

  const relationships = await response.json()
  if (!relationships.length) return false
  return relationships[0].following === true
}

/**
 * Follows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#follow
 */
export const follow = async ({ targetActorId }: FollowParams) => {
  const encodedId = urlToId(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/follow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

/**
 * Unfollows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#unfollow
 */
export const unfollow = async ({ targetActorId }: FollowParams) => {
  const encodedId = urlToId(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unfollow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

interface GetTimelineParams {
  timeline: Timeline
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}
export const getTimeline = async ({
  timeline,
  minStatusId,
  maxStatusId,
  limit
}: GetTimelineParams) => {
  const path = `/api/v1/timelines/${timeline}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (minStatusId) {
    url.searchParams.append('min_id', urlToId(minStatusId))
  }
  if (maxStatusId) {
    url.searchParams.append('max_id', urlToId(maxStatusId))
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) return []
  const data = await response.json()
  return data.statuses as Status[]
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

interface CreateUploadPresignedUrlParams {
  media: File
}
export const createUploadPresignedUrl = async ({
  media
}: CreateUploadPresignedUrlParams): Promise<{
  presigned: PresignedUrlOutput
} | null> => {
  const path = '/api/v1/medias/presigned'
  const checksum = await crypto.subtle.digest(
    'SHA-1',
    await media.arrayBuffer()
  )
  const hashArray = Array.from(new Uint8Array(checksum))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  const widthAndHeight = await getMediaWidthAndHeight(media)
  const body = {
    fileName: media.name,
    checksum: hashHex,
    contentType: media.type,
    size: media.size,
    ...widthAndHeight
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (response.status === 404) return null
  if (response.status !== 200) throw new Error('Failed to get presigned URL')
  return response.json()
}

interface UploadFileToPresignedUrlParams {
  presignedUrl: string
  fields: { [key: string]: string }
  media: File
}

export const uploadFileToPresignedUrl = async ({
  presignedUrl,
  fields,
  media
}: UploadFileToPresignedUrlParams) => {
  const data = new FormData()
  data.append('Content-Type', media.type)
  Object.entries(fields).forEach(([key, value]) => {
    data.append(key, value)
  })
  data.append('file', media)

  return fetch(presignedUrl, {
    method: 'POST',
    body: data,
    mode: 'no-cors'
  })
}

export const uploadAttachment = async (
  file: File
): Promise<UploadedAttachment | null> => {
  const result = await createUploadPresignedUrl({ media: file })
  if (!result) {
    const media = await uploadMedia({ media: file })
    if (!media) return null
    return {
      type: 'upload',
      id: media.id,
      mediaType: media.mime_type,
      url: media.url,
      posterUrl: media.preview_url,
      width: media.meta.original.width,
      height: media.meta.original.height,
      name: file.name
    }
  }

  const { url: presignedUrl, fields, saveFileOutput } = result.presigned
  await uploadFileToPresignedUrl({
    media: file,
    presignedUrl,
    fields
  })

  return {
    type: 'upload',
    id: saveFileOutput.id,
    mediaType: saveFileOutput.mime_type,
    url: saveFileOutput.url,
    posterUrl: saveFileOutput.preview_url ?? undefined,
    width: saveFileOutput.meta.original.width,
    height: saveFileOutput.meta.original.height,
    name: file.name
  }
}

interface GetActorMediaParams {
  actorId: string
  maxCreatedAt?: number
  limit?: number
}
export const getActorMedia = async ({
  actorId,
  maxCreatedAt,
  limit = 25
}: GetActorMediaParams): Promise<Attachment[]> => {
  const encodedId = urlToId(actorId)
  const url = new URL(`${window.origin}/api/v1/accounts/${encodedId}/media`)
  if (maxCreatedAt) {
    url.searchParams.append('max_created_at', `${maxCreatedAt}`)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) return []
  return response.json()
}
