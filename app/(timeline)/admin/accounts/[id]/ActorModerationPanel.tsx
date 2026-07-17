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
import { AdminAccount } from '@/lib/types/mastodon/admin/account'

interface Props {
  // The Mastodon account id (urlToId(actor.id)).
  actorId: string
  username: string
}

const Badge = ({ label }: { label: string }) => (
  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
    {label}
  </span>
)

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
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
      destructive
        ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
        : 'hover:bg-muted'
    }`}
  >
    {label}
  </button>
)

export const ActorModerationPanel = ({ actorId, username }: Props) => {
  const [account, setAccount] = useState<AdminAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
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

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading moderation state…</p>
    )
  }
  if (!account) {
    return (
      <p className="text-sm text-destructive">
        {error ?? 'Moderation state unavailable'}
      </p>
    )
  }

  // domain === null means the actor is on this instance's configured host, so
  // login-scoped actions (disable/enable, approve/reject) are available; remote
  // actors only support suspend/silence/sensitize.
  const isLocal = account.domain === null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          @{username} moderation
        </span>
        {account.suspended ? <Badge label="Suspended" /> : null}
        {account.silenced ? <Badge label="Silenced" /> : null}
        {account.sensitized ? <Badge label="Sensitized" /> : null}
        {account.disabled ? <Badge label="Disabled" /> : null}
        {isLocal && !account.approved ? <Badge label="Pending" /> : null}
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
              onClick={() => run(() => adminRejectAccount(actorId))}
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
