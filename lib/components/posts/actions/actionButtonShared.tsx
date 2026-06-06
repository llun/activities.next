import { FC, useEffect, useState } from 'react'

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

interface ActionButtonErrorProps {
  message: string
  testId: string
}

/** The transient error tooltip rendered beneath an action button. */
export const ActionButtonError: FC<ActionButtonErrorProps> = ({
  message,
  testId
}) => (
  <span
    className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-max max-w-[min(12rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm"
    data-testid={testId}
    role="alert"
  >
    {message}
  </span>
)
