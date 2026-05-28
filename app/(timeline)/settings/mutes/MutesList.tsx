'use client'

import { Loader2, VolumeX } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

import { getMutes, unmute } from '@/lib/client'
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

interface MutesListProps {
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

export const MutesList: FC<MutesListProps> = ({ accounts, nextMaxId }) => {
  const [mutedAccounts, setMutedAccounts] = useState(accounts)
  const [unmutingIds, setUnmutingIds] = useState<Set<string>>(() => new Set())
  const [confirmAccount, setConfirmAccount] = useState<MastodonAccount | null>(
    null
  )
  const [nextCursor, setNextCursor] = useState(nextMaxId)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const onUnmute = async (account: MastodonAccount) => {
    setError('')
    setUnmutingIds((current) => new Set(current).add(account.id))

    try {
      const relationship = await unmute({ targetActorId: account.url })
      if (!relationship || relationship.muting) {
        setError('Failed to unmute account. Please try again.')
        return
      }

      setMutedAccounts((current) =>
        current.filter((item) => item.id !== account.id)
      )
      setConfirmAccount(null)
    } catch (_err) {
      setError('Failed to unmute account. Please try again.')
    } finally {
      setUnmutingIds((current) => {
        const next = new Set(current)
        next.delete(account.id)
        return next
      })
    }
  }

  const onOpenConfirm = (account: MastodonAccount) => {
    setError('')
    setConfirmAccount(account)
  }

  const onCloseConfirm = () => {
    setError('')
    setConfirmAccount(null)
  }

  const onLoadMore = async () => {
    if (!nextCursor) return

    setIsLoadingMore(true)
    try {
      const result = await getMutes({ limit: 80, maxId: nextCursor })
      setMutedAccounts((current) => [...current, ...result.accounts])
      setNextCursor(result.nextMaxId)
    } catch (_err) {
      return
    } finally {
      setIsLoadingMore(false)
    }
  }

  const isConfirmAccountUnmuting = confirmAccount
    ? unmutingIds.has(confirmAccount.id)
    : false

  if (mutedAccounts.length === 0 && !nextCursor) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No muted accounts.
      </div>
    )
  }

  return (
    <>
      {mutedAccounts.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {mutedAccounts.map((account) => (
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
                onClick={() => onOpenConfirm(account)}
                disabled={unmutingIds.has(account.id)}
              >
                {unmutingIds.has(account.id) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <VolumeX />
                )}
                Unmute
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No muted accounts on this page.
        </div>
      )}

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
          if (isConfirmAccountUnmuting) return
          if (!open) onCloseConfirm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unmute account</DialogTitle>
            <DialogDescription>
              This actor&apos;s posts and notifications will appear in your
              timelines and notifications again.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCloseConfirm}
              disabled={isConfirmAccountUnmuting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => confirmAccount && onUnmute(confirmAccount)}
              disabled={!confirmAccount || isConfirmAccountUnmuting}
            >
              {isConfirmAccountUnmuting ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Unmute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
