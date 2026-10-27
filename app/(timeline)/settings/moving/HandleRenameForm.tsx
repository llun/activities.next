'use client'

import { AtSign, Check, Clock, Info } from 'lucide-react'
import { FC, useState } from 'react'

import {
  type AccountHandleState,
  ApiRequestError,
  getAccountHandle,
  renameAccountHandle
} from '@/lib/client'
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
  const [handle, setHandle] = useState(initialHandle)
  const [username, setUsername] = useState('')
  const [domain, setDomain] = useState(initialHandle.domain)
  const [password, setPassword] = useState('')
  const [currentUsername, setCurrentUsername] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { state: connection } = useConnectionStatus()
  const offline = connection !== 'online'

  const cooldownUntil = handle.cooldownUntil
  const lastChanged = lastChangedAt(handle)
  const trimmedUsername = username.trim()
  const previewUsername = trimmedUsername || handle.username
  const changed =
    trimmedUsername !== '' &&
    (trimmedUsername !== handle.username || domain !== handle.domain)
  const dirty =
    changed && (hasPassword ? password !== '' : currentUsername !== '')

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    setSaved(false)
    setFieldError(null)
  }

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConfirmOpen(true)
  }

  const doRename = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await renameAccountHandle({
        actorId,
        username: trimmedUsername,
        ...(handle.domains.length > 1 ? { domain } : null),
        ...(hasPassword
          ? { password }
          : { currentUsername: currentUsername.trim() })
      })
      setHandle(next)
      setSaved(true)
      setUsername('')
      setPassword('')
      setCurrentUsername('')
      setConfirmOpen(false)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 429) {
        // The 429 body carries cooldownUntil, but the error type does not
        // (yet): re-read the state, which does.
        try {
          setHandle(await getAccountHandle({ actorId }))
        } catch {
          setError(err.message)
        }
      } else if (
        err instanceof ApiRequestError &&
        err.message === 'Username already exists'
      ) {
        setFieldError('That username is taken')
        setConfirmOpen(false)
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not change your handle'
        )
        setConfirmOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  if (cooldownUntil !== null) {
    return (
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
    )
  }

  return (
    <>
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
                        onChange={(e) => {
                          setDomain(e.target.value)
                          setSaved(false)
                        }}
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
              <Input
                type="password"
                id="handlePassword"
                value={password}
                onChange={(e) => edit(setPassword)(e.target.value)}
                autoComplete="current-password"
              />
            </FormRow>
          ) : (
            <FormRow
              label="Current username"
              htmlFor="handleCurrentUsername"
              hint="Confirm it is you."
            >
              <Input
                id="handleCurrentUsername"
                value={currentUsername}
                onChange={(e) => edit(setCurrentUsername)(e.target.value)}
                autoComplete="username"
              />
            </FormRow>
          )}
        </Frame>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
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
