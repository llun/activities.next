import { act } from '@testing-library/react'
import { ReactNode } from 'react'
import { vi } from 'vitest'

import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

export const MockAnnouncementBanner = () => (
  <div data-testid="announcement-banner" />
)

export const MockPageHeader = ({
  actions,
  bottomSlot,
  banner,
  flushOnMobile,
  actionsInMobileBar
}: {
  actions?: ReactNode
  bottomSlot?: ReactNode
  banner?: ReactNode
  flushOnMobile?: boolean
  actionsInMobileBar?: boolean
}) => (
  <div
    data-testid="page-header"
    data-flush-on-mobile={String(Boolean(flushOnMobile))}
    data-actions-in-mobile-bar={String(Boolean(actionsInMobileBar))}
  >
    {banner}
    {actions}
    {bottomSlot}
  </div>
)

export const MockButton = ({
  children,
  onClick,
  disabled,
  'aria-label': ariaLabel,
  variant,
  className,
  ...props
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  'aria-label'?: string
  variant?: string
  className?: string
  [key: string]: unknown
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    data-variant={variant}
    className={className}
    {...props}
  >
    {children}
  </button>
)

export const MockFeed = ({
  statuses,
  currentTime,
  onPostDeleted,
  onPostUpdated,
  onLikeChanged,
  onBookmarkChanged,
  onReactionsChanged,
  onReplyCreated
}: {
  statuses: any[]
  currentTime: number
  onPostDeleted?: (status: any) => void
  onPostUpdated?: (status: any) => void
  onLikeChanged?: (status: any, isLiked: boolean) => void
  onBookmarkChanged?: (status: any, isBookmarked: boolean) => void
  onReactionsChanged?: (status: any, reactions: any[]) => void
  onReplyCreated?: (status: any) => void
}) => (
  <div>
    <div data-testid="posts-current-time">{currentTime}</div>
    <button
      type="button"
      data-testid="trigger-delete-unknown"
      onClick={() =>
        onPostDeleted?.({
          id: 'https://activities.local/users/llun/s/unknown',
          actorId: 'https://activities.local/users/llun',
          actor: null,
          to: [],
          cc: [],
          edits: [],
          isLocalActor: true,
          createdAt: 0,
          updatedAt: 0,
          type: 'note',
          url: 'https://activities.local/users/llun/s/unknown',
          text: 'unknown',
          summary: null,
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isActorBookmarked: false,
          totalLikes: 0,
          totalShares: 0,
          attachments: [],
          tags: []
        })
      }
    >
      delete unknown
    </button>
    <button
      type="button"
      data-testid="trigger-reply-created"
      onClick={() => {
        if (statuses.length > 0) {
          const first = statuses[0]
          const target =
            first.type === 'Announce' ? first.originalStatus : first
          onReplyCreated?.({
            id: 'https://activities.local/users/other/statuses/new-reply-1',
            actorId: 'https://activities.local/users/other',
            type: 'note',
            reply: target.id,
            text: 'A brand new reply',
            createdAt: 1000,
            totalReplies: 0,
            totalLikes: 0,
            totalShares: 0
          })
        }
      }}
    >
      reply created
    </button>
    {statuses.map((status) => {
      const target = (
        status.type === 'Announce' ? status.originalStatus : status
      ) as any
      return (
        <div key={status.id} data-testid={`post-${status.id}`}>
          <span data-testid={`post-id-${status.id}`}>{status.id}</span>
          <span data-testid={`post-text-${status.id}`}>{target.text}</span>
          <span data-testid={`post-liked-${status.id}`}>
            {String(target.isActorLiked)}
          </span>
          <span data-testid={`post-bookmarked-${status.id}`}>
            {String(target.isActorBookmarked)}
          </span>
          <span data-testid={`post-likes-${status.id}`}>
            {target.totalLikes}
          </span>
          <span data-testid={`post-reactions-${status.id}`}>
            {target.reactions?.length ?? 0}
          </span>
          <span data-testid={`post-playback-${status.id}`}>
            {target.attachments?.[0]?.playbackType ?? 'none'}
          </span>
          <span data-testid={`post-replies-${status.id}`}>
            {target.totalReplies ?? 0}
          </span>
          <button
            type="button"
            data-testid={`trigger-reply-${status.id}`}
            onClick={() =>
              onReplyCreated?.({
                id: `https://activities.local/users/other/statuses/reply-to-${status.id}`,
                actorId: 'https://activities.local/users/other',
                type: 'note',
                reply: target.id,
                text: 'reply text',
                createdAt: 1000,
                totalReplies: 0,
                totalLikes: 0,
                totalShares: 0
              })
            }
          >
            reply status
          </button>
          <button
            type="button"
            data-testid={`trigger-delete-${status.id}`}
            onClick={() => onPostDeleted?.(status)}
          >
            delete status
          </button>
          <button
            type="button"
            data-testid={`trigger-delete-target-${status.id}`}
            onClick={() => onPostDeleted?.(target)}
          >
            delete target
          </button>
          <button
            type="button"
            data-testid={`trigger-delete-clone-${status.id}`}
            onClick={() => onPostDeleted?.({ ...target })}
          >
            delete clone
          </button>
          <button
            type="button"
            data-testid={`trigger-update-${status.id}`}
            onClick={() =>
              onPostUpdated?.({ ...target, text: 'updated text' } as any)
            }
          >
            update status
          </button>
          <button
            type="button"
            data-testid={`trigger-like-${status.id}`}
            onClick={() => onLikeChanged?.(target as any, true)}
          >
            like status
          </button>
          <button
            type="button"
            data-testid={`trigger-unlike-${status.id}`}
            onClick={() => onLikeChanged?.(target as any, false)}
          >
            unlike status
          </button>
          <button
            type="button"
            data-testid={`trigger-bookmark-${status.id}`}
            onClick={() => onBookmarkChanged?.(target as any, true)}
          >
            bookmark status
          </button>
          <button
            type="button"
            data-testid={`trigger-unbookmark-${status.id}`}
            onClick={() => onBookmarkChanged?.(target as any, false)}
          >
            unbookmark status
          </button>
          <button
            type="button"
            data-testid={`trigger-react-${status.id}`}
            onClick={() =>
              onReactionsChanged?.(target as any, [
                { name: '🎉', count: 1, me: true }
              ])
            }
          >
            react status
          </button>
        </div>
      )
    })}
  </div>
)

export const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()

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
  createdAt: FIXED_CURRENT_TIME
}

export const createStatus = (
  id: string,
  overrides: Partial<StatusNote> = {}
): StatusNote => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME,
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
  totalShares: 0,
  attachments: [],
  tags: [],
  ...overrides
})

export const createAnnounceStatus = (
  id: string,
  originalStatus: Status,
  overrides: Partial<StatusAnnounce> = {}
): StatusAnnounce => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME,
  type: StatusType.enum.Announce,
  originalStatus,
  ...overrides
})

export const observerCallbacks: ((
  entries: IntersectionObserverEntry[]
) => void)[] = []
export const observeMock = vi.fn()
export const disconnectMock = vi.fn()

export class MockIntersectionObserver {
  callback: (entries: IntersectionObserverEntry[]) => void
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    this.callback = callback
    observerCallbacks.push(callback)
  }
  observe = observeMock
  unobserve = vi.fn()
  disconnect = disconnectMock
}

export const triggerIntersection = (isIntersecting: boolean) => {
  act(() => {
    for (const cb of observerCallbacks) {
      cb([{ isIntersecting } as IntersectionObserverEntry])
    }
  })
}

export const installIntersectionObserver = () => {
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    MockIntersectionObserver
}

export const resetIntersectionObserver = () => {
  observerCallbacks.length = 0
  observeMock.mockClear()
  disconnectMock.mockClear()
}
