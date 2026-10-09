import { Check, Loader2 } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface SavedIndicatorProps {
  /** Show the tick and "Saved". The live region itself is always rendered. */
  saved: boolean
  /**
   * Whether a screen reader is told about it. On by default. Turn it off for a
   * control that saves on every keystroke (a keyboard reorder), where "Saved"
   * would be read out after each row's own announcement and bury it. The tick
   * is still drawn; only `role="status"` and `aria-live` are dropped.
   */
  announce?: boolean
  className?: string
}

/**
 * The quiet "Saved" tick for controls that save the moment they change. The
 * region is always in the page and only its text comes and goes, which is what
 * makes a screen reader announce it politely (unless `announce` is off).
 */
export const SavedIndicator: FC<SavedIndicatorProps> = ({
  saved,
  announce = true,
  className
}) => (
  <span
    role={announce ? 'status' : undefined}
    aria-live={announce ? 'polite' : undefined}
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
  /** Called when Save is pressed. Not needed with `submit`. */
  onSave?: () => void
  /**
   * Make Save the form's submit button: the enclosing `<form>` handles the
   * press (and Enter in its fields) through its own `onSubmit` or `action`,
   * instead of `onSave`.
   */
  submit?: boolean
  /**
   * Why Save is off although the form has changes ("Add a keyword to save").
   * Shown next to "Unsaved changes", so the bar never claims there is nothing
   * to save while an edit is waiting on something else.
   */
  disabledReason?: string
  /**
   * Secondary controls set beside Save at the end of the row, such as a Cancel
   * link on a form that leaves the page when it is done.
   */
  actions?: ReactNode
  className?: string
}

/**
 * A form's footer, for `Frame`'s `footer` slot: the state on the left
 * ("Unsaved changes" with a dot when dirty, "Saved" with a tick after a save,
 * a muted "No unsaved changes" when clean, the error in the alert colour) and
 * the primary Save button on the right, disabled while the form is clean or
 * saving (or while `disabledReason` says why not), with a spinner inside while
 * it saves. The button is always "Save".
 * Dirty wins over Saved, so a fresh edit never claims the form is already
 * saved.
 */
export const SaveBar: FC<SaveBarProps> = ({
  dirty,
  saving,
  saved,
  error,
  onSave,
  submit = false,
  disabledReason,
  actions,
  className
}) => {
  const saveButton = (
    <Button
      type={submit ? 'submit' : 'button'}
      onClick={submit ? undefined : onSave}
      disabled={saving || !dirty || Boolean(disabledReason)}
      className="shrink-0"
    >
      {saving ? (
        <Loader2
          data-slot="spinner"
          aria-hidden="true"
          className="animate-spin"
        />
      ) : null}
      Save
    </Button>
  )
  return (
    <div
      data-slot="save-bar"
      className={cn(
        'flex w-full items-center justify-between gap-3',
        className
      )}
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
                {disabledReason ? <span>· {disabledReason}</span> : null}
              </>
            ) : saved ? (
              <>
                <Check
                  aria-hidden="true"
                  className="text-success-text size-4"
                />
                Saved
              </>
            ) : (
              'No unsaved changes'
            )}
          </p>
        )}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {saveButton}
        </div>
      ) : (
        saveButton
      )}
    </div>
  )
}
