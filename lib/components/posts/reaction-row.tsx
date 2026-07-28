'use client'

import { FC } from 'react'

import { isUnicodeEmojiReaction } from '@/lib/services/reactions/reactionName'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'

import { ReactionState, formatReactionCount } from './useReactionState'

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
// Rollups arrive oldest-first, so on a post that already carries
// MAX_VISIBLE_CHIPS distinct emoji a brand-new reaction sorts last and would be
// truncated away — the viewer would add one and see nothing change but the
// overflow counter. The viewer's own reactions are therefore never truncated;
// the remaining slots go to the rest, still oldest-first. (The per-actor cap is
// well below MAX_VISIBLE_CHIPS, so a viewer's own chips can never fill the row.)
const selectVisibleReactions = (
  reactions: StatusReaction[]
): StatusReaction[] => {
  if (reactions.length <= MAX_VISIBLE_CHIPS) return reactions

  const mineCount = reactions.reduce(
    (total, reaction) => total + (reaction.me ? 1 : 0),
    0
  )
  let remainingSlots = Math.max(0, MAX_VISIBLE_CHIPS - mineCount)
  const visible: StatusReaction[] = []
  for (const reaction of reactions) {
    if (reaction.me) {
      visible.push(reaction)
      continue
    }
    if (remainingSlots === 0) continue
    remainingSlots -= 1
    visible.push(reaction)
  }
  return visible
}

const canJoinReaction = (reaction: StatusReaction): boolean => {
  if (reaction.me) return true
  if (isUnicodeEmojiReaction(reaction.name)) return true
  return !reaction.name.includes('@') && Boolean(reaction.url)
}

const chipClass = (mine: boolean, interactive = true, busy = false) =>
  cn(
    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors',
    // Busy rather than `disabled`: a disabled control is blurred by the browser
    // and drops out of the tab order, which would throw a keyboard user back to
    // <body> mid-interaction. aria-disabled conveys the same state to assistive
    // tech while keeping focus where the user put it.
    busy && 'cursor-not-allowed opacity-50',
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
  state: ReactionState
  /**
   * Pull the row 52px to the left — the avatar column (40px) plus the gap
   * (12px) — so it starts at the post's own left edge and spans the full width
   * of the status, in line with the action row beneath it. Off for surfaces
   * that render the row outside a post's avatar layout.
   */
  fullBleed?: boolean
}

/**
 * The reaction chips under a post. Rendered by `Post` for every surface, so a
 * reaction reads identically everywhere — the same rule the rest of the action
 * row follows. The control that ADDS one lives in the action row
 * (`ReactionButton`); both halves share one `ReactionState`.
 *
 * Reactions are NOT favourites: this row never touches the like button's state.
 */
export const ReactionRow: FC<ReactionRowProps> = ({ state, fullBleed }) => {
  const { currentActor, reactions, pendingName, toggle } = state

  // Nothing to show: the picker trigger no longer lives here, so an unreacted
  // post gets no empty row (and no stray spacing above the action bar).
  if (reactions.length === 0) return null

  // Rollups arrive oldest-first, so on a post that already has MAX_VISIBLE_CHIPS
  // distinct emoji a brand-new reaction sorts last and would be truncated away —
  // the viewer would add one and see nothing change but the overflow counter.
  // The viewer's own reactions are therefore never truncated; the remaining
  // slots go to the others, still oldest-first.
  const visible = selectVisibleReactions(reactions)
  const hiddenCount = reactions.length - visible.length

  return (
    <div
      className={cn(
        'mt-2.5 flex flex-wrap items-center gap-1.5',
        fullBleed && '-ml-[52px]'
      )}
    >
      {visible.map((reaction) => {
        const body = (
          <>
            <ReactionGlyph reaction={reaction} />
            <span className="text-xs font-medium tabular-nums">
              {formatReactionCount(reaction.count)}
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
            // Every chip goes busy while a write is in flight: the response
            // carries the whole status's rollups, so overlapping writes would
            // race and lose one of the two changes. `aria-disabled` rather than
            // `disabled` so the button the user just activated keeps focus.
            aria-disabled={pendingName !== null}
            aria-pressed={reaction.me}
            aria-label={`${reaction.me ? 'Remove' : 'Add'} ${reaction.name} reaction, ${reaction.count}`}
            className={chipClass(reaction.me, true, pendingName !== null)}
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
    </div>
  )
}
