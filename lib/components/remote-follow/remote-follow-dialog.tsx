'use client'

import { FC, FormEvent, useRef, useState } from 'react'

import { getRemoteFollowUrl } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

const REMOTE_FOLLOW_ACCOUNT_KEY = 'activities.remote-follow-account'
const MAX_ACCOUNT_LENGTH = 320

const readRememberedAccount = () => {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(REMOTE_FOLLOW_ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}

const rememberAccount = (account: string) => {
  try {
    window.localStorage.setItem(REMOTE_FOLLOW_ACCOUNT_KEY, account)
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); remembering
    // the handle is a convenience, never a requirement.
  }
}

interface RemoteFollowDialogProps {
  targetHandle: string
}

/**
 * The logged-out Follow affordance: a visitor with an account on another
 * fediverse server types their own handle, and we send them to their home
 * server's remote-follow page with this account pre-filled.
 */
export const RemoteFollowDialog: FC<RemoteFollowDialogProps> = ({
  targetHandle
}) => {
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState(readRememberedAccount)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Closing the dialog abandons whatever lookup is in flight. The lookup can
  // take as long as the outbound WebFinger request's timeout, and it resolves
  // to a URL even when that request fails (the route degrades to the
  // conventional path), so without this a visitor who gave up and dismissed
  // the dialog was navigated off the page seconds later anyway.
  const abandonedRef = useRef(false)

  const handleOpenChange = (nextOpen: boolean) => {
    abandonedRef.current = !nextOpen
    if (!nextOpen) {
      setError(null)
      setIsLoading(false)
    }
    setOpen(nextOpen)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmedAccount = account.trim()
    if (!trimmedAccount || /\s/.test(trimmedAccount)) {
      setError('Enter your address, for example username@mastodon.social')
      return
    }

    abandonedRef.current = false
    setIsLoading(true)
    try {
      const url = await getRemoteFollowUrl({
        account: trimmedAccount,
        target: targetHandle
      })
      if (abandonedRef.current) return
      rememberAccount(trimmedAccount)
      window.location.assign(url)
    } catch (submitError) {
      if (abandonedRef.current) return
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to reach that server'
      )
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className="flex-shrink-0">
        <Button type="button" onClick={() => handleOpenChange(true)}>
          Follow
        </Button>
      </div>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow @{targetHandle}</DialogTitle>
            <DialogDescription>
              To follow this account, sign in to your account on whatever
              fediverse server you use. Enter your address and we&apos;ll send
              you there.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-2 py-4">
              <Label htmlFor="remote-follow-account">Your address</Label>
              <Input
                id="remote-follow-account"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={MAX_ACCOUNT_LENGTH}
                placeholder="E.g. username@mastodon.social"
                value={account}
                disabled={isLoading}
                onChange={(event) => setAccount(event.target.value)}
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !account.trim()}>
                {isLoading ? 'Redirecting...' : 'Go'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
