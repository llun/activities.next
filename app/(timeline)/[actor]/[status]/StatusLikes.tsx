'use client'

import { Heart } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useMemo, useState } from 'react'

import { getStatusFavouritedBy } from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

const PREVIEW_LIMIT = 5
const DIALOG_PAGE_SIZE = 20

interface Props {
  statusId: string
  totalLikes: number
}

const getDisplayName = (account: MastodonAccount) => {
  const trimmed = account.display_name?.trim()
  if (trimmed) return trimmed
  return `@${account.acct}`
}

const getInitials = (account: MastodonAccount) => {
  const displayName = getDisplayName(account).replace(/^@/, '')
  const parts = displayName.split(/\s+/).filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
}

const getPageOffset = (page: number) => (page - 1) * DIALOG_PAGE_SIZE

export const StatusLikes: FC<Props> = ({ statusId, totalLikes }) => {
  const [recentLikes, setRecentLikes] = useState<MastodonAccount[]>([])
  const [dialogLikes, setDialogLikes] = useState<MastodonAccount[]>([])
  const [likesCount, setLikesCount] = useState(totalLikes)
  const [isRecentLoading, setIsRecentLoading] = useState(false)
  const [isDialogLoading, setIsDialogLoading] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setLikesCount(totalLikes)
  }, [totalLikes])

  useEffect(() => {
    if (totalLikes === 0) {
      setRecentLikes([])
      return
    }

    let isStale = false
    const run = async () => {
      setIsRecentLoading(true)
      try {
        const result = await getStatusFavouritedBy({
          statusId,
          limit: PREVIEW_LIMIT
        })
        if (isStale) return

        setRecentLikes(result.accounts)
        setLikesCount((previous) =>
          result.total > 0 || previous === 0 ? result.total : previous
        )
      } finally {
        if (!isStale) {
          setIsRecentLoading(false)
        }
      }
    }

    run()

    return () => {
      isStale = true
    }
  }, [statusId, totalLikes])

  const totalPages = useMemo(() => {
    if (likesCount <= 0) return 1
    return Math.max(1, Math.ceil(likesCount / DIALOG_PAGE_SIZE))
  }, [likesCount])

  useEffect(() => {
    if (currentPage <= totalPages) return
    setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!isDialogOpen) return

    let isStale = false
    const run = async () => {
      setIsDialogLoading(true)
      try {
        const result = await getStatusFavouritedBy({
          statusId,
          limit: DIALOG_PAGE_SIZE,
          offset: getPageOffset(currentPage)
        })
        if (isStale) return

        setDialogLikes(result.accounts)
        setLikesCount((previous) =>
          result.total > 0 || previous === 0 ? result.total : previous
        )
      } finally {
        if (!isStale) {
          setIsDialogLoading(false)
        }
      }
    }

    run()

    return () => {
      isStale = true
    }
  }, [currentPage, isDialogOpen, statusId])

  if (likesCount === 0) return null

  const hasMoreThanPreview = likesCount > PREVIEW_LIMIT

  return (
    <>
      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="flex items-center gap-2 text-sm">
          <Heart className="size-4 fill-red-500 text-red-500" />
          <span className="font-medium">
            {likesCount} {likesCount === 1 ? 'like' : 'likes'}
          </span>
        </div>

        {isRecentLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Loading recent likes...
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {recentLikes.map((account) => (
              <Link
                key={account.id}
                href={`/@${account.acct}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-2 py-1 text-xs hover:bg-muted"
              >
                <Avatar className="size-5">
                  <AvatarImage
                    src={account.avatar}
                    alt={getDisplayName(account)}
                  />
                  <AvatarFallback>{getInitials(account)}</AvatarFallback>
                </Avatar>
                <span className="max-w-40 truncate">
                  {getDisplayName(account)}
                </span>
              </Link>
            ))}
            {hasMoreThanPreview && (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => {
                  setCurrentPage(1)
                  setIsDialogOpen(true)
                }}
              >
                See all likes
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open)
          if (!open) {
            setCurrentPage(1)
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>People who liked this post</DialogTitle>
            <DialogDescription>
              Showing {likesCount} {likesCount === 1 ? 'like' : 'likes'}.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto rounded-md border">
            {isDialogLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                Loading likes...
              </p>
            ) : dialogLikes.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No likes found on this page.
              </p>
            ) : (
              <div className="divide-y">
                {dialogLikes.map((account) => (
                  <Link
                    key={account.id}
                    href={`/@${account.acct}`}
                    className="flex items-center gap-3 p-4 hover:bg-muted/50"
                  >
                    <Avatar className="size-10">
                      <AvatarImage
                        src={account.avatar}
                        alt={getDisplayName(account)}
                      />
                      <AvatarFallback>{getInitials(account)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {getDisplayName(account)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{account.acct}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {likesCount > DIALOG_PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || isDialogLoading}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages || isDialogLoading}
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                Next
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
