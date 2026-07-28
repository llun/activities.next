'use client'

import {
  Dispatch,
  RefObject,
  SetStateAction,
  useEffect,
  useRef,
  useState
} from 'react'

import { reactToStatus, unreactFromStatus } from '@/lib/client'
import { useDismissingError } from '@/lib/components/posts/actions/actionButtonShared'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

// Counts of 100+ collapse to "99+", matching the announcement reaction chips.
export const formatReactionCount = (count: number): string =>
  count > 99 ? '99+' : `${count}`

export interface ReactionState {
  /**
   * The viewer, when they may react. Undefined on a logged-out or read-only
   * surface, which leaves the chips readable but inert.
   */
  currentActor?: ActorProfile
  reactions: StatusReaction[]
  /** Every rollup's count added up — the number the action-bar trigger shows. */
  total: number
  /** True when one of the rollups is the viewer's own. */
  mine: boolean
  /**
   * The reaction currently being written. Every control goes busy while it is
   * set, because each response carries the status's full authoritative rollups
   * and two overlapping writes would race.
   */
  pendingName: string | null
  error: string | null
  isPicking: boolean
  setIsPicking: Dispatch<SetStateAction<boolean>>
  /**
   * The control the picker hangs off and focus returns to. `Actions` points it
   * at the react button, or at the ⋯ trigger when the row is too narrow to
   * carry that button and the picker is opened from the menu instead.
   */
  triggerRef: RefObject<HTMLButtonElement | null>
  focusTrigger: () => void
  toggle: (name: string, intent?: 'toggle' | 'add') => Promise<void>
}

interface UseReactionStateParams {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

/**
 * The reaction rollups of one status, shared by the chip row (`ReactionRow`)
 * and the action-bar trigger (`ReactionButton`). They are two pieces of the
 * same control in different places on the post, so the writes, the busy state
 * and the error have to be one state — and the owner (`Post`, or the fitness
 * detail, which composes its own action row) holds it.
 *
 * Reactions are NOT favourites: nothing here touches the like button's state.
 */
export const useReactionState = ({
  currentActor,
  status,
  onReactionsChanged
}: UseReactionStateParams): ReactionState => {
  const [reactions, setReactions] = useState<StatusReaction[]>(
    status.reactions ?? []
  )
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [isPicking, setIsPicking] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
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

  const focusTrigger = () => {
    triggerRef.current?.focus()
  }

  const toggle = async (name: string, intent: 'toggle' | 'add' = 'toggle') => {
    // Single-flight: each response carries the status's full authoritative
    // rollups, so two overlapping writes would race and the loser's chip would
    // vanish. Every control is busy while one is pending, so this guard is a
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
    // Removing the last of a reaction unmounts the chip the user just activated.
    // That is correct — they deleted it — but a keyboard user would be dropped
    // on <body>, so move focus to the picker trigger first.
    if (removing && existing?.count === 1) {
      focusTrigger()
    }
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

  return {
    currentActor,
    reactions,
    total: reactions.reduce((sum, reaction) => sum + reaction.count, 0),
    mine: reactions.some((reaction) => reaction.me),
    pendingName,
    error,
    isPicking,
    setIsPicking,
    triggerRef,
    focusTrigger,
    toggle
  }
}
