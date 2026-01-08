'use client'

import { Mastodon } from '@llun/activities.schema'
import Image from 'next/image'
import { FC, useState } from 'react'
import sanitizeHtml from 'sanitize-html'

import { Button } from '@/lib/components/ui/button'

interface Props {
  account: Mastodon.Account
  onAccept: (accountId: string) => Promise<void>
  onReject: (accountId: string) => Promise<void>
}

export const FollowRequestCard: FC<Props> = ({
  account,
  onAccept,
  onReject
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected'>(
    'pending'
  )

  const handleAccept = async () => {
    setIsLoading(true)
    try {
      await onAccept(account.url)
      setStatus('accepted')
    } catch (error) {
      console.error('Failed to accept follow request:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleReject = async () => {
    setIsLoading(true)
    try {
      await onReject(account.url)
      setStatus('rejected')
    } catch (error) {
      console.error('Failed to reject follow request:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (status !== 'pending') {
    return (
      <div className="flex items-center gap-4 p-4 rounded-xl border bg-background/80">
        <div className="relative size-12 shrink-0">
          {account.avatar && (
            <Image
              src={account.avatar}
              alt={account.display_name || account.username}
              fill
              className="rounded-full object-cover"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">
            {account.display_name || account.username}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            @{account.acct}
          </p>
        </div>
        <span
          className={`text-sm ${status === 'accepted' ? 'text-green-600' : 'text-red-600'}`}
        >
          {status === 'accepted' ? 'Accepted' : 'Rejected'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border bg-background/80">
      <div className="relative size-12 shrink-0">
        {account.avatar && (
          <Image
            src={account.avatar}
            alt={account.display_name || account.username}
            fill
            className="rounded-full object-cover"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {account.display_name || account.username}
        </p>
        <p className="text-sm text-muted-foreground truncate">
          @{account.acct}
        </p>
        {account.note && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {sanitizeHtml(account.note, {
              allowedTags: [],
              allowedAttributes: {}
            })}
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" onClick={handleAccept} disabled={isLoading}>
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleReject}
          disabled={isLoading}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}
