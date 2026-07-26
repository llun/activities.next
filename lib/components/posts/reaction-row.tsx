'use client'

import { SmilePlus } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import { reactToStatus, unreactFromStatus } from '@/lib/client'
import { useDismissingError } from '@/lib/components/posts/actions/actionButtonShared'
import { isUnicodeEmojiReaction } from '@/lib/services/reactions/reactionName'
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

// The write path accepts a unicode emoji or one of THIS instance's enabled
// shortcodes — nothing else. So a chip is only offered as a control when the
// viewer could actually succeed:
//   • unicode                        → always
//   • local shortcode, still enabled → the rollup carries a url (the rollup
//     query resolves urls only for non-disabled local emoji)
//   • local shortcode, disabled/gone → no url, so withheld
//   • remote `shortcode@domain`      → namespaced, never locally reactable
// Own reactions stay actionable regardless, so a reaction is always removable.
const canJoinReaction = (reaction: StatusReaction): boolean => {
  if (reaction.me) return true
  if (isUnicodeEmojiReaction(reaction.name)) return true
  return !reaction.name.includes('@') && Boolean(reaction.url)
}

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
  const pickerTriggerRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useDismissingError()

  // Read inside the resync effect without being one of its dependencies: making
  // it a dependency would re-run the effect when a write settles and overwrite
  // the server's rollups with the (still stale) prop.
  const pendingNameRef = useRef<string | null>(null)
  pendingNameRef.current = pendingName

  useEffect(() => {
    // A write in flight owns the local state: resyncing from the prop mid-flight
    // would discard the optimistic chip, then be overwritten by the server's
    // rollups a moment later, flickering the count.
    if (pendingNameRef.current) return
    setReactions(status.reactions ?? [])
    setError(null)
  }, [status.id, status.reactions, setError])

  const toggle = async (name: string, intent: 'toggle' | 'add' = 'toggle') => {
    // Single-flight: each response carries the status's full authoritative
    // rollups, so two overlapping writes would race and the loser's chip would
    // vanish. Every chip is disabled while one is pending, so this guard is a
    // backstop rather than a silent refusal.
    if (!currentActor || pendingName) return

    const previous = reactions
    const existing = previous.find((reaction) => reaction.name === name)
    // A chip toggles; a pick from the picker only ever adds. Routing a pick
    // through the toggle would make "React with 🔥" *remove* a 🔥 the viewer had
    // already added — the opposite of what the item says it does.
    if (intent === 'add' && existing?.me) return
    const removing = intent === 'toggle' && Boolean(existing?.me)

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

        // A chip nobody can act on — a logged-out reader, or a remote custom
        // emoji this instance cannot react with — is a plain, readable chip
        // rather than a disabled button: a disabled control drops out of the tab
        // order and renders greyed out, hiding the count from keyboard and
        // screen-reader users.
        if (!currentActor || !canJoinReaction(reaction)) {
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
            // Every chip is disabled while a write is in flight: the response
            // carries the whole status's rollups, so overlapping writes would
            // race and lose one of the two changes.
            disabled={pendingName !== null}
            aria-pressed={reaction.me}
            aria-label={`${reaction.me ? 'Remove' : 'Add'} ${reaction.name} reaction, ${reaction.count}`}
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
          ref={pickerTriggerRef}
          type="button"
          disabled={pendingName !== null}
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
          // Focus goes back to the trigger on close, so dismissing the picker
          // with Escape or an outside click does not dump a keyboard user on
          // <body>. On a pick the chip that appears is the natural next target,
          // but the trigger is still the element that was activated.
          onClose={() => {
            setIsPicking(false)
            pickerTriggerRef.current?.focus()
          }}
          onPick={(name) => {
            setIsPicking(false)
            pickerTriggerRef.current?.focus()
            void toggle(name, 'add')
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
