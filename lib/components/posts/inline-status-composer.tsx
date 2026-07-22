'use client'

import { FC } from 'react'

import { PostBox } from '@/lib/components/post-box/post-box'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'

import { StatusReplyBox } from './status-reply-box'
import { StatusComposerMode } from './useInlineComposer'

interface Props {
  host: string
  profile: ActorProfile
  mode: StatusComposerMode
  // Always the resolved note/poll for the target post.
  status: StatusNote | StatusPoll
  isMediaUploadEnabled?: boolean
  onCancel: () => void
  /** A reply or quote produced a new status. */
  onCreated?: (status: Status) => void
  /** An edit updated the target status in place. */
  onUpdated?: (status: Status) => void
}

/**
 * The single inline composer shared by every post surface (timeline, profile,
 * lists, favourites, bookmarks, hashtags, collections, search, status detail).
 * It renders beneath the target post so reply, quote, and edit behave
 * identically everywhere. Reply uses the compact `StatusReplyBox`; quote and
 * edit use the full `PostBox` in the matching mode. On success it bubbles the
 * created/updated status to the caller and then closes.
 *
 * Keep this the only place that maps a composer "mode" to a composer component
 * so a page can never diverge in which authoring actions a post offers.
 */
export const InlineStatusComposer: FC<Props> = ({
  host,
  profile,
  mode,
  status,
  isMediaUploadEnabled,
  onCancel,
  onCreated,
  onUpdated
}) => {
  if (mode === 'reply') {
    return (
      <StatusReplyBox
        profile={profile}
        replyStatus={status}
        isMediaUploadEnabled={isMediaUploadEnabled}
        onCancel={onCancel}
        onPostCreated={(created) => {
          onCreated?.(created)
          onCancel()
        }}
      />
    )
  }

  return (
    <div className="mt-4 border-t border-border/40 pt-4">
      <PostBox
        host={host}
        profile={profile}
        isMediaUploadEnabled={isMediaUploadEnabled}
        quotedStatus={mode === 'quote' ? status : undefined}
        editStatus={mode === 'edit' ? status : undefined}
        onPostCreated={(created) => {
          onCreated?.(created)
          onCancel()
        }}
        onPostUpdated={(updated) => {
          onUpdated?.(updated)
          onCancel()
        }}
        onDiscardReply={onCancel}
        onDiscardQuote={onCancel}
        onDiscardEdit={onCancel}
      />
    </div>
  )
}
