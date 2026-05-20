import { Trash2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { deleteStatus } from '@/lib/client'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface Props {
  status: StatusNote | StatusPoll
  onPostDeleted?: (status: Status) => void
}

const DELETE_ERROR_DISMISS_MS = 4000

export const DeleteButton: FC<Props> = ({ status, onPostDeleted }) => {
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const failureMessage = 'Failed to delete post. Please try again.'

  useEffect(() => {
    if (!error) return

    const timeoutId = setTimeout(() => {
      setError(null)
    }, DELETE_ERROR_DISMISS_MS)

    return () => clearTimeout(timeoutId)
  }, [error])

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
          'hover:text-red-500'
        )}
        title="Delete post"
        aria-label="Delete post"
        disabled={isLoading}
        onClick={async (e) => {
          e.stopPropagation()
          if (isLoading) return

          const deleteConfirmation = window.confirm(
            `Confirm delete status! ${
              status.text.length ? `${status.text.slice(0, 20)}...` : status.id
            }`
          )
          if (!deleteConfirmation) return

          setIsLoading(true)
          setError(null)
          try {
            const success = await deleteStatus({ statusId: status.id })
            if (!success) {
              setError(failureMessage)
              return
            }

            onPostDeleted?.(status)
          } catch {
            setError(failureMessage)
          } finally {
            setIsLoading(false)
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error ? (
        <span
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-max max-w-[min(12rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm"
          data-testid="delete-error"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}
