'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import {
  createHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  updateHostedBlueskyAccount
} from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Badge } from '@/lib/components/ui/badge'
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
import type { HostedBlueskyAccountState } from '@/lib/utils/blueskyHosted'

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'Something went wrong. Please try again.'

const handleItems = (state: HostedBlueskyAccountState) =>
  state.handleChoices.map((choice) => ({
    value: choice.handle,
    label: `@${choice.handle}`
  }))

export const HostedBlueskyForm = ({
  initialState,
  linked
}: {
  initialState: HostedBlueskyAccountState
  linked: boolean
}) => {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [handle, setHandle] = useState(
    initialState.handleChoices[0]?.handle ?? ''
  )
  const [editingHandle, setEditingHandle] = useState(false)
  const [handleDraft, setHandleDraft] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  // The recovery key change waiting on the current password: the key to add,
  // or null to remove it.
  const [recoveryChange, setRecoveryChange] = useState<{
    recoveryKeyDid: string | null
  } | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmHandle, setConfirmHandle] = useState('')
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => {
    setState(initialState)
  }, [initialState])

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const applyState = (next: HostedBlueskyAccountState) => {
    setState(next)
    router.refresh()
  }

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    void run('create', async () => {
      applyState(await createHostedBlueskyAccount(handle))
      setStatus('Bluesky account created.')
    })
  }

  const setActive = (active: boolean) =>
    void run('active', async () => {
      applyState(await updateHostedBlueskyAccount({ active }))
      setStatus(
        active ? 'Bluesky account turned on.' : 'Bluesky account turned off.'
      )
    })

  const startEditingHandle = () => {
    setEditingHandle(true)
    setHandleDraft(state.repo?.handle ?? state.handleChoices[0]?.handle ?? '')
    setError('')
  }

  const saveHandle = () =>
    void run('handle', async () => {
      applyState(await updateHostedBlueskyAccount({ handle: handleDraft }))
      setEditingHandle(false)
      setStatus('Handle changed.')
    })

  const closeRecovery = () => {
    setRecoveryChange(null)
    setCurrentPassword('')
    setRecoveryError('')
  }

  const submitRecovery = async () => {
    if (!recoveryChange) return
    const { recoveryKeyDid } = recoveryChange
    setBusy('recovery')
    setRecoveryError('')
    setStatus('')
    try {
      applyState(
        await updateHostedBlueskyAccount({ recoveryKeyDid, currentPassword })
      )
      closeRecovery()
      if (recoveryKeyDid) setRecoveryKey('')
      setStatus(
        recoveryKeyDid ? 'Recovery key added.' : 'Recovery key removed.'
      )
    } catch (error) {
      setRecoveryError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const closeDelete = () => {
    setConfirmDelete(false)
    setConfirmHandle('')
    setDeleteError('')
  }

  const submitDelete = async () => {
    setBusy('delete')
    setDeleteError('')
    try {
      applyState(await deleteHostedBlueskyAccount(confirmHandle))
      closeDelete()
      setStatus('Bluesky account deleted.')
    } catch (error) {
      setDeleteError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const repo = state.repo
  const statusLine = status ? (
    <p
      role="status"
      aria-live="polite"
      className="text-muted-foreground px-4 py-2.5 text-sm"
    >
      {status}
    </p>
  ) : null

  const notice = (text: string) => (
    <Frame form>
      <p className="text-muted-foreground px-4 py-2.5 text-sm">{text}</p>
    </Frame>
  )

  const deleteButton = (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="text-destructive-text h-auto px-0"
      disabled={busy !== null}
      onClick={() => setConfirmDelete(true)}
    >
      Delete account
    </Button>
  )

  const card = (() => {
    if (!repo) {
      if (!state.rotationKeyConfigured) {
        return notice(
          'This server isn’t ready to host Bluesky accounts yet. Ask an admin to set its rotation key.'
        )
      }
      if (linked) {
        return notice(
          'Your account above is on another server. Unlink it first to create one here; moving it here comes later.'
        )
      }
      return (
        <Frame form>
          <form onSubmit={submitCreate}>
            <FormRow label="Handle">
              {({ labelledBy }) => (
                <SegmentedControl
                  aria-labelledby={labelledBy}
                  items={handleItems(state)}
                  value={handle}
                  onValueChange={setHandle}
                  size="sm"
                />
              )}
            </FormRow>
            <FormRow label="Account">
              <Button type="submit" disabled={busy !== null || handle === ''}>
                {busy === 'create' ? 'Creating…' : 'Create Bluesky account'}
              </Button>
            </FormRow>
          </form>
          {statusLine}
        </Frame>
      )
    }

    if (repo.status === 'takendown') {
      return (
        <Frame form>
          <FormRow label="Status">
            <div className="space-y-1 text-sm">
              <Badge tone="warning">Suspended</Badge>
              <p className="text-muted-foreground">
                An admin has suspended this profile, so its Bluesky account is
                off.
              </p>
            </div>
          </FormRow>
          {statusLine}
        </Frame>
      )
    }

    const active = repo.status === 'active'

    return (
      <Frame form>
        <FormRow label="Status">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}
            {active ? (
              <code
                className="min-w-0 truncate font-mono text-xs"
                title={repo.did}
              >
                {repo.did}
              </code>
            ) : null}
          </div>
        </FormRow>
        {active ? (
          <FormRow label="Handle">
            {editingHandle ? (
              <div className="space-y-2">
                <SegmentedControl
                  aria-label="Handle"
                  items={handleItems(state)}
                  value={handleDraft}
                  onValueChange={setHandleDraft}
                  size="sm"
                />
                {state.customHandleAllowed ? (
                  <Input
                    aria-label="New handle"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={handleDraft}
                    onChange={(event) => setHandleDraft(event.target.value)}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null || handleDraft === ''}
                    onClick={saveHandle}
                  >
                    {busy === 'handle' ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setEditingHandle(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 break-all">@{repo.handle}</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={busy !== null}
                  onClick={startEditingHandle}
                >
                  Change
                </Button>
              </div>
            )}
          </FormRow>
        ) : null}
        {active ? (
          <FormRow label="Recovery key" hint="Keep it off this server">
            {repo.recoveryKeyDid ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <code className="min-w-0 break-all font-mono text-xs">
                  {repo.recoveryKeyDid}
                </code>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={busy !== null}
                  onClick={() => setRecoveryChange({ recoveryKeyDid: null })}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="Recovery key"
                  className="min-w-0 flex-1 basis-48 font-mono"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="did:key:z…"
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null || recoveryKey.trim() === ''}
                  onClick={() =>
                    setRecoveryChange({ recoveryKeyDid: recoveryKey.trim() })
                  }
                >
                  Add
                </Button>
              </div>
            )}
          </FormRow>
        ) : null}
        <FormRow label="Account">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setActive(!active)}
            >
              {busy === 'active'
                ? active
                  ? 'Turning off…'
                  : 'Turning on…'
                : active
                  ? 'Turn off'
                  : 'Turn on'}
            </Button>
            {deleteButton}
          </div>
        </FormRow>
        {statusLine}
      </Frame>
    )
  })()

  return (
    <div className="space-y-4">
      {error ? <Alert title={error} /> : null}
      {card}
      <Dialog
        open={recoveryChange !== null}
        onOpenChange={(next) => (next ? undefined : closeRecovery())}
      >
        <DialogContent
          showCloseButton={false}
          className="motion-reduce:animate-none"
        >
          <DialogHeader>
            <DialogTitle>
              {recoveryChange?.recoveryKeyDid
                ? 'Add this recovery key?'
                : 'Remove the recovery key?'}
            </DialogTitle>
            <DialogDescription>
              Whoever holds the recovery key can move this account to another
              server. Enter your current password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form
            id="hosted-bluesky-recovery-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitRecovery()
            }}
          >
            <FormRow
              stacked
              className="p-0"
              label="Current password"
              htmlFor="hosted-bluesky-current-password"
            >
              <Input
                id="hosted-bluesky-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </FormRow>
            {recoveryError ? <Alert title={recoveryError} /> : null}
          </form>
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={closeRecovery}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="hosted-bluesky-recovery-form"
              disabled={busy !== null || currentPassword === ''}
            >
              {busy === 'recovery'
                ? 'Saving…'
                : recoveryChange?.recoveryKeyDid
                  ? 'Add recovery key'
                  : 'Remove recovery key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => (next ? undefined : closeDelete())}
      >
        <DialogContent
          showCloseButton={false}
          className="motion-reduce:animate-none"
        >
          <DialogHeader>
            <DialogTitle>Delete this Bluesky account?</DialogTitle>
            <DialogDescription>
              This removes the account’s posts and its handle from this server.
              Type the handle to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormRow
              stacked
              className="p-0"
              label="Handle"
              htmlFor="hosted-bluesky-confirm-handle"
            >
              <Input
                id="hosted-bluesky-confirm-handle"
                autoCapitalize="none"
                spellCheck={false}
                value={confirmHandle}
                onChange={(event) => setConfirmHandle(event.target.value)}
              />
            </FormRow>
            {deleteError ? <Alert title={deleteError} /> : null}
          </div>
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={closeDelete}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void submitDelete()}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
