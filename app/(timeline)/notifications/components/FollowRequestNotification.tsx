'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { acceptFollowRequest, rejectFollowRequest } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { Mastodon } from '@/lib/types/activitypub'
import { cn } from '@/lib/utils'

interface Props {
  account: Mastodon.Account
}

// The body of a follow-request notification: the actor handle plus Approve /
// Reject actions. The "<name> requested to follow you" headline lives in
// NotificationItem, so the row always reads as a follow request even before the
// actions.
export const FollowRequestNotification: FC<Props> = ({ account }) => {
  const router = useRouter()
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected'>(
    'pending'
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const respond = async (action: 'accept' | 'reject') => {
    setIsLoading(true)
    setError(null)
    try {
      const ok =
        action === 'accept'
          ? await acceptFollowRequest({ id: account.url })
          : await rejectFollowRequest({ id: account.url })
      if (!ok) throw new Error('request failed')
      setStatus(action === 'accept' ? 'accepted' : 'rejected')
      router.refresh()
    } catch {
      setError(`Failed to ${action} follow request. Please try again.`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13px] text-muted-foreground">
          @{account.acct}
        </span>
        {status === 'pending' ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              onClick={() => respond('accept')}
              disabled={isLoading}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => respond('reject')}
              disabled={isLoading}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span
            className={cn(
              'shrink-0 text-[13px] font-medium',
              status === 'accepted'
                ? 'text-green-600 dark:text-green-500'
                : 'text-muted-foreground'
            )}
          >
            {status === 'accepted' ? 'Approved' : 'Rejected'}
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
