'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  adminApproveAccount,
  adminDeleteAccount,
  adminEnableAccount,
  adminRejectAccount,
  adminUnsensitiveAccount,
  adminUnsilenceAccount,
  adminUnsuspendAccount,
  getAdminAccount,
  performAdminAccountAction
} from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { AdminAccount } from '@/lib/types/mastodon/admin/account'

interface Props {
  // The Mastodon account id — the same id the account entities carry
  // (getClientActorId(actor)).
  actorId: string
  username: string
}

const ActionButton = ({
  label,
  onClick,
  disabled,
  destructive
}: {
  label: string
  onClick: () => void
  disabled: boolean
  destructive?: boolean
}) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={onClick}
    disabled={disabled}
    className={
      destructive
        ? 'border-destructive/40 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text'
        : undefined
    }
  >
    {label}
  </Button>
)

export const ActorModerationPanel = ({ actorId, username }: Props) => {
  const [account, setAccount] = useState<AdminAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setAccount(await getAdminAccount(actorId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [actorId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  // Reject (and any future removing action) deletes the account synchronously,
  // so re-fetching it would 404. Mark it removed instead of reloading.
  const runRemoving = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setRemoved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  if (removed) {
    return <Alert tone="success" title="Account rejected and removed." />
  }
  const retry = () => {
    setLoading(true)
    void load()
  }

  if (loading && !account) {
    return (
      <SkeletonRows
        rows={1}
        rowClassName="h-8"
        label="Loading moderation state"
      />
    )
  }
  if (!account) {
    return (
      <Alert title={error ?? 'Moderation state unavailable'} onRetry={retry} />
    )
  }

  // A non-null role means the actor is account-backed on this instance (the
  // serializer emits null role only for account-less remote actors) — mirroring
  // the API's `Boolean(account)` local gate. This is correct even for a local
  // actor served on a secondary domain, whose `domain` is non-null. Login-scoped
  // actions (disable/enable, approve/reject) apply only to these local actors;
  // remote actors support suspend/silence/sensitize.
  const isLocal = account.role !== null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          @{username} moderation
        </span>
        {account.suspended ? <Badge tone="destructive">Suspended</Badge> : null}
        {account.silenced ? <Badge tone="destructive">Silenced</Badge> : null}
        {account.sensitized ? (
          <Badge tone="destructive">Sensitized</Badge>
        ) : null}
        {account.disabled ? <Badge tone="destructive">Disabled</Badge> : null}
        {isLocal && !account.approved ? (
          <Badge tone="warning">Pending</Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {account.suspended ? (
          <ActionButton
            label="Unsuspend"
            disabled={busy}
            onClick={() => run(() => adminUnsuspendAccount(actorId))}
          />
        ) : (
          <ActionButton
            label="Suspend"
            disabled={busy}
            destructive
            onClick={() =>
              run(() =>
                performAdminAccountAction({ id: actorId, type: 'suspend' })
              )
            }
          />
        )}

        {account.silenced ? (
          <ActionButton
            label="Unsilence"
            disabled={busy}
            onClick={() => run(() => adminUnsilenceAccount(actorId))}
          />
        ) : (
          <ActionButton
            label="Silence"
            disabled={busy}
            onClick={() =>
              run(() =>
                performAdminAccountAction({ id: actorId, type: 'silence' })
              )
            }
          />
        )}

        {account.sensitized ? (
          <ActionButton
            label="Unsensitive"
            disabled={busy}
            onClick={() => run(() => adminUnsensitiveAccount(actorId))}
          />
        ) : (
          <ActionButton
            label="Mark sensitive"
            disabled={busy}
            onClick={() =>
              run(() =>
                performAdminAccountAction({ id: actorId, type: 'sensitive' })
              )
            }
          />
        )}

        {isLocal && account.disabled ? (
          <ActionButton
            label="Enable login"
            disabled={busy}
            onClick={() => run(() => adminEnableAccount(actorId))}
          />
        ) : null}
        {isLocal && !account.disabled ? (
          <ActionButton
            label="Disable login"
            disabled={busy}
            destructive
            onClick={() =>
              run(() =>
                performAdminAccountAction({ id: actorId, type: 'disable' })
              )
            }
          />
        ) : null}

        {isLocal && !account.approved ? (
          <>
            <ActionButton
              label="Approve"
              disabled={busy}
              onClick={() => run(() => adminApproveAccount(actorId))}
            />
            <ActionButton
              label="Reject"
              disabled={busy}
              destructive
              onClick={() => runRemoving(() => adminRejectAccount(actorId))}
            />
          </>
        ) : null}

        {account.suspended ? (
          <ActionButton
            label="Delete permanently"
            disabled={busy}
            destructive
            onClick={() => {
              if (
                window.confirm(
                  'Permanently delete this account? This cannot be undone.'
                )
              ) {
                run(() => adminDeleteAccount(actorId))
              }
            }}
          />
        ) : null}
      </div>

      {error ? <Alert title={error} /> : null}
    </div>
  )
}
