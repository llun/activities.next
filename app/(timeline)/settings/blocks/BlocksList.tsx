'use client'

import { Ban, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

import { unblock } from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

interface BlocksListProps {
  accounts: MastodonAccount[]
}

const getInitials = (account: MastodonAccount) =>
  (account.display_name || account.username)
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const BlocksList: FC<BlocksListProps> = ({ accounts }) => {
  const [blockedAccounts, setBlockedAccounts] = useState(accounts)
  const [unblockingId, setUnblockingId] = useState<string | null>(null)

  const onUnblock = async (account: MastodonAccount) => {
    setUnblockingId(account.id)
    const relationship = await unblock({ targetActorId: account.url })
    setUnblockingId(null)
    if (!relationship || relationship.blocking) return

    setBlockedAccounts((current) =>
      current.filter((item) => item.id !== account.id)
    )
  }

  if (blockedAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No blocked accounts.
      </div>
    )
  }

  return (
    <div className="divide-y rounded-lg border">
      {blockedAccounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between gap-4 p-4"
        >
          <Link
            href={account.url}
            className="flex min-w-0 items-center gap-3 hover:underline"
          >
            <Avatar className="h-10 w-10">
              <AvatarImage src={account.avatar || undefined} />
              <AvatarFallback>{getInitials(account)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {account.display_name || account.username}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                @{account.acct}
              </span>
            </span>
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={() => onUnblock(account)}
            disabled={unblockingId === account.id}
          >
            {unblockingId === account.id ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Ban />
            )}
            Unblock
          </Button>
        </div>
      ))}
    </div>
  )
}
