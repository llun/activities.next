'use client'

import { CircleUserRound, X } from 'lucide-react'
import { FC, useState } from 'react'

import {
  type AccountAliasItem,
  ApiRequestError,
  addAccountAlias,
  removeAccountAlias
} from '@/lib/client'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Alert } from '@/lib/components/surface/Alert'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Button } from '@/lib/components/ui/button'

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
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const atCap = aliases.length >= MAX_ALIASES

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const acct = normalizeAliasInput(value)
    if (!acct || adding || atCap) return
    setAdding(true)
    setFieldError(null)
    setError(null)
    try {
      setAliases(await addAccountAlias({ actorId, acct }))
      setValue('')
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setFieldError(
          'We could not find that account. Check the handle and try again.'
        )
      } else {
        setFieldError(
          err instanceof Error ? err.message : 'Could not add that account'
        )
      }
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    if (removingId !== null) return
    setRemovingId(id)
    setError(null)
    try {
      setAliases(await removeAccountAlias({ actorId, id }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not remove that account'
      )
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert title={error} /> : null}
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
                  onClick={() => remove(alias.id)}
                  disabled={removingId !== null}
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
          buttonDisabled={adding || atCap}
          onSubmit={add}
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
        </AddBar>
      </div>
    </div>
  )
}
