'use client'

import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { acceptFollowRequest, rejectFollowRequest } from '@/lib/client'
import { FollowRequestCard } from '@/lib/components/follow-request-card/FollowRequestCard'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'

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
    const ok = await acceptFollowRequest({ id: accountId })

    if (!ok) {
      throw new Error('Failed to accept follow request')
    }

    router.refresh()
  }

  const handleReject = async (accountId: string) => {
    const ok = await rejectFollowRequest({ id: accountId })

    if (!ok) {
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
