'use client'

import { Ban, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

import { getBlocks, unblock } from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

interface BlocksListProps {
  accounts: MastodonAccount[]
  nextMaxId: string | null
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

export const BlocksList: FC<BlocksListProps> = ({ accounts, nextMaxId }) => {
  const [blockedAccounts, setBlockedAccounts] = useState(accounts)
  const [unblockingId, setUnblockingId] = useState<string | null>(null)
  const [confirmAccount, setConfirmAccount] = useState<MastodonAccount | null>(
    null
  )
  const [nextCursor, setNextCursor] = useState(nextMaxId)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const onUnblock = async (account: MastodonAccount) => {
    setUnblockingId(account.id)
    const relationship = await unblock({ targetActorId: account.url })
    setUnblockingId(null)
    if (!relationship || relationship.blocking) return

    setBlockedAccounts((current) =>
      current.filter((item) => item.id !== account.id)
    )
    setConfirmAccount(null)
  }

  const onLoadMore = async () => {
    if (!nextCursor) return

    setIsLoadingMore(true)
    const result = await getBlocks({ limit: 80, maxId: nextCursor })
    setIsLoadingMore(false)
    setBlockedAccounts((current) => [...current, ...result.accounts])
    setNextCursor(result.nextMaxId)
  }

  if (blockedAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No blocked accounts.
      </div>
    )
  }

  return (
    <>
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
              onClick={() => setConfirmAccount(account)}
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

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? <Loader2 className="animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}

      <Dialog
        open={confirmAccount !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAccount(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unblock account</DialogTitle>
            <DialogDescription>
              This actor may appear in timelines and interact with your posts
              again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAccount(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => confirmAccount && onUnblock(confirmAccount)}
              disabled={!confirmAccount || unblockingId === confirmAccount.id}
            >
              {confirmAccount && unblockingId === confirmAccount.id ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Unblock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
