'use client'

import { SmilePlus } from 'lucide-react'
import { FC } from 'react'

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

export const getReactionButtonLabel = (total: number) =>
  total > 0
    ? `Add reaction, ${total} ${total === 1 ? 'reaction' : 'reactions'}`
    : 'Add reaction'

interface Props {
  state: ReactionState
}

/**
 * The action-row control that opens the reaction picker, alongside the running
 * total. It sits with reply/boost/like rather than beside the chips so a post
 * with no reactions yet still offers one — and so the chips stay a pure
 * read-out of what people picked.
 */
export const ReactionButton: FC<Props> = ({ state }) => {
  const { isPicking, setIsPicking, pendingName, total, mine, triggerRef } =
    state
  const isBusy = pendingName !== null

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        ref={triggerRef}
        type="button"
        // Busy rather than `disabled`, so the control the user just activated
        // keeps focus instead of being blurred back to <body>.
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
      {isPicking && (
        <ReactionPicker
          anchorRef={triggerRef}
          // Focus goes back to the trigger on close, so dismissing the picker
          // with Escape or an outside click does not dump a keyboard user on
          // <body>. On a pick the chip that appears is the natural next target,
          // but the trigger is still the element that was activated.
          onClose={() => {
            setIsPicking(false)
            state.focusTrigger()
          }}
          onPick={(name) => {
            setIsPicking(false)
            state.focusTrigger()
            void state.toggle(name, 'add')
          }}
        />
      )}
      {state.error && (
        <ActionButtonError message={state.error} testId="reaction-error" />
      )}
    </span>
  )
}
