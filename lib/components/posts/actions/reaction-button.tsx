'use client'

import { SmilePlus } from 'lucide-react'
import dynamic from 'next/dynamic'
import { FC, useEffect, useRef } from 'react'

import {
  createPreloadable,
  runWhenIdle
} from '@/lib/components/lazy/createPreloadable'
import {
  ACTION_BUTTON_CLASS,
  ActionButtonError
} from '@/lib/components/posts/actions/actionButtonShared'
import { LazyChunkBoundary } from '@/lib/components/posts/lazy-chunk-boundary'
import {
  ReactionState,
  formatReactionCount
} from '@/lib/components/posts/useReactionState'
import { cn } from '@/lib/utils'

const loadReactionPicker = () =>
  import('@/lib/components/posts/reaction-picker').then(
    (module) => module.ReactionPicker
  )

// Mounted only while open, so the emoji dataset behind it stays out of every
// post list's first-load bundle. The trigger preloads the chunk on hover/focus.
const DynamicReactionPicker = dynamic(loadReactionPicker, { ssr: false })

// Renders synchronously once preloaded; see `createPreloadable`.
const { Component: ReactionPicker, preload } = createPreloadable(
  loadReactionPicker,
  DynamicReactionPicker
)

export const preloadReactionPicker = () => {
  void preload()
}

const getReactionButtonLabel = (total: number, targetLabel?: string) => {
  const verb = targetLabel ? `Add reaction to ${targetLabel}` : 'Add reaction'
  return total > 0
    ? `${verb}, ${total} ${total === 1 ? 'reaction' : 'reactions'}`
    : verb
}

interface Props {
  state: ReactionState
  /**
   * A post too narrow to carry the whole bar hands the trigger to the ⋯ menu
   * instead. The picker still renders from here — it is portalled and
   * viewport-positioned, so it only needs to stay mounted.
   */
  hideTrigger?: boolean
  /** Names the post when the row's buttons act on different ones. */
  targetLabel?: string
}

/**
 * The action-row control that opens the reaction picker, alongside the running
 * total. It sits with reply/boost/like rather than beside the chips so a post
 * with no reactions yet still offers one — and so the chips stay a pure
 * read-out of what people picked.
 */
export const ReactionButton: FC<Props> = ({
  state,
  hideTrigger,
  targetLabel
}) => {
  const {
    isPicking,
    setIsPicking,
    focusTrigger,
    pendingName,
    total,
    mine,
    triggerRef
  } = state
  const isBusy = pendingName !== null
  const error = state.error ? (
    <ActionButtonError
      message={state.error}
      testId="reaction-error"
      align="center"
    />
  ) : null

  // Read inside the effect below without being one of its dependencies, so an
  // ordinary open or close does not re-run it.
  const isPickingRef = useRef(isPicking)
  isPickingRef.current = isPicking

  // The button only renders for a signed-in viewer, so warm the picker chunk at
  // idle; hover/focus still preload it sooner.
  useEffect(() => runWhenIdle(preloadReactionPicker), [])

  useEffect(() => {
    // The element the picker hangs off moves between this button and the ⋯
    // trigger when the row crosses its width threshold. The panel is placed
    // from the anchor's rect when it opens and does not re-measure on a ref
    // swap, so an open picker would be stranded over the button that just
    // unmounted. Close it — and hand focus to whichever trigger now exists,
    // because the panel disappearing out from under a keyboard user would
    // otherwise drop them on <body>.
    if (!isPickingRef.current) return
    setIsPicking(false)
    focusTrigger()
  }, [hideTrigger, setIsPicking, focusTrigger])

  return (
    <>
      {hideTrigger ? null : (
        <span className="relative inline-flex items-center justify-center">
          <button
            ref={triggerRef}
            type="button"
            // Busy rather than `disabled`, so the control the user just
            // activated keeps focus instead of being blurred back to <body>.
            aria-disabled={isBusy}
            aria-label={getReactionButtonLabel(total, targetLabel)}
            title={getReactionButtonLabel(total, targetLabel)}
            aria-haspopup="dialog"
            aria-expanded={isPicking}
            className={cn(
              ACTION_BUTTON_CLASS,
              'group/react',
              mine ? 'text-primary-text' : 'hover:text-primary-text',
              isBusy && 'cursor-not-allowed opacity-50'
            )}
            onPointerEnter={preloadReactionPicker}
            onFocus={preloadReactionPicker}
            onClick={(event) => {
              event.stopPropagation()
              if (isBusy) return
              setIsPicking((value) => !value)
            }}
          >
            <SmilePlus
              className={cn(
                'h-4 w-4',
                mine ? 'text-primary' : 'group-hover/react:text-primary'
              )}
            />
            {total > 0 && <span>{formatReactionCount(total)}</span>}
          </button>
          {error}
        </span>
      )}
      {/* Portalled and viewport-positioned, so it lays nothing out here. If its
          chunk fails to load, the message is absolutely positioned under the
          action row (`relative`), so it adds no flex item either. */}
      {isPicking && (
        <LazyChunkBoundary
          data-row-overlay
          className="absolute top-full left-0 z-50 mt-1 w-72 max-w-full bg-background"
        >
          <ReactionPicker
            anchorRef={triggerRef}
            // Focus goes back to the trigger on close, so dismissing the picker
            // with Escape or an outside click does not dump a keyboard user on
            // <body>. On a pick the chip that appears is the natural next target,
            // but the trigger is still the element that was activated.
            onClose={() => {
              setIsPicking(false)
              focusTrigger()
            }}
            onPick={(name) => {
              setIsPicking(false)
              focusTrigger()
              void state.toggle(name, 'add')
            }}
          />
        </LazyChunkBoundary>
      )}
    </>
  )
}
