'use client'

import { Mastodon } from '@llun/activities.schema'
import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { FollowRequestCard } from '@/lib/components/follow-request-card/FollowRequestCard'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

interface NotificationWithAccount extends GroupedNotification {
  account: Mastodon.Account
}

interface Props {
  notification: NotificationWithAccount
  currentActorId: string
}

export const FollowRequestNotification: FC<Props> = ({
  notification,
  currentActorId: _currentActorId
}) => {
  const router = useRouter()

  const handleAccept = async (accountId: string) => {
    const response = await fetch(
      `/api/v1/follow_requests/${encodeURIComponent(accountId)}/authorize`,
      {
        method: 'POST'
      }
    )

    if (!response.ok) {
      throw new Error('Failed to accept follow request')
    }

    router.refresh()
  }

  const handleReject = async (accountId: string) => {
    const response = await fetch(
      `/api/v1/follow_requests/${encodeURIComponent(accountId)}/reject`,
      {
        method: 'POST'
      }
    )

    if (!response.ok) {
      throw new Error('Failed to reject follow request')
    }

    router.refresh()
  }

  return (
    <FollowRequestCard
      account={notification.account}
      onAccept={handleAccept}
      onReject={handleReject}
    />
  )
}
