'use client'

import { SmilePlus } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { reactToStatus, unreactFromStatus } from '@/lib/client'
import { useDismissingError } from '@/lib/components/posts/actions/actionButtonShared'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'

import { ReactionPicker } from './reaction-picker'

// Counts of 100+ collapse to "99+", matching the announcement reaction chips.
const formatCount = (count: number): string => (count > 99 ? '99+' : `${count}`)

// A hot post can accumulate more distinct emoji than a row can usefully show.
// The rollups arrive in first-reaction order, so the oldest — which is also the
// most established — stay visible.
const MAX_VISIBLE_CHIPS = 12

const chipClass = (mine: boolean, interactive = true) =>
  cn(
    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    mine
      ? 'border-primary/45 bg-primary/10 text-primary'
      : 'border-border bg-background text-foreground',
    // No hover affordance on a chip that cannot be clicked.
    !mine && interactive && 'hover:bg-muted'
  )

// A custom emoji renders as its image; a unicode emoji and a custom emoji whose
// image we could not vouch for (a remote `name@domain` with no trusted url) both
// render as text.
const ReactionGlyph: FC<{ reaction: StatusReaction }> = ({ reaction }) =>
  reaction.url ? (
    <img
      src={reaction.url}
      alt={reaction.name}
      className="max-h-[18px] max-w-[18px] object-contain"
    />
  ) : (
    <span aria-hidden="true">{reaction.name}</span>
  )

interface ReactionRowProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

export interface CustomEmojiOption {
  shortcode: string
  url: string
}

/**
 * The reaction chips under a post, plus the picker that adds one. Rendered by
 * `Post` for every surface, so a reaction behaves identically everywhere — the
 * same rule the rest of the action row follows.
 *
 * Reactions are NOT favourites: this row never touches the like button's state.
 */
export const ReactionRow: FC<ReactionRowProps> = ({
  currentActor,
  status,
  onReactionsChanged
}) => {
  const [reactions, setReactions] = useState<StatusReaction[]>(
    status.reactions ?? []
  )
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [isPicking, setIsPicking] = useState(false)
  const [error, setError] = useDismissingError()

  useEffect(() => {
    setReactions(status.reactions ?? [])
    setError(null)
  }, [status.id, status.reactions, setError])

  const toggle = async (name: string) => {
    if (!currentActor || pendingName) return

    const previous = reactions
    const existing = previous.find((reaction) => reaction.name === name)
    const removing = Boolean(existing?.me)

    // Optimistic: bump or drop the chip, then reconcile with the server's
    // authoritative rollups (which also carry the custom-emoji urls).
    setReactions(
      removing
        ? previous
            .map((reaction) =>
              reaction.name === name
                ? { ...reaction, me: false, count: reaction.count - 1 }
                : reaction
            )
            .filter((reaction) => reaction.count > 0)
        : existing
          ? previous.map((reaction) =>
              reaction.name === name
                ? { ...reaction, me: true, count: reaction.count + 1 }
                : reaction
            )
          : [
              ...previous,
              { name, count: 1, me: true, url: null, static_url: null }
            ]
    )
    setPendingName(name)
    try {
      const result = removing
        ? await unreactFromStatus({ statusId: status.id, name })
        : await reactToStatus({ statusId: status.id, name })
      if (!result.ok) {
        setReactions(previous)
        // The server's own message when it rejected the request outright (the
        // per-actor cap, an emoji this instance won't take) — "try again" would
        // be a lie there, since the same request always fails the same way.
        setError(
          result.error ??
            (removing
              ? 'Failed to remove reaction. Please try again.'
              : 'Failed to add reaction. Please try again.')
        )
        return
      }
      setReactions(result.reactions)
      onReactionsChanged?.(status, result.reactions)
    } catch {
      setReactions(previous)
      setError('Failed to update reaction. Please try again.')
    } finally {
      setPendingName(null)
    }
  }

  // Nothing to show and nothing to do: a logged-out reader on an unreacted post
  // gets no empty row.
  if (reactions.length === 0 && !currentActor) return null

  const visible = reactions.slice(0, MAX_VISIBLE_CHIPS)
  const hiddenCount = reactions.length - visible.length

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
      {visible.map((reaction) => {
        const body = (
          <>
            <ReactionGlyph reaction={reaction} />
            <span className="text-xs font-medium tabular-nums">
              {formatCount(reaction.count)}
            </span>
          </>
        )

        // A reader who cannot react gets a plain, readable chip rather than a
        // disabled button: a disabled control drops out of the tab order and
        // renders greyed out, which would hide the counts from keyboard and
        // screen-reader users on every logged-out surface.
        if (!currentActor) {
          return (
            <span
              key={reaction.name}
              // `role="img"` so the label is authoritative: the glyph itself is
              // aria-hidden, and aria-label on a generic span is not reliably
              // announced, which would leave a screen reader reading just the
              // count with no idea which emoji it belongs to.
              role="img"
              className={chipClass(reaction.me, false)}
              aria-label={`${reaction.name} reaction, ${reaction.count}`}
            >
              {body}
            </span>
          )
        }

        return (
          <button
            key={reaction.name}
            type="button"
            disabled={pendingName === reaction.name}
            aria-pressed={reaction.me}
            aria-label={`${reaction.me ? 'Remove' : 'Add'} ${reaction.name} reaction`}
            className={chipClass(reaction.me)}
            onClick={(event) => {
              event.stopPropagation()
              void toggle(reaction.name)
            }}
          >
            {body}
          </button>
        )
      })}
      {hiddenCount > 0 && (
        <span className="text-muted-foreground text-xs tabular-nums">
          +{hiddenCount}
        </span>
      )}
      {currentActor && (
        <button
          type="button"
          aria-label="Add reaction"
          aria-haspopup="dialog"
          aria-expanded={isPicking}
          className="border-border bg-background text-muted-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
          onClick={(event) => {
            event.stopPropagation()
            setIsPicking((value) => !value)
          }}
        >
          <SmilePlus className="size-3.5" />
        </button>
      )}
      {isPicking && (
        <ReactionPicker
          onClose={() => setIsPicking(false)}
          onPick={(name) => {
            setIsPicking(false)
            void toggle(name)
          }}
        />
      )}
      {error && (
        <span
          className="text-destructive w-full text-xs"
          role="alert"
          data-testid="reaction-error"
        >
          {error}
        </span>
      )}
    </div>
  )
}
