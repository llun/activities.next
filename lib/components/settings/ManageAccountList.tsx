'use client'

import { Loader2, LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

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

interface ManageAccountListProps {
  accounts: MastodonAccount[]
  nextMaxId: string | null
  /** Verb shown on the row + dialog action button, e.g. "Unblock". */
  actionLabel: string
  /** Lucide icon rendered on the row action button when idle. */
  actionIcon: LucideIcon
  /** Message surfaced in the dialog when the action fails. */
  failureMessage: string
  /** Empty-state copy when there are no accounts at all. */
  emptyText: string
  /** Empty-state copy when the current page is empty but more may exist. */
  emptyPageText: string
  dialogTitle: string
  dialogDescription: string
  /** Fetches the next page of accounts for the given cursor. */
  loadMore: (
    maxId: string
  ) => Promise<{ accounts: MastodonAccount[]; nextMaxId: string | null }>
  /** Performs the action; resolves true when the account should be removed. */
  performAction: (account: MastodonAccount) => Promise<boolean>
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

/**
 * Shared paginated list for managing a relationship over accounts (blocks,
 * mutes, …): renders each account with an action button, a confirmation dialog,
 * and a "Load more" cursor. Callers supply the labels, icon and the
 * load/action behaviour.
 */
export const ManageAccountList: FC<ManageAccountListProps> = ({
  accounts,
  nextMaxId,
  actionLabel,
  actionIcon: ActionIcon,
  failureMessage,
  emptyText,
  emptyPageText,
  dialogTitle,
  dialogDescription,
  loadMore,
  performAction
}) => {
  const [listedAccounts, setListedAccounts] = useState(accounts)
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const [confirmAccount, setConfirmAccount] = useState<MastodonAccount | null>(
    null
  )
  const [nextCursor, setNextCursor] = useState(nextMaxId)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const onAction = async (account: MastodonAccount) => {
    setError('')
    setPendingIds((current) => new Set(current).add(account.id))

    try {
      const removed = await performAction(account)
      if (!removed) {
        setError(failureMessage)
        return
      }

      setListedAccounts((current) =>
        current.filter((item) => item.id !== account.id)
      )
      setConfirmAccount(null)
    } catch (_err) {
      setError(failureMessage)
    } finally {
      setPendingIds((current) => {
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
      const result = await loadMore(nextCursor)
      setListedAccounts((current) => [...current, ...result.accounts])
      setNextCursor(result.nextMaxId)
    } catch (_err) {
      return
    } finally {
      setIsLoadingMore(false)
    }
  }

  const isConfirmAccountPending = confirmAccount
    ? pendingIds.has(confirmAccount.id)
    : false

  if (listedAccounts.length === 0 && !nextCursor) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }

  return (
    <>
      {listedAccounts.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {listedAccounts.map((account) => (
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
                disabled={pendingIds.has(account.id)}
              >
                {pendingIds.has(account.id) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ActionIcon />
                )}
                {actionLabel}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {emptyPageText}
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
          if (isConfirmAccountPending) return
          if (!open) onCloseConfirm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
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
              disabled={isConfirmAccountPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => confirmAccount && onAction(confirmAccount)}
              disabled={!confirmAccount || isConfirmAccountPending}
            >
              {isConfirmAccountPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
