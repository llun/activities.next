import { FC, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

// Base styling shared by every post action button (like/bookmark/repost).
// Callers append a colour variant via cn(ACTION_BUTTON_CLASS, ...).
export const ACTION_BUTTON_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'

const ERROR_DISMISS_MS = 4000

/**
 * Error state that auto-clears after a few seconds — used by action buttons to
 * surface a transient failure tooltip. The returned setter can also be called
 * with `null` to clear immediately (e.g. when the underlying status changes).
 */
export const useDismissingError = () => {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!error) return

    const timeoutId = setTimeout(() => setError(null), ERROR_DISMISS_MS)
    return () => clearTimeout(timeoutId)
  }, [error])

  return [error, setError] as const
}

const ACTION_ERROR_CLASS =
  'pointer-events-none w-max max-w-[min(12rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm'

interface ActionErrorProps {
  message: string
  testId: string
}

/** The transient error tooltip rendered beneath an action button. */
export const ActionButtonError: FC<ActionErrorProps> = ({
  message,
  testId
}) => (
  <span
    className={cn('absolute right-0 top-full z-10 mt-1', ACTION_ERROR_CLASS)}
    data-testid={testId}
    role="alert"
  >
    {message}
  </span>
)

/**
 * The same tooltip for actions whose button is not in the row — on a compact
 * post the bookmark and the reaction both live in the ⋯ menu, so their failures
 * have nowhere of their own to hang off and the row shows them instead.
 *
 * They stack rather than sharing one anchor: two of these can be live at once
 * (the writes are independent), and both anchored `right-0 top-full` would
 * render one opaque box exactly on top of the other. Anchored left, clear of
 * the ⋯ menu's own error, which is pinned to the row's right edge.
 */
export const ActionRowErrors: FC<{ errors: ActionErrorProps[] }> = ({
  errors
}) =>
  errors.length === 0 ? null : (
    <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 flex flex-col items-start gap-1">
      {errors.map((error) => (
        <span
          key={error.testId}
          className={ACTION_ERROR_CLASS}
          data-testid={error.testId}
          role="alert"
        >
          {error.message}
        </span>
      ))}
    </div>
  )
