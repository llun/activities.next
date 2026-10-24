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

import {
  unsentPostsDetail,
  unsentPostsMessage,
  unsentPostsTitle
} from './unsentPostsMessage'
import { useSignOut } from './useSignOut'

export { unsentPostsMessage }

export function SignOutDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const accountId = useDrafts()?.accountId
  const [counts, setCounts] = useState<{ waiting: number; drafts: number }>({
    waiting: 0,
    drafts: 0
  })
  const { signOut, signingOut, error, clearError } = useSignOut()

  useEffect(() => {
    if (!open) {
      clearError()
      return
    }
    let active = true
    if (!accountId) {
      setCounts({ waiting: 0, drafts: 0 })
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
          setCounts({ waiting: 0, drafts: 0 })
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

  const hasUnsent = counts.waiting + counts.drafts > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="motion-reduce:animate-none"
      >
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
          <DialogDescription>
            You will be signed out on this device. Other devices stay signed in.
          </DialogDescription>
        </DialogHeader>
        {hasUnsent ? (
          <Alert tone="error" title={unsentPostsTitle(counts)}>
            {unsentPostsDetail(counts)}
          </Alert>
        ) : null}
        {error ? <Alert tone="error" title={error} /> : null}
        <DialogFooter>
          {hasUnsent ? (
            <Button asChild variant="ghost" className="sm:mr-auto">
              <Link href="/drafts" onClick={() => handleOpenChange(false)}>
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
            disabled={signingOut}
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
