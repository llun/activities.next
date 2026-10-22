'use client'

import { FC, useState } from 'react'

import { follow } from '@/lib/client'
import {
  OFFLINE_MESSAGE,
  OfflineTooltip,
  useIsOffline
} from '@/lib/components/posts/actions/actionButtonShared'
import { Button } from '@/lib/components/ui/button'
import type { Mastodon } from '@/lib/types/activitypub'

interface Props {
  account: Mastodon.Account
}

// The body of a follow (new follower) notification: the actor handle plus a
// "Follow back" action. The "<name> followed you" headline lives in
// NotificationItem.
export const FollowNotification: FC<Props> = ({ account }) => {
  const [state, setState] = useState<
    'idle' | 'loading' | 'done' | 'error' | 'offline'
  >('idle')

  const offline = useIsOffline()

  const handleFollowBack = async () => {
    if (offline) {
      setState('offline')
      return
    }
    setState('loading')
    try {
      const ok = await follow({ targetActorId: account.id })
      setState(ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm text-muted-foreground">
          @{account.acct}
        </span>
        {state === 'done' ? (
          <span className="shrink-0 text-sm font-medium text-muted-foreground">
            Following
          </span>
        ) : (
          <OfflineTooltip offline={offline}>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={handleFollowBack}
              disabled={state === 'loading'}
              aria-disabled={offline || undefined}
            >
              Follow back
            </Button>
          </OfflineTooltip>
        )}
      </div>
      {offline && state === 'offline' && (
        <p className="mt-1 text-xs text-destructive-text" role="status">
          {OFFLINE_MESSAGE}
        </p>
      )}
      {state === 'error' && (
        <p className="mt-1 text-xs text-destructive-text" role="alert">
          Couldn&apos;t follow back. Please try again.
        </p>
      )}
    </div>
  )
}
