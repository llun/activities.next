'use client'

import { Mastodon } from '@llun/activities.schema'
import { FC } from 'react'

import { FollowRequestCard } from '@/lib/components/follow-request-card/FollowRequestCard'

interface Props {
  accounts: Mastodon.Account[]
}

export const FollowRequestsList: FC<Props> = ({ accounts }) => {
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
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <FollowRequestCard
          key={account.id}
          account={account}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      ))}
    </div>
  )
}
