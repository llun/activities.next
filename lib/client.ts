import { Assets, Stream } from './medias/apple/webstream'
import { Attachment, PostBoxAttachment } from './models/attachment'
import { Follow, FollowStatus } from './models/follow'
import { StatusData } from './models/status'

export interface CreateStatusParams {
  message: string
  replyStatus?: StatusData
  attachments?: PostBoxAttachment[]
}
export const createStatus = async ({
  message,
  replyStatus,
  attachments = []
}: CreateStatusParams) => {
  if (message.trim().length === 0 && attachments.length === 0) {
    // Don't create any empty post
    return
  }

  const response = await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyStatus,
      message,
      attachments
    })
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return
  }

  const json = await response.json()
  return {
    status: json.status as StatusData,
    attachments: json.attachments as Attachment[]
  }
}

export interface DeleteStatusParams {
  statusId: string
}
export const deleteStatus = async ({ statusId }: DeleteStatusParams) => {
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

export interface RepostStatusParams {
  statusId: string
}
export const repostStatus = async ({ statusId }: RepostStatusParams) => {
  await fetch('/api/v1/accounts/repost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

export interface UndoRepostStatusParams {
  statusId: string
}
export const undoRepostStatus = async ({
  statusId
}: UndoRepostStatusParams) => {
  await fetch('/api/v1/accounts/repost', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

interface LikeStatusParams {
  statusId: string
}
export const likeStatus = async ({ statusId }: LikeStatusParams) => {
  await fetch('/api/v1/accounts/like', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId })
  })
}

interface UndoLikeStatusParams {
  statusId: string
}
export const undoLikeStatus = async ({ statusId }: UndoLikeStatusParams) => {
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

interface IsFollowingParams {
  targetActorId: string
}
export const isFollowing = async ({ targetActorId }: IsFollowingParams) => {
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
  const follow = data.follow as Follow
  return follow.status === FollowStatus.Accepted
}
