'use client'

import { Check } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

import type { DraftSaveState } from './useComposerDraft'

interface Props {
  saveState: DraftSaveState
  /** What "Copy text" puts on the clipboard: the composer's text. */
  text: string
}

/**
 * The line under the composer's text area. Only the failure is announced:
 * Saving and Saved after every pause in typing would be noise.
 */
export const DraftSaveStatus: FC<Props> = ({ saveState, text }) => {
  const { copied, copy } = useCopyToClipboard()
  if (saveState === 'idle') return null

  if (saveState === 'error') {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-2 text-xs text-destructive-text"
      >
        <span>Not saved, copy your text</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => void copy(text)}
        >
          {copied ? 'Copied' : 'Copy text'}
        </Button>
      </p>
    )
  }

  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      {saveState === 'saved' ? (
        <>
          <Check className="size-3" aria-hidden="true" />
          Saved on this device
        </>
      ) : (
        'Saving…'
      )}
    </p>
  )
}
