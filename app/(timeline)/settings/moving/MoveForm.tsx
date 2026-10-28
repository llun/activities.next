'use client'

import { ArrowRightLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'

import {
  type AccountMigrationKind,
  ApiRequestError,
  getAccountMigration,
  moveAccount
} from '@/lib/client'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { RadioCard } from '@/lib/components/surface/RadioCard'
import { SaveBar } from '@/lib/components/surface/SaveBar'
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
import { RadioGroup } from '@/lib/components/ui/radio-group'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'

import { MovingDate } from './MovingDate'
import { requestMovingFocus, takeMovingFocus } from './movingFocus'

const ALIAS_REQUIRED = 'Add this account as an alias on the new account first'

interface Props {
  actorId: string
  hasPassword: boolean
  currentHandle: string
  cooldownUntil: string | null
}

/**
 * Settings › Moving › Move to another account: the standing warning, the
 * move-or-redirect RadioCards, the new account and the password (or current
 * username), each with its own confirm dialog. The 30-day cooldown keeps the
 * action off until it lifts.
 */
export const MoveForm: FC<Props> = ({
  actorId,
  hasPassword,
  currentHandle,
  cooldownUntil: initialCooldownUntil
}) => {
  const router = useRouter()
  const [kind, setKind] = useState<AccountMigrationKind>('move')
  const [acct, setAcct] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actorChanged, setActorChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(initialCooldownUntil)
  const warningRef = useRef<HTMLDivElement>(null)
  const { state: connection } = useConnectionStatus()
  const offline = connection !== 'online'

  // After a cancelled redirect the refreshed page brings this form back in
  // the notice's place: the notice left a focus request, so the standing
  // warning takes focus (and is read) instead of focus falling to the body.
  useEffect(() => {
    if (!takeMovingFocus('move-form')) return
    warningRef.current?.focus()
  }, [])

  const trimmedAcct = acct.trim().replace(/^@/, '')
  const dirty =
    trimmedAcct !== '' && (hasPassword ? password !== '' : username !== '')
  // The 30-day cooldown is the server's rule for a move only; a redirect has
  // no cooldown, so it stays available while a move waits.
  const moveCooldown = kind === 'move' && cooldownUntil !== null

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setActorChanged(false)
    setConfirmOpen(true)
  }

  const doMove = async () => {
    setSaving(true)
    setError(null)
    try {
      await moveAccount({
        actorId,
        acct: trimmedAcct,
        kind,
        ...(hasPassword ? { password } : { username: username.trim() })
      })
      // The page now shows the MovedNotice in this form's place.
      requestMovingFocus('moved-notice')
      router.refresh()
      setConfirmOpen(false)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 429) {
        // The 429 body carries cooldownUntil, but the error type does not
        // (yet): re-read the state, which does.
        try {
          const state = await getAccountMigration({ actorId })
          setCooldownUntil(state.cooldownUntil)
        } catch {
          setError(err.message)
        }
        setConfirmOpen(false)
      } else if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.message === 'Actor changed'
      ) {
        setActorChanged(true)
        setConfirmOpen(false)
      } else if (
        err instanceof ApiRequestError &&
        err.message === ALIAS_REQUIRED
      ) {
        setFieldError(
          `@${trimmedAcct} does not list @${currentHandle} as an old account yet. Add it there first, then try again.`
        )
        setConfirmOpen(false)
      } else if (
        err instanceof ApiRequestError &&
        (err.status === 404 || err.message === 'Invalid account')
      ) {
        // The migration route answers 404 "Record not found" for an account
        // it cannot resolve and 422 "Invalid account" for a malformed one;
        // both are a problem with the New account field, not the move.
        setFieldError(
          'We could not find that account. Check the handle and try again.'
        )
        setConfirmOpen(false)
      } else {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not start the move'
        )
        setConfirmOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div ref={warningRef} tabIndex={-1} className="outline-none">
        <Alert
          tone="warning"
          live={false}
          title="Followers move. Posts stay here."
        >
          Your followers will follow the new account. Your posts, photos and
          fitness files stay on this profile, which becomes read-only and shows
          &quot;moved&quot;.{' '}
          <Link href="/account/import-export" className="underline">
            Download your archive first
          </Link>
          , then import it into the new account.
        </Alert>
      </div>

      {actorChanged ? <ActorChangedAlert /> : null}

      <Frame
        form
        stickyFooter
        footer={
          <SaveBar
            actionLabel={kind === 'move' ? 'Move followers' : 'Show redirect'}
            actionIcon={ArrowRightLeft}
            idleNote={
              moveCooldown ? (
                <>
                  You can move again on <MovingDate at={cooldownUntil} />.
                </>
              ) : kind === 'move' ? (
                'You can move once every 30 days.'
              ) : (
                'No time limit. Cancel any time.'
              )
            }
            dirty={dirty}
            saving={saving}
            error={error}
            submit
            formId="move-form"
            disabled={moveCooldown}
            disabledReason={offline ? "You're offline" : undefined}
          />
        }
      >
        <FormRow label="What to do">
          {({ labelledBy }) => (
            <RadioGroup
              aria-labelledby={labelledBy}
              value={kind}
              onValueChange={(value) => {
                setKind(value as AccountMigrationKind)
                setFieldError(null)
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <RadioCard
                value="move"
                title="Move my followers"
                hint="Your followers are moved to the new account and your profile becomes read-only. This can't be undone, and you can't move again for 30 days."
              />
              <RadioCard
                value="redirect"
                title="Only show a redirect"
                hint="Your profile shows that you moved, but your followers stay. You can cancel the redirect any time."
              />
            </RadioGroup>
          )}
        </FormRow>

        {/* Only the fields that submit sit in the native form: the
              RadioCards stay out of it, so no hidden value-named radio
              inputs are drawn beside them (their accessible names are the
              card titles). */}
        <form id="move-form" method="post" onSubmit={openConfirm}>
          <FormRow
            label="New account"
            htmlFor="moveNewAccount"
            hint="The account you are moving to."
          >
            {({ describedBy }) => (
              <div className="space-y-2">
                <Input
                  id="moveNewAccount"
                  placeholder="@may@new.example"
                  aria-describedby={
                    [
                      describedBy,
                      fieldError ? 'moveNewAccount-error' : undefined
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  aria-invalid={fieldError ? true : undefined}
                  value={acct}
                  onChange={(e) => {
                    setAcct(e.target.value)
                    setFieldError(null)
                  }}
                />
                {fieldError ? (
                  <p
                    id="moveNewAccount-error"
                    role="alert"
                    className="text-destructive-text text-xs"
                  >
                    {fieldError}
                  </p>
                ) : null}
              </div>
            )}
          </FormRow>

          {hasPassword ? (
            <FormRow
              label="Password"
              htmlFor="movePassword"
              hint="Confirm it is you."
            >
              <Input
                type="password"
                id="movePassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </FormRow>
          ) : (
            <FormRow
              label="Current username"
              htmlFor="moveCurrentUsername"
              hint="Confirm it is you."
            >
              <Input
                id="moveCurrentUsername"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </FormRow>
          )}
        </form>
      </Frame>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {kind === 'move' ? 'Move your followers' : 'Show a redirect'}
            </DialogTitle>
            <DialogDescription>
              {kind === 'move' ? (
                <>
                  Your followers will be moved to{' '}
                  <strong>@{trimmedAcct}</strong>. This can&apos;t be undone,
                  and you can&apos;t move again for 30 days.
                </>
              ) : (
                <>
                  Your profile will show that you moved to{' '}
                  <strong>@{trimmedAcct}</strong>. Your followers stay. You can
                  cancel the redirect any time.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={doMove} disabled={saving}>
              {saving
                ? 'Working…'
                : kind === 'move'
                  ? 'Move followers'
                  : 'Show redirect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
