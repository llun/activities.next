'use client'

import { CircleUserRound, X } from 'lucide-react'
import { FC, useRef, useState } from 'react'

import {
  type AccountAliasItem,
  ApiRequestError,
  addAccountAlias,
  removeAccountAlias
} from '@/lib/client'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Alert } from '@/lib/components/surface/Alert'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Button } from '@/lib/components/ui/button'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'

const MAX_ALIASES = 10

// "@you@old.server " → "you@old.server": trimmed, with one leading @ taken
// off. The server folds case and resolves the handle itself.
export const normalizeAliasInput = (value: string): string =>
  value.trim().replace(/^@/, '')

interface Props {
  actorId: string
  initialAliases: AccountAliasItem[]
}

/**
 * Settings › Moving › Moving from another account: the old accounts
 * (aliases) another server needs before it lets you move, with a no-confirm
 * Remove on each row and an AddBar capped at ten.
 */
export const AliasesSection: FC<Props> = ({ actorId, initialAliases }) => {
  const [aliases, setAliases] = useState(initialAliases)
  const [value, setValue] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actorChanged, setActorChanged] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const { state: connection } = useConnectionStatus()
  // Only the browser's own `offline` state disables the actions: with
  // `unreachable` (the health probe failed while the device is online) each
  // keeps its own error path, like every other offline check.
  const offline = connection === 'offline'
  const inputRef = useRef<HTMLInputElement>(null)

  const atCap = aliases.length >= MAX_ALIASES

  // A field error moves focus to the invalid input so its described error is
  // read; the Add button keeps focus otherwise.
  const failField = (message: string) => {
    setFieldError(message)
    inputRef.current?.focus()
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const acct = normalizeAliasInput(value)
    if (!acct || adding || atCap || offline) return
    setAdding(true)
    setFieldError(null)
    setError(null)
    setActorChanged(false)
    try {
      setAliases(await addAccountAlias({ actorId, acct }))
      setValue('')
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        failField(
          'We could not find that account. Check the handle and try again.'
        )
      } else if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.message === 'Actor changed'
      ) {
        setActorChanged(true)
      } else if (err instanceof TypeError) {
        // A network failure is the browser's own text ("Failed to fetch",
        // "Load failed"): the plain message stands in for it.
        failField('Could not add that account')
      } else {
        failField(
          err instanceof Error ? err.message : 'Could not add that account'
        )
      }
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    if (removingId !== null || offline) return
    setRemovingId(id)
    setError(null)
    setActorChanged(false)
    try {
      setAliases(await removeAccountAlias({ actorId, id }))
      // The pressed Remove button unmounted with its row, and the browser
      // has already dropped focus to the body. The alias input is the next
      // useful control whether or not rows are left.
      inputRef.current?.focus()
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.message === 'Actor changed'
      ) {
        setActorChanged(true)
      } else if (err instanceof TypeError) {
        // A network failure is the browser's own text ("Failed to fetch",
        // "Load failed"): the plain message stands in for it.
        setError('Could not remove that account')
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not remove that account'
        )
      }
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert title={error} /> : null}
      {actorChanged ? <ActorChangedAlert /> : null}
      <FramedList aria-label="Old accounts">
        {aliases.length === 0 ? (
          <FramedListItem>
            <p className="text-sm font-semibold">No old accounts yet</p>
            <p className="text-muted-foreground text-sm">
              Add the handle you are moving from.
            </p>
          </FramedListItem>
        ) : (
          aliases.map((alias) => (
            <FramedListItem key={alias.id}>
              <div className="flex items-center gap-3">
                <CircleUserRound
                  aria-hidden="true"
                  className="text-muted-foreground size-[18px] shrink-0"
                />
                <p className="text-sm font-medium min-w-0 flex-1 break-words">
                  {alias.acct ? `@${alias.acct}` : alias.id}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="remove-alias"
                  // The row says which account it is; the button's name has
                  // to as well, or every row's control reads the same.
                  aria-label={`Remove ${
                    alias.acct ? `@${alias.acct}` : alias.id
                  }`}
                  onClick={() => remove(alias.id)}
                  disabled={removingId !== null || offline}
                >
                  <X aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </FramedListItem>
          ))
        )}
      </FramedList>
      <div data-testid="aliases-form">
        <AddBar
          label="Old account"
          hint="Do this first, then start the move on the old server (in Mastodon: Preferences, Account, Moving from a different account)."
          error={fieldError}
          buttonDisabled={adding || atCap || offline}
          onSubmit={add}
          inputRef={inputRef}
          inputProps={{
            name: 'alias',
            placeholder: '@you@old.server',
            value,
            onChange: (e) => {
              setValue(e.target.value)
              setFieldError(null)
            }
          }}
        >
          {atCap ? (
            <p className="text-muted-foreground mt-2 text-xs">
              You can add up to {MAX_ALIASES} old accounts.
            </p>
          ) : null}
          {offline ? (
            <p className="text-muted-foreground mt-2 text-xs">
              You&apos;re offline
            </p>
          ) : null}
        </AddBar>
      </div>
    </div>
  )
}
