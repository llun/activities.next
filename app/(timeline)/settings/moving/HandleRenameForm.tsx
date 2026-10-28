'use client'

import { AtSign, Check, Clock, Info } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'

import {
  type AccountHandleState,
  ApiRequestError,
  getAccountHandle,
  renameAccountHandle
} from '@/lib/client'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
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
import { Select } from '@/lib/components/ui/select'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { localUsernameSchema } from '@/lib/services/accounts/localUsername'

import { MovingDate } from './MovingDate'

interface Props {
  actorId: string
  hasPassword: boolean
  initialHandle: AccountHandleState
}

// The newest replaced ledger row is when the handle last changed; the current
// row (first, replacedAt null) is skipped.
const lastChangedAt = (handle: AccountHandleState): number | null =>
  handle.history.find((row) => row.replacedAt !== null)?.replacedAt ?? null

/**
 * Settings › Moving › Change your handle: the current handle, the new
 * username (and domain, when the account has more than one to pick from) with
 * a live preview, the password (or current username for a passwordless
 * account) and a confirm dialog before the rename is sent. The 30-day
 * cooldown replaces the form with the date it lifts.
 */
export const HandleRenameForm: FC<Props> = ({
  actorId,
  hasPassword,
  initialHandle
}) => {
  const router = useRouter()
  const [handle, setHandle] = useState(initialHandle)
  const [username, setUsername] = useState('')
  const [domain, setDomain] = useState(initialHandle.domain)
  const [password, setPassword] = useState('')
  const [currentUsername, setCurrentUsername] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actorChanged, setActorChanged] = useState(false)
  const [saved, setSaved] = useState(false)
  const [renamed, setRenamed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cooldownArrived, setCooldownArrived] = useState(false)
  const cooldownRef = useRef<HTMLDivElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const currentUsernameRef = useRef<HTMLInputElement>(null)
  const { state: connection } = useConnectionStatus()
  // Only the browser's own `offline` state disables the action: with
  // `unreachable` (the health probe failed while the device is online) the
  // rename keeps its own error path, like every other offline check.
  const offline = connection === 'offline'

  const cooldownUntil = handle.cooldownUntil

  // A rename always starts the cooldown, so its success answer (and a 429's
  // re-read state) carries cooldownUntil and swaps the form for the cooldown
  // Frame while the confirm dialog is open; closing the dialog would return
  // focus to a button that unmounts with the form, so the cooldown state
  // takes focus once it is there.
  useEffect(() => {
    if (!cooldownArrived) return
    setCooldownArrived(false)
    cooldownRef.current?.focus()
  }, [cooldownArrived])
  const lastChanged = lastChangedAt(handle)
  // The server parses the new username with `localUsernameSchema`, which
  // trims and lowercases before it checks anything, and stores what it
  // parsed: the form has to compare and preview the same value, or the
  // preview and the confirm can promise a handle the server never saves.
  const trimmedUsername = username.trim().toLowerCase()
  // A domain change alone is a change: the username the form sends is the new
  // one, or the current one when only the domain moved.
  const nextUsername = trimmedUsername || handle.username
  const previewUsername = nextUsername
  const changed = nextUsername !== handle.username || domain !== handle.domain
  const dirty =
    changed && (hasPassword ? password !== '' : currentUsername !== '')

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    setSaved(false)
    setFieldError(null)
    setChallengeError(null)
  }

  const failUsernameField = (message: string) => {
    setFieldError(message)
    usernameRef.current?.focus()
  }

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setActorChanged(false)
    // The same schema the rename route parses with, so a name the server
    // would refuse never reaches the confirm dialog: its own message is a
    // field error on New handle, not a raw "Invalid username" in the SaveBar.
    const parsed = localUsernameSchema.safeParse(nextUsername)
    if (!parsed.success) {
      failUsernameField(parsed.error.issues[0]?.message ?? 'Invalid username')
      return
    }
    // The server compares case-insensitively and answers "Nothing to
    // change" for the same name in another case: refuse it here, on the
    // field, instead of sending a rename that cannot succeed.
    if (parsed.data === handle.username && domain === handle.domain) {
      failUsernameField('That is already your handle')
      return
    }
    setConfirmOpen(true)
  }

  const doRename = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await renameAccountHandle({
        actorId,
        username: nextUsername,
        ...(handle.domains.length > 1 ? { domain } : null),
        ...(hasPassword
          ? { password }
          : { currentUsername: currentUsername.trim() })
      })
      setHandle(next)
      setSaved(true)
      setRenamed(true)
      setUsername('')
      setPassword('')
      setCurrentUsername('')
      setConfirmOpen(false)
      // The cooldown the rename started replaces the form with the cooldown
      // Frame, which takes focus (see the effect above).
      if (next.cooldownUntil !== null) setCooldownArrived(true)
      // The page's "These settings are for @handle" and the MoveForm's
      // currentHandle follow the rename, like MoveForm and MovedNotice do.
      router.refresh()
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 429) {
        // The 429 body carries cooldownUntil, but the error type does not
        // (yet): re-read the state, which does.
        try {
          const next = await getAccountHandle({ actorId })
          setHandle(next)
          if (next.cooldownUntil !== null) setCooldownArrived(true)
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
        err.message === 'Username already exists'
      ) {
        setFieldError('That username is taken')
        setConfirmOpen(false)
      } else if (
        err instanceof ApiRequestError &&
        !hasPassword &&
        err.status === 422 &&
        err.message === 'Invalid username'
      ) {
        // The new username is validated with the server's own schema before
        // the dialog opens, so on a passwordless account this refusal is the
        // challenge: the Current username did not match. It is that field's
        // error, not the SaveBar's.
        setChallengeError('That is not your current username')
        setConfirmOpen(false)
      } else {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not change your handle'
        )
        setConfirmOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  if (cooldownUntil !== null) {
    return (
      <div ref={cooldownRef} tabIndex={-1} className="outline-none">
        <Frame
          form
          footer={
            <SaveBar
              actionLabel="Change handle"
              actionIcon={AtSign}
              idleNote={
                <>
                  You can change your handle again on{' '}
                  <MovingDate at={cooldownUntil} />.
                </>
              }
              disabled
            />
          }
        >
          {renamed ? (
            <p role="status" className="px-4 pt-2.5 text-sm">
              Your handle is now @{handle.acct}.
            </p>
          ) : null}
          <FormRow label="Current handle">
            <p className="text-sm break-words">@{handle.acct}</p>
          </FormRow>
          <FormRow label="Last changed">
            {lastChanged !== null ? (
              <MovingDate at={lastChanged} />
            ) : (
              <p className="text-sm">Never</p>
            )}
          </FormRow>
        </Frame>
      </div>
    )
  }

  return (
    <>
      {actorChanged ? <ActorChangedAlert /> : null}
      <form method="post" onSubmit={openConfirm}>
        <Frame
          form
          stickyFooter
          footer={
            <SaveBar
              actionLabel="Change handle"
              actionIcon={AtSign}
              idleNote={
                lastChanged !== null ? (
                  <>
                    Last changed: <MovingDate at={lastChanged} />.
                  </>
                ) : (
                  'Last changed: never.'
                )
              }
              dirty={dirty}
              saving={saving}
              saved={saved}
              error={error}
              submit
              disabledReason={offline ? "You're offline" : undefined}
            />
          }
        >
          <FormRow label="Current handle">
            <p className="text-sm break-words">@{handle.acct}</p>
          </FormRow>

          <FormRow
            label="New handle"
            htmlFor="newHandleUsername"
            hint="Pick a username and one of the domains your account can use."
          >
            {({ describedBy }) => (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm"
                    >
                      @
                    </span>
                    <Input
                      id="newHandleUsername"
                      ref={usernameRef}
                      className="pl-7"
                      aria-describedby={
                        [
                          describedBy,
                          fieldError ? 'newHandleUsername-error' : undefined
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      aria-invalid={fieldError ? true : undefined}
                      value={username}
                      onChange={(e) => edit(setUsername)(e.target.value)}
                    />
                  </div>
                  {handle.domains.length > 1 ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground text-sm"
                      >
                        @
                      </span>
                      <Select
                        aria-label="Domain"
                        className="w-full sm:w-56"
                        value={domain}
                        onChange={(e) => edit(setDomain)(e.target.value)}
                      >
                        {handle.domains.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}
                </div>
                {fieldError ? (
                  <p
                    id="newHandleUsername-error"
                    role="alert"
                    className="text-destructive-text text-xs"
                  >
                    {fieldError}
                  </p>
                ) : null}
              </div>
            )}
          </FormRow>

          <FormRow label="Preview">
            <div>
              <p className="text-muted-foreground text-xs">Your new handle</p>
              <p className="text-sm font-medium break-words">
                @{previewUsername}@{domain}
              </p>
            </div>
          </FormRow>

          <FormRow label="What happens">
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="text-success-text mt-0.5 size-4 shrink-0"
                />
                <span>
                  Your posts, followers and replies stay exactly as they are.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="text-success-text mt-0.5 size-4 shrink-0"
                />
                <span>
                  <strong>@{handle.acct}</strong> keeps pointing to you, and
                  nobody else can ever take it.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Clock
                  aria-hidden="true"
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
                <span>You can change your handle once every 30 days.</span>
              </li>
              <li className="flex items-start gap-2">
                <Info
                  aria-hidden="true"
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
                <span>
                  Some servers (Misskey, Sharkey and older Mastodon) may show
                  your old handle for a while.
                </span>
              </li>
            </ul>
          </FormRow>

          {hasPassword ? (
            <FormRow
              label="Password"
              htmlFor="handlePassword"
              hint="Confirm it is you."
            >
              {({ describedBy }) => (
                <Input
                  type="password"
                  id="handlePassword"
                  aria-describedby={describedBy}
                  value={password}
                  onChange={(e) => edit(setPassword)(e.target.value)}
                  autoComplete="current-password"
                />
              )}
            </FormRow>
          ) : (
            <FormRow
              label="Current username"
              htmlFor="handleCurrentUsername"
              hint="Confirm it is you."
            >
              {({ describedBy }) => (
                <div className="space-y-2">
                  <Input
                    id="handleCurrentUsername"
                    ref={currentUsernameRef}
                    aria-describedby={
                      [
                        describedBy,
                        challengeError
                          ? 'handleCurrentUsername-error'
                          : undefined
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    aria-invalid={challengeError ? true : undefined}
                    value={currentUsername}
                    onChange={(e) => edit(setCurrentUsername)(e.target.value)}
                    autoComplete="username"
                  />
                  {challengeError ? (
                    <p
                      id="handleCurrentUsername-error"
                      role="alert"
                      className="text-destructive-text text-xs"
                    >
                      {challengeError}
                    </p>
                  ) : null}
                </div>
              )}
            </FormRow>
          )}
        </Frame>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={(event) => {
            // A field error closes the dialog with the invalid input waiting:
            // closing would otherwise return focus to the SaveBar button that
            // opened it, and the error is on the input, not the button.
            if (fieldError) {
              event.preventDefault()
              usernameRef.current?.focus()
              return
            }
            if (challengeError) {
              event.preventDefault()
              currentUsernameRef.current?.focus()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Change your handle</DialogTitle>
            <DialogDescription>
              Your new handle will be{' '}
              <strong>
                @{previewUsername}@{domain}
              </strong>
              . Your posts, followers and replies stay exactly as they are.
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
            <Button type="button" onClick={doRename} disabled={saving}>
              {saving ? 'Changing…' : 'Change handle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
