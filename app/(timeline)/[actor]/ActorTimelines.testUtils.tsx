import { ReactNode } from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

export const MockPosts = ({
  statuses,
  currentTime,
  showActions,
  showReadOnlyStats,
  onStatusCreated,
  onPostUpdated,
  onPostDeleted,
  onLikeChanged,
  onBookmarkChanged
}: {
  statuses: Status[]
  currentTime: number
  showActions?: boolean
  showReadOnlyStats?: boolean
  onStatusCreated?: (status: Status) => void
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
}) => (
  <div>
    <div data-testid="posts-current-time">{currentTime}</div>
    <div data-testid="posts-show-actions">{String(Boolean(showActions))}</div>
    <div data-testid="posts-read-only-stats">
      {String(Boolean(showReadOnlyStats))}
    </div>
    {onStatusCreated && (
      <button
        data-testid="trigger-reply-created"
        onClick={() =>
          onStatusCreated(
            createReplyStatus('https://local.example/statuses/new-reply')
          )
        }
      >
        trigger reply created
      </button>
    )}
    {statuses.map((status) => {
      // For a boost, the action callbacks fire with the unwrapped original
      // status (mirroring the real Posts/Actions wiring).
      const target = getOriginalStatus(status)
      return (
        <div key={status.id}>
          <span>{status.id}</span>
          <span data-testid={`like-flag-${target.id}`}>
            {String(target.isActorLiked)}:{target.totalLikes}
          </span>
          <span data-testid={`bookmark-flag-${target.id}`}>
            {String(target.isActorBookmarked)}
          </span>
          <button
            data-testid={`trigger-delete-${target.id}`}
            onClick={() => onPostDeleted?.(target)}
          >
            delete
          </button>
          <button
            data-testid={`trigger-like-${target.id}`}
            onClick={() => onLikeChanged?.(target, !target.isActorLiked)}
          >
            like
          </button>
          <button
            data-testid={`trigger-bookmark-${target.id}`}
            onClick={() =>
              onBookmarkChanged?.(target, !target.isActorBookmarked)
            }
          >
            bookmark
          </button>
          <button
            data-testid={`trigger-update-${target.id}`}
            onClick={() => onPostUpdated?.({ ...target, totalLikes: 99 })}
          >
            update
          </button>
        </div>
      )
    })}
  </div>
)

export const MockProfileGalleryTab = ({
  subviews,
  isCurrentUser
}: {
  subviews: string[]
  isCurrentUser?: boolean
}) => (
  <div data-testid="mock-gallery-tab">
    {subviews.join(',')}:{String(Boolean(isCurrentUser))}
  </div>
)

export const MockActorMediaGallery = () => (
  <div data-testid="mock-media-gallery" />
)

export const MockButton = ({
  children,
  disabled,
  onClick
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}) => (
  <button disabled={disabled} onClick={onClick}>
    {children}
  </button>
)

export const createStatus = (
  id: string,
  overrides: Partial<Status> = {}
): Status => {
  const now = new Date('2026-04-30T10:00:00.000Z').getTime()
  return {
    id,
    actorId: 'https://remote.example/users/actor',
    actor: null,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: now,
    updatedAt: now,
    type: StatusType.enum.Note,
    url: id,
    text: id,
    summary: null,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    attachments: [],
    tags: [],
    ...overrides
  } as Status
}

export const createReplyStatus = (id: string): Status =>
  createStatus(id, { reply: 'https://remote.example/statuses/parent' })

export const createAnnounceStatus = (id: string, original: Status): Status =>
  ({
    ...createStatus(id),
    type: StatusType.enum.Announce,
    originalStatus: original
  }) as Status

export const createFitnessStatus = (id: string): Status =>
  createStatus(id, {
    fitness: {
      id: `${id}-fit`,
      fileName: 'morning-run.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 1024,
      url: `${id}/morning-run.fit`
    }
  } as Partial<Status>)

export const currentActorProfile = {
  id: 'https://local.example/users/me'
} as ActorProfile

export const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()

export const sampleAttachment: Attachment = {
  id: 'att-1',
  actorId: 'https://mastodon.social/users/someone',
  statusId: 'status-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://mastodon.social/media/1.jpg',
  width: 200,
  height: 200,
  blurhash: null,
  name: 'sample attachment',
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME
}
