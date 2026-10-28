'use client'

import { useRouter } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'

import {
  type AccountMigrationKind,
  ApiRequestError,
  cancelAccountRedirect
} from '@/lib/client'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
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

import { MovingDate } from './MovingDate'
import { requestMovingFocus, takeMovingFocus } from './movingFocus'

interface Props {
  actorId: string
  acct: string | null
  kind: AccountMigrationKind
  movedAt: string | null
  cooldownUntil: string | null
}

/**
 * Settings › Moving, after a move or a redirect: it replaces the MoveForm.
 * A redirect can be cancelled (with a confirm dialog); a performed move
 * cannot, and only says when the cooldown lifts.
 */
export const MovedNotice: FC<Props> = ({
  actorId,
  acct,
  kind,
  movedAt,
  cooldownUntil
}) => {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actorChanged, setActorChanged] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)

  // After a move the refreshed page brings this notice in the form's place:
  // the form left a focus request, so the notice takes focus (and is read)
  // instead of focus falling to the body with the result unannounced.
  useEffect(() => {
    if (!takeMovingFocus('moved-notice')) return
    noticeRef.current?.focus()
  }, [])

  const cancelRedirect = async () => {
    setCancelling(true)
    setError(null)
    setActorChanged(false)
    try {
      await cancelAccountRedirect({ actorId })
      // The MoveForm comes back in this alert's place.
      requestMovingFocus('move-form')
      router.refresh()
      setConfirmOpen(false)
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.message === 'Actor changed'
      ) {
        setActorChanged(true)
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not cancel the redirect'
        )
      }
      setConfirmOpen(false)
    } finally {
      setCancelling(false)
    }
  }

  const isRedirect = kind === 'redirect'

  return (
    <>
      {error ? <Alert title={error} /> : null}
      {actorChanged ? <ActorChangedAlert /> : null}
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <Alert
          tone="info"
          live={false}
          title={
            isRedirect ? (
              <>
                This profile has moved to{' '}
                {acct ? <strong>@{acct}</strong> : 'another account'}
              </>
            ) : (
              <>
                You moved to{' '}
                {acct ? <strong>@{acct}</strong> : 'another account'}
              </>
            )
          }
          action={
            isRedirect ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                Cancel redirect
              </Button>
            ) : undefined
          }
        >
          {isRedirect ? (
            <>
              {movedAt ? (
                <>
                  Since <MovingDate at={movedAt} /> your profile shows
                  &quot;moved&quot;.{' '}
                </>
              ) : null}
              Your followers have not been moved, and your posts stay here.
            </>
          ) : (
            <>
              {movedAt ? (
                <>
                  On <MovingDate at={movedAt} />.{' '}
                </>
              ) : null}
              Your followers moved too. This profile is read-only and shows
              &quot;moved&quot;.
              {cooldownUntil ? (
                <>
                  {' '}
                  You can move again on <MovingDate at={cooldownUntil} />.
                </>
              ) : null}
            </>
          )}
        </Alert>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel redirect</DialogTitle>
            <DialogDescription>
              Your profile will stop showing that it moved. Your followers stay
              as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={cancelling}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={cancelRedirect}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel redirect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
