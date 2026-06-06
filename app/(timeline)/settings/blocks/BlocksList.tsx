'use client'

import { Ban } from 'lucide-react'
import { FC } from 'react'

import { getBlocks, unblock } from '@/lib/client'
import { ManageAccountList } from '@/lib/components/settings/ManageAccountList'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

interface BlocksListProps {
  accounts: MastodonAccount[]
  nextMaxId: string | null
}

export const BlocksList: FC<BlocksListProps> = ({ accounts, nextMaxId }) => (
  <ManageAccountList
    accounts={accounts}
    nextMaxId={nextMaxId}
    actionLabel="Unblock"
    actionIcon={Ban}
    failureMessage="Failed to unblock account. Please try again."
    emptyText="No blocked accounts."
    emptyPageText="No blocked accounts on this page."
    dialogTitle="Unblock account"
    dialogDescription="This actor may appear in timelines and interact with your posts again."
    loadMore={(maxId) => getBlocks({ limit: 80, maxId })}
    performAction={async (account) => {
      const relationship = await unblock({ targetActorId: account.url })
      return Boolean(relationship && !relationship.blocking)
    }}
  />
)
