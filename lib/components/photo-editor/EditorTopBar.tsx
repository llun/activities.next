'use client'

import { Loader2, Redo2, SquareSplitHorizontal, Undo2 } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { DialogTitle } from '@/lib/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/lib/components/ui/tooltip'

import { shortcutLabel } from './platform'

interface Props {
  canUndo: boolean
  canRedo: boolean
  comparing: boolean
  saving: boolean
  saveDisabled: boolean
  /** Locks the history and compare buttons while saving or loading. */
  controlsDisabled: boolean
  onCancel: () => void
  onUndo: () => void
  onRedo: () => void
  onComparingChange: (comparing: boolean) => void
  onSave: () => void
}

const WithTooltip = ({
  label,
  children
}: {
  label: string
  children: ReactNode
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
)

export const EditorTopBar = ({
  canUndo,
  canRedo,
  comparing,
  saving,
  saveDisabled,
  controlsDisabled,
  onCancel,
  onUndo,
  onRedo,
  onComparingChange,
  onSave
}: Props) => {
  const holdKeys = (event: KeyboardEvent<HTMLButtonElement>, hold: boolean) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    if (event.repeat) return
    event.preventDefault()
    onComparingChange(hold)
  }

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-1 border-b px-2 md:px-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={saving}
        className="min-h-10 md:min-h-0"
      >
        Cancel
      </Button>
      <DialogTitle className="flex-1 text-center text-sm font-semibold max-md:sr-only">
        Edit photo
      </DialogTitle>
      <div className="flex-1 md:hidden" aria-hidden="true" />
      <div className="flex items-center gap-1">
        <WithTooltip label={`Undo (${shortcutLabel('Ctrl+Z')})`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!canUndo || controlsDisabled}
            onClick={onUndo}
            className="max-md:size-10"
          >
            <Undo2 />
          </Button>
        </WithTooltip>
        <WithTooltip label={`Redo (${shortcutLabel('Ctrl+Shift+Z')})`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!canRedo || controlsDisabled}
            onClick={onRedo}
            className="max-md:size-10"
          >
            <Redo2 />
          </Button>
        </WithTooltip>
        <WithTooltip label="Compare (hold \)">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Compare with original"
            aria-pressed={comparing}
            disabled={controlsDisabled}
            onPointerDown={() => onComparingChange(true)}
            onPointerUp={() => onComparingChange(false)}
            onPointerLeave={() => comparing && onComparingChange(false)}
            onPointerCancel={() => onComparingChange(false)}
            onKeyDown={(event) => holdKeys(event, true)}
            onKeyUp={(event) => holdKeys(event, false)}
            onBlur={() => comparing && onComparingChange(false)}
            className="max-md:size-10 touch-none"
          >
            <SquareSplitHorizontal />
          </Button>
        </WithTooltip>
        <Button
          type="button"
          size="sm"
          className="ml-2 max-md:min-h-10"
          disabled={saveDisabled || saving}
          onClick={onSave}
        >
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </div>
  )
}
