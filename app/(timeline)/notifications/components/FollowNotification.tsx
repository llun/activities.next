'use client'

import { FC, useState } from 'react'

import { follow } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { Mastodon } from '@/lib/types/activitypub'

interface Props {
  account: Mastodon.Account
}

// The body of a follow (new follower) notification: the actor handle plus a
// "Follow back" action. The "<name> followed you" headline lives in
// NotificationItem.
export const FollowNotification: FC<Props> = ({ account }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  )

  const handleFollowBack = async () => {
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
        <span className="truncate text-[13px] text-muted-foreground">
          @{account.acct}
        </span>
        {state === 'done' ? (
          <span className="shrink-0 text-[13px] font-medium text-muted-foreground">
            Following
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={handleFollowBack}
            disabled={state === 'loading'}
          >
            Follow back
          </Button>
        )}
      </div>
      {state === 'error' && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Couldn&apos;t follow back. Please try again.
        </p>
      )}
    </div>
  )
}
