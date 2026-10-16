'use client'

import { Repeat2 } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import type { Actor } from '@/lib/types/database'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { TimelineParentPreview } from '@/lib/types/domain/timeline'
import type { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { Actions } from './actions/actions'
import {
  ActorAvatar,
  getActorDisplayName,
  getActorIdMention,
  getActorProfileHref
} from './actor'
import { OnMediaSelectedHandle } from './attachments'
import { PostBody, getPostTranslation } from './post-body'
import { PostHeader } from './post-header'
import { ReactionRow } from './reaction-row'
import { ReadOnlyStats } from './read-only-stats'
import { StatusContextIndicator } from './status-context'
import { TranslationProvider } from './translation-context'
import { useReactionState } from './useReactionState'

export interface PostProps {
  host?: string
  currentActor?: ActorProfile | Actor
  currentTime?: number
  status: Status
  editable?: boolean
  showActions?: boolean
  /**
   * Render a non-interactive engagement row (reply/boost/like counts) in place
   * of the action buttons. Used for read-only previews such as the logged-out
   * landing feed. Ignored when `showActions` is on.
   */
  showReadOnlyStats?: boolean
  onReply?: (status: Status) => void
  onBoost?: (status: Status) => void
  onLike?: (status: Status) => void
  onBookmark?: (status: Status) => void
  onDelete?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onQuote?: (status: Status) => void
  onShowEdits?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
  onOpenStatus?: (status: Status) => void
  onShowAttachment?: OnMediaSelectedHandle
  collapsible?: boolean
  postLineLimit?: PostLineLimit
  parentPreview?: TimelineParentPreview | null
  showReplyContext?: boolean
  /**
   * The post a page is about (the status detail), rather than a row in a feed
   * or a thread. Its header row is centred on the avatar, as the design
   * system's Status detail board draws it, where a feed row aligns the header
   * to the avatar's top edge.
   */
  focused?: boolean
  /**
   * This row's first picture is the first visible media of its page region:
   * load it eagerly at high priority. A `focused` post always does.
   */
  prioritizeMedia?: boolean
}

interface BoostStatusProps {
  status: Status
}

export const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.enum.Announce) return null
  const actorName =
    getActorDisplayName(status.actor) || getActorIdMention(status.actorId)
  // Can be undefined — see `getActorProfileHref`'s doc comment for exactly
  // when, since it is not simply "no boost actor row". `ActorInfo` reads the
  // same helper for the header author and degrades to plain text the same way,
  // so the two links in a boosted post's header agree on what is linkable.
  const profileHref = getActorProfileHref(status.actor, status.actorId)

  return (
    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground ml-12">
      <Repeat2 className="size-4" />
      <span>
        Boosted by{' '}
        {profileHref ? (
          // The third actor link in this header, and it carries what the two
          // in `actor.tsx` carry: `prefetch={false}`, because a feed renders
          // this row once per boost and `/@user@domain` is a fully dynamic
          // route that federates out for a remote actor this instance has not
          // persisted (see "Link prefetching in feeds" in AGENTS.md), and the
          // same click guard, so opening a profile never doubles as a click on
          // whatever surface embeds the post.
          <Link
            href={profileHref}
            prefetch={false}
            className="font-medium text-foreground hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ActorDisplayName name={actorName} tags={status.actor?.tags} />
          </Link>
        ) : (
          <ActorDisplayName name={actorName} tags={status.actor?.tags} />
        )}
      </span>
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const {
    host = '',
    currentTime = Date.now(),
    status,
    onShowAttachment = () => {},
    collapsible,
    postLineLimit,
    onOpenStatus
  } = props
  const actualStatus = getActualStatus(status)
  // Held here because the chips and the action-row trigger are two halves of
  // one control. An Announce wrapper carries no reactions of its own — they
  // live on the boosted status, which is what `getActualStatus` resolves to.
  const reactionState = useReactionState({
    currentActor: props.showActions
      ? (props.currentActor as ActorProfile)
      : undefined,
    status: actualStatus,
    onReactionsChanged: props.onReactionsChanged
  })
  // The same gate `Actions` applies to itself, hoisted so the chip row above it
  // knows whether there will be an action row under it to align with.
  const showsActionRow = Boolean(props.showActions && props.currentActor)
  const { isTranslatable, translationLanguage } = getPostTranslation(
    actualStatus,
    Boolean(props.currentActor)
  )

  return (
    <TranslationProvider
      // Reset translation state cleanly if a mounted Post is reused for a
      // different status (e.g. in a virtualized feed).
      key={actualStatus.id}
      statusId={actualStatus.id}
      language={translationLanguage}
      enabled={isTranslatable}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-1">
        <BoostStatus status={status} />
        {props.showReplyContext && (
          <StatusContextIndicator
            parentPreview={props.parentPreview}
            isReply={Boolean(actualStatus.reply)}
            host={host}
          />
        )}
        <div className="flex min-h-0 min-w-0 gap-3">
          <div className="shrink-0">
            <ActorAvatar
              actor={actualStatus.actor}
              actorId={actualStatus.actorId}
              statusUrl={actualStatus.url}
            />
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            <PostHeader
              status={status}
              currentTime={currentTime}
              onOpenStatus={props.onOpenStatus}
              focused={props.focused}
            />

            <PostBody
              host={host}
              currentTime={currentTime}
              status={status}
              currentActor={props.currentActor}
              collapsible={collapsible}
              postLineLimit={postLineLimit}
              onOpenStatus={onOpenStatus}
              onShowAttachment={onShowAttachment}
              prioritizeMedia={Boolean(props.focused || props.prioritizeMedia)}
            />

            <div>
              {/* Chips sit between the content and the action row: they belong to
                the post, not to the actions, and a logged-out reader still sees
                them (read-only) while the action row is hidden. They go
                full-bleed only when that row is there to align with — on a
                read-only surface the row beneath them is `ReadOnlyStats`, which
                starts at the text, and chips hanging 52px further left would
                line up with nothing. */}
              <ReactionRow state={reactionState} fullBleed={showsActionRow} />
              <Actions
                {...props}
                currentTime={currentTime}
                reactionState={reactionState}
              />
              {props.showReadOnlyStats && !props.showActions && (
                <ReadOnlyStats status={status} />
              )}
            </div>
          </div>
        </div>
      </div>
    </TranslationProvider>
  )
}
