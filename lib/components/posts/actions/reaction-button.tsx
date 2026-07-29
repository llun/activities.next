'use client'

import { SmilePlus } from 'lucide-react'
import { FC, useEffect, useRef } from 'react'

import {
  ACTION_BUTTON_CLASS,
  ActionButtonError
} from '@/lib/components/posts/actions/actionButtonShared'
import { ReactionPicker } from '@/lib/components/posts/reaction-picker'
import {
  ReactionState,
  formatReactionCount
} from '@/lib/components/posts/useReactionState'
import { cn } from '@/lib/utils'

const getReactionButtonLabel = (total: number) =>
  total > 0
    ? `Add reaction, ${total} ${total === 1 ? 'reaction' : 'reactions'}`
    : 'Add reaction'

interface Props {
  state: ReactionState
  /**
   * A post too narrow to carry the whole bar hands the trigger to the ⋯ menu
   * instead. The picker still renders from here — it is portalled and
   * viewport-positioned, so it only needs to stay mounted.
   */
  hideTrigger?: boolean
}

/**
 * The action-row control that opens the reaction picker, alongside the running
 * total. It sits with reply/boost/like rather than beside the chips so a post
 * with no reactions yet still offers one — and so the chips stay a pure
 * read-out of what people picked.
 */
export const ReactionButton: FC<Props> = ({ state, hideTrigger }) => {
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
    <ActionButtonError message={state.error} testId="reaction-error" />
  ) : null

  // Read inside the effect below without being one of its dependencies, so an
  // ordinary open or close does not re-run it.
  const isPickingRef = useRef(isPicking)
  isPickingRef.current = isPicking

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
            aria-label={getReactionButtonLabel(total)}
            title={getReactionButtonLabel(total)}
            aria-haspopup="dialog"
            aria-expanded={isPicking}
            className={cn(
              ACTION_BUTTON_CLASS,
              mine ? 'text-primary' : 'hover:text-primary',
              isBusy && 'cursor-not-allowed opacity-50'
            )}
            onClick={(event) => {
              event.stopPropagation()
              if (isBusy) return
              setIsPicking((value) => !value)
            }}
          >
            <SmilePlus className="h-4 w-4" />
            {total > 0 && <span>{formatReactionCount(total)}</span>}
          </button>
          {error}
        </span>
      )}
      {/* Portalled and viewport-positioned, so it lays nothing out here. */}
      {isPicking && (
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
      )}
    </>
  )
}
