import { Check, Loader2 } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface SavedIndicatorProps {
  /** Show the tick and "Saved". The live region itself is always rendered. */
  saved: boolean
  className?: string
}

/**
 * The quiet "Saved" tick for controls that save the moment they change. The
 * region is always in the page and only its text comes and goes, which is what
 * makes a screen reader announce it politely.
 */
export const SavedIndicator: FC<SavedIndicatorProps> = ({
  saved,
  className
}) => (
  <span
    role="status"
    aria-live="polite"
    className={cn(
      'text-muted-foreground inline-flex min-h-5 items-center gap-1.5 text-sm',
      className
    )}
  >
    {saved ? (
      <>
        <Check aria-hidden="true" className="text-success-text size-4" />
        Saved
      </>
    ) : null}
  </span>
)

interface SaveBarProps {
  dirty: boolean
  saving: boolean
  saved: boolean
  error?: string | null
  onSave: () => void
  className?: string
}

/**
 * A form's footer, for `Frame`'s `footer` slot: the state on the left
 * ("Unsaved changes" with a dot when dirty, "Saved" with a tick after a save,
 * the error in the alert colour) and the primary Save button on the right,
 * disabled while the form is clean or saving, with a spinner inside while it
 * saves. The button is always "Save". Dirty wins over Saved, so a fresh edit
 * never claims the form is already saved.
 */
export const SaveBar: FC<SaveBarProps> = ({
  dirty,
  saving,
  saved,
  error,
  onSave,
  className
}) => (
  <div
    data-slot="save-bar"
    className={cn('flex w-full items-center justify-between gap-3', className)}
  >
    <div className="min-w-0 text-sm">
      {error ? (
        <p role="alert" className="text-destructive-text break-words">
          {error}
        </p>
      ) : (
        <p
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex min-h-5 items-center gap-1.5"
        >
          {dirty ? (
            <>
              <span
                aria-hidden="true"
                className="bg-primary size-2 shrink-0 rounded-full"
              />
              Unsaved changes
            </>
          ) : saved ? (
            <>
              <Check aria-hidden="true" className="text-success-text size-4" />
              Saved
            </>
          ) : null}
        </p>
      )}
    </div>
    <Button
      type="button"
      onClick={onSave}
      disabled={saving || !dirty}
      className="shrink-0"
    >
      {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      Save
    </Button>
  </div>
)
