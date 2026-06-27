'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import type { FollowRequestInitialStatus } from '@/app/(timeline)/notifications/types'
import { acceptFollowRequest, rejectFollowRequest } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { Mastodon } from '@/lib/types/activitypub'
import { cn } from '@/lib/utils'

interface Props {
  account: Mastodon.Account
  // The server-resolved state of the request. Defaults to 'pending' so a row
  // with no resolved status still offers the actions. 'rejected' is only ever
  // reached from this component's own Reject action, so it is not part of the
  // server-supplied initial status.
  initialStatus?: FollowRequestInitialStatus
}

type FollowRequestStatus = FollowRequestInitialStatus | 'rejected'

// Labels for the non-pending states (pending renders the action buttons).
const STATUS_LABEL: Record<Exclude<FollowRequestStatus, 'pending'>, string> = {
  accepted: 'Approved',
  rejected: 'Rejected',
  resolved: 'No longer pending'
}

// The body of a follow-request notification: the actor handle plus Approve /
// Reject actions. The "<name> requested to follow you" headline lives in
// NotificationItem, so the row always reads as a follow request even before the
// actions. When the request is no longer pending (already accepted, rejected,
// or withdrawn) the actions are replaced by a status label so the row never
// invites an action that would just 404.
export const FollowRequestNotification: FC<Props> = ({
  account,
  initialStatus = 'pending'
}) => {
  const router = useRouter()
  const [status, setStatus] = useState<FollowRequestStatus>(initialStatus)
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
            {STATUS_LABEL[status]}
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
