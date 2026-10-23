import { Check, Loader2 } from 'lucide-react'
import { ComponentType, FC, ReactNode } from 'react'

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
  /**
   * `create` is the footer of a form that makes something new: no status text
   * ("No unsaved changes" means nothing before anything exists) apart from an
   * error or the muted `disabledReason`, and the form's own action button at
   * the end of the row, always enabled unless it is saving or `disabledReason`
   * is set. Give it `actionLabel` and, optionally,
   * `actionIcon`. `dirty` and `saved` are ignored. Default `edit`.
   */
  variant?: 'edit' | 'create'
  /**
   * The button's text ("Save block", "Save terms and privacy"). A `create`
   * form always sets its own; an `edit` form keeps "Save" unless a box that
   * shares the page with others says what it saves.
   */
  actionLabel?: string
  /** The create button's icon; `create` only. */
  actionIcon?: ComponentType<{ className?: string }>
  /**
   * Muted text shown when the form is clean instead of "No unsaved changes",
   * for a footer that has something more useful to say about what saving does
   * ("Changes apply to every domain that uses the server terms."). Dirty,
   * Saved and the error still replace it. `edit` only.
   */
  idleNote?: ReactNode
  /**
   * The status text while the form has changes, "Unsaved changes" unless the
   * form words it for its page ("You have unsaved changes"). `edit` only.
   */
  dirtyLabel?: string
  dirty?: boolean
  saving?: boolean
  saved?: boolean
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
   * With `submit`, the `id` of a `<form>` the bar sits outside of (a sticky
   * footer drawn apart from the form): Save submits that form, and Enter in
   * its fields presses it.
   */
  formId?: string
  /**
   * Why Save is off although the form has changes ("Add a keyword to save").
   * Shown next to "Unsaved changes" (as muted status text on its own in the
   * `create` variant), so the bar never claims there is nothing
   * to save while an edit is waiting on something else.
   */
  disabledReason?: string
  /** Switch the button off for a reason the bar does not word (an empty field). */
  disabled?: boolean
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
 * a muted "No unsaved changes" (or the form's own `idleNote`) when clean, the
 * error in the alert colour) and
 * the primary Save button on the right, disabled while the form is clean or
 * saving (or while `disabledReason` says why not), with a spinner inside while
 * it saves. The button is labelled "Save" (or `actionLabel`, for a box that
 * shares its page with others and says what it saves); `variant="create"` (a form that
 * makes something new) shows no Unsaved/Saved status, only an error or the
 * muted `disabledReason`, and uses the form's own `actionLabel` and
 * `actionIcon`.
 * Dirty wins over Saved, so a fresh edit never claims the form is already
 * saved.
 */
export const SaveBar: FC<SaveBarProps> = ({
  variant = 'edit',
  actionLabel = 'Save',
  actionIcon: ActionIcon,
  idleNote,
  dirtyLabel = 'Unsaved changes',
  dirty = false,
  saving = false,
  saved = false,
  error,
  onSave,
  submit = false,
  formId,
  disabledReason,
  disabled = false,
  actions,
  className
}) => {
  const isCreate = variant === 'create'
  const saveButton = (
    <Button
      type={submit ? 'submit' : 'button'}
      form={submit ? formId : undefined}
      onClick={submit ? undefined : onSave}
      disabled={
        saving || disabled || (!isCreate && !dirty) || Boolean(disabledReason)
      }
      className="shrink-0"
    >
      {saving ? (
        <Loader2
          data-slot="spinner"
          aria-hidden="true"
          className="animate-spin"
        />
      ) : ActionIcon ? (
        <ActionIcon aria-hidden="true" />
      ) : null}
      {actionLabel}
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
        {isCreate && !error ? (
          disabledReason ? (
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground min-h-5"
            >
              {disabledReason}
            </p>
          ) : null
        ) : error ? (
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
                {dirtyLabel}
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
              <span className="min-w-0">
                {idleNote ?? 'No unsaved changes'}
              </span>
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
