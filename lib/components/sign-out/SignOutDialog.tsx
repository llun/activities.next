'use client'

import { FileText } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { cn } from '@/lib/utils'

import {
  type UnsentCounts,
  unsentPostsDetail,
  unsentPostsTitle
} from './unsentPostsMessage'
import { useSignOut } from './useSignOut'

export function SignOutDialog({
  open,
  onOpenChange,
  onCloseAutoFocus
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes on close; the account menu sends it back to its row. */
  onCloseAutoFocus?: (event: Event) => void
}) {
  const accountId = useDrafts()?.accountId
  // Null until this opening's count is in: the confirm button waits for it,
  // so a quick tap can never sign out past unsent posts it has not shown.
  // 'unknown' when the count failed: the purge may still delete real posts.
  const [counts, setCounts] = useState<UnsentCounts | 'unknown' | null>(null)
  const { signOut, signingOut, error, clearError } = useSignOut()

  // Reset as it opens, not as it closes, so the warning stays put while the
  // dialog fades out.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setCounts(null)
  }

  useEffect(() => {
    if (!open) {
      clearError()
      return
    }
    let active = true
    if (!accountId) {
      setCounts({ waiting: 0, drafts: 0, profiles: 0 })
      return
    }
    import('@/lib/client/drafts')
      .then((m) => m.countDraftsByState({ accountId }))
      .then((res) => {
        if (active) {
          setCounts(res)
        }
      })
      .catch(() => {
        if (active) {
          setCounts('unknown')
        }
      })
    return () => {
      active = false
    }
  }, [open, accountId, clearError])

  const handleOpenChange = (nextOpen: boolean) => {
    if (signingOut) return
    if (!nextOpen) {
      clearError()
    }
    onOpenChange(nextOpen)
  }

  const known = counts !== null && counts !== 'unknown' ? counts : null
  const hasUnsent = known !== null && known.waiting + known.drafts > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        className="motion-reduce:animate-none"
      >
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
          <DialogDescription>
            You will be signed out on this device. Other devices stay signed in.
          </DialogDescription>
        </DialogHeader>
        {hasUnsent ? (
          <Alert tone="error" title={unsentPostsTitle(known)}>
            {unsentPostsDetail(known)}
          </Alert>
        ) : null}
        {counts === 'unknown' ? (
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t check this device for unsent posts. Signing out
            deletes any that are saved here.
          </p>
        ) : null}
        {error ? <Alert tone="error" title={error} /> : null}
        <DialogFooter>
          {hasUnsent ? (
            <Button asChild variant="ghost" className="sm:mr-auto">
              <Link
                href="/drafts"
                aria-disabled={signingOut || undefined}
                className={cn(signingOut && 'pointer-events-none opacity-50')}
                onClick={(event) => {
                  if (signingOut) {
                    event.preventDefault()
                    return
                  }
                  handleOpenChange(false)
                }}
              >
                <FileText aria-hidden="true" />
                Review drafts
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={signingOut}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={hasUnsent ? 'destructive' : 'default'}
            onClick={() => void signOut()}
            disabled={signingOut || counts === null}
          >
            {signingOut
              ? 'Signing out…'
              : hasUnsent
                ? 'Sign out and delete'
                : 'Sign out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
