'use client'

import { VolumeX } from 'lucide-react'
import { FC } from 'react'

import { getMutes, unmute } from '@/lib/client'
import { ManageAccountList } from '@/lib/components/settings/ManageAccountList'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

interface MutesListProps {
  accounts: MastodonAccount[]
  nextMaxId: string | null
}

export const MutesList: FC<MutesListProps> = ({ accounts, nextMaxId }) => (
  <ManageAccountList
    accounts={accounts}
    nextMaxId={nextMaxId}
    actionLabel="Unmute"
    actionIcon={VolumeX}
    failureMessage="Failed to unmute account. Please try again."
    emptyText="No muted accounts."
    emptyPageText="No muted accounts on this page."
    dialogTitle="Unmute account"
    dialogDescription="This actor's posts and notifications will appear in your timelines and notifications again."
    loadMore={(maxId) => getMutes({ limit: 80, maxId })}
    performAction={async (account) => {
      const relationship = await unmute({ targetActorId: account.url })
      return Boolean(relationship && !relationship.muting)
    }}
  />
)
