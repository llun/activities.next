'use client'

import { Check, Circle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import {
  cancelHostedBlueskyMoveOut,
  copyHostedBlueskyMoveOutBlobs,
  copyHostedBlueskyMoveOutPreferences,
  createHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  finishHostedBlueskyMoveOut,
  getHostedBlueskyMoveOut,
  sendHostedBlueskyMoveOutRepo,
  startHostedBlueskyMoveOut,
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

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

type CopyStep = 'repo' | 'blobs' | 'preferences'

interface CopyState {
  repo: boolean
  blobs: boolean
  preferences: boolean
  copied: number
  expected: number | null
  // Blobs the destination refused or this server could not read. They stay
  // missing unless the owner retries, so the switch warns about them.
  failed: number
  running: boolean
  error: string
  failedStep: CopyStep | null
}

const initialCopy: CopyState = {
  repo: false,
  blobs: false,
  preferences: false,
  copied: 0,
  expected: null,
  failed: 0,
  running: false,
  error: '',
  failedStep: null
}

// The server copies a few blobs per page; 4,000 pages is 20,000 blobs, past
// which the copy stops with an error rather than looping.
const MAX_BLOB_PAGES = 4000

const copyStepLabel: Record<CopyStep, string> = {
  repo: 'posts and follows',
  blobs: 'images and videos',
  preferences: 'settings'
}

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
  // The move to another server: the start form, the copy's progress, and the
  // switch's current-password dialog.
  const [moveFormOpen, setMoveFormOpen] = useState(false)
  const [movePdsUrl, setMovePdsUrl] = useState('')
  const [moveHandle, setMoveHandle] = useState('')
  const [moveEmail, setMoveEmail] = useState('')
  const [movePassword, setMovePassword] = useState('')
  const [moveCurrentPassword, setMoveCurrentPassword] = useState('')
  const [moveInviteCode, setMoveInviteCode] = useState('')
  const [copy, setCopy] = useState<CopyState>(initialCopy)
  const copyRef = useRef<CopyState>(initialCopy)
  const cursorRef = useRef<string | undefined>(undefined)
  const autoStartedRef = useRef(false)
  const moveErrorRef = useRef<HTMLDivElement>(null)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [switchPassword, setSwitchPassword] = useState('')
  const [switchError, setSwitchError] = useState('')
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
      // A moved copy has no handle here, so there is nothing to type back.
      applyState(
        await deleteHostedBlueskyAccount(
          state.movedTo !== null ? '' : confirmHandle
        )
      )
      closeDelete()
      setEditingHandle(false)
      setRecoveryKey('')
      setStatus('Bluesky account deleted.')
    } catch (error) {
      setDeleteError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const updateCopy = (patch: Partial<CopyState>) => {
    copyRef.current = { ...copyRef.current, ...patch }
    setCopy(copyRef.current)
  }

  // Reads the destination server's account status for the "x of y" counts. A
  // failure is ignored: the copy steps report their own errors.
  const loadProgress = async () => {
    try {
      const { progress } = await getHostedBlueskyMoveOut()
      if (!progress) return
      updateCopy({
        expected: progress.status.expectedBlobs,
        copied: progress.status.importedBlobs,
        repo: copyRef.current.repo || progress.importedRev !== null
      })
    } catch {
      // The progress read is optional; the copy loop still runs.
    }
  }

  // Runs the copy steps in order, skipping the ones already done, so "Try
  // again" resumes from the failed step and a reload repeats them safely.
  const runCopy = async () => {
    if (copyRef.current.running) return
    updateCopy({ running: true, error: '', failedStep: null })
    try {
      if (!copyRef.current.repo) {
        await sendHostedBlueskyMoveOutRepo()
        updateCopy({ repo: true })
        await loadProgress()
      }
      if (!copyRef.current.blobs) {
        let done = false
        let pages = 0
        while (!done) {
          if (pages >= MAX_BLOB_PAGES) {
            throw new Error(
              'Copying images and videos took too many steps. Try again.'
            )
          }
          const previousCursor = cursorRef.current
          const result = await copyHostedBlueskyMoveOutBlobs(
            cursorRef.current ? { cursor: cursorRef.current } : {}
          )
          pages += 1
          // Kept per page, so a resumed run after an error still knows them.
          updateCopy({ failed: copyRef.current.failed + result.failed.length })
          cursorRef.current = result.cursor ?? undefined
          done = result.done
          updateCopy({ copied: copyRef.current.copied + result.copied })
          // A server that keeps answering the same page must not loop forever;
          // a first page with no cursor and no end counts as the same page.
          if (!done && (result.cursor ?? undefined) === previousCursor) {
            throw new Error(
              'The destination server stopped making progress. Try again.'
            )
          }
        }
        // A batch that failed leaves blobs missing, so the step is not ticked;
        // the switch stays available and warns about what will be missing.
        if (copyRef.current.failed === 0) updateCopy({ blobs: true })
      }
      if (!copyRef.current.preferences) {
        await copyHostedBlueskyMoveOutPreferences()
        updateCopy({ preferences: true })
      }
      updateCopy({ running: false })
    } catch (error) {
      const failedStep: CopyStep = !copyRef.current.repo
        ? 'repo'
        : !copyRef.current.blobs
          ? 'blobs'
          : 'preferences'
      updateCopy({ running: false, error: errorMessage(error), failedStep })
    }
  }

  // Restarts the blob step from no cursor, so a retry re-lists every missing
  // blob rather than resuming a cursor the destination may have dropped.
  const retryBlobs = () => {
    cursorRef.current = undefined
    updateCopy({ failed: 0 })
    void runCopy()
  }

  const moveStage = state.moveOut?.stage ?? null
  useEffect(() => {
    if (moveStage === null) {
      autoStartedRef.current = false
      copyRef.current = initialCopy
      cursorRef.current = undefined
      setCopy(initialCopy)
      return
    }
    if (moveStage !== 'started' || autoStartedRef.current) return
    autoStartedRef.current = true
    void (async () => {
      await loadProgress()
      await runCopy()
    })()
  }, [moveStage])

  const submitStart = (event: FormEvent) => {
    event.preventDefault()
    void run('move-start', async () => {
      const result = await startHostedBlueskyMoveOut({
        pdsUrl: movePdsUrl.trim(),
        handle: moveHandle.trim(),
        email: moveEmail.trim(),
        password: movePassword,
        currentPassword: moveCurrentPassword,
        ...(moveInviteCode.trim() ? { inviteCode: moveInviteCode.trim() } : {})
      })
      setMovePassword('')
      setMoveCurrentPassword('')
      setMoveInviteCode('')
      setMoveFormOpen(false)
      applyState(result.state)
      setStatus('Move started.')
    })
  }

  const closeSwitch = () => {
    setSwitchOpen(false)
    setSwitchPassword('')
    setSwitchError('')
  }

  const submitSwitch = async () => {
    setBusy('switch')
    setSwitchError('')
    setStatus('')
    try {
      const result = await finishHostedBlueskyMoveOut(switchPassword)
      applyState(result.state)
      closeSwitch()
      setStatus(
        result.missingBlobs > 0
          ? `Moved to ${result.movedTo}. ${result.missingBlobs} ${result.missingBlobs === 1 ? 'image or video' : 'images or videos'} couldn't be copied.`
          : result.copyIncomplete
            ? `Moved to ${result.movedTo}. Some images, videos or settings may not have been copied.`
            : `Moved to ${result.movedTo}.`
      )
    } catch (error) {
      setSwitchError(errorMessage(error))
      // A failed finish may have switched the identity before failing, so read
      // the state back rather than leaving the panel on the old stage.
      try {
        const { state: next } = await getHostedBlueskyMoveOut()
        applyState(next)
      } catch {
        // The reload is best effort; the error above already says what failed.
      }
    } finally {
      setBusy(null)
    }
  }

  const cancelMove = () =>
    void run('cancel-move', async () => {
      const result = await cancelHostedBlueskyMoveOut()
      applyState(result.state)
      setStatus('Move cancelled.')
    })

  const repo = state.repo
  // The server stopped offering accounts to this profile (allowlist, domain
  // switched off), but the profile still has one: it may only turn it off or
  // delete it.
  const limited = !state.available
  const moved = state.movedTo !== null
  const moving = state.moveOut !== null
  const moveHost = state.moveOut ? hostOf(state.moveOut.pdsUrl) : null

  // The start-move error sits above the form; bring it into view when it lands
  // so the owner sees why the button did nothing.
  useEffect(() => {
    if (moveFormOpen && !moving && !moved && error) {
      moveErrorRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [error, moveFormOpen, moving, moved])

  const info = (title: string) => <Alert tone="info" title={title} />

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

  // The switch is offered once the repo and settings are copied and the media
  // is either copied or known to be missing (the dialog warns about those).
  const copyComplete =
    copy.repo && copy.preferences && (copy.blobs || copy.failed > 0)

  const copyChecklist = (
    <ul className="space-y-1.5 text-sm">
      <li className="flex items-center gap-2">
        <Check
          className="text-success-text size-4 shrink-0"
          aria-hidden="true"
        />
        <span>Account created on {moveHost}</span>
      </li>
      <li className="flex items-center gap-2">
        {copy.repo ? (
          <Check
            className="text-success-text size-4 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <Circle
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        )}
        <span>Posts and follows</span>
      </li>
      <li className="flex items-center gap-2">
        {copy.blobs ? (
          <Check
            className="text-success-text size-4 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <Circle
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        )}
        <span>
          Images and videos:{' '}
          {copy.expected !== null && copy.expected > 0
            ? `${copy.copied} of ${copy.expected} copied`
            : `${copy.copied} copied`}
        </span>
      </li>
      <li className="flex items-center gap-2">
        {copy.preferences ? (
          <Check
            className="text-success-text size-4 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <Circle
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        )}
        <span>Settings</span>
      </li>
    </ul>
  )

  const card = (() => {
    if (!repo) {
      if (limited) return null
      if (!state.rotationKeyConfigured) {
        return info(
          'This server isn’t ready to host Bluesky accounts yet. Ask an admin to set its rotation key.'
        )
      }
      if (linked) {
        return info(
          'Your account above is on another server. Unlink it first to create one here; moving it here comes later.'
        )
      }
      if (state.handleChoices.length === 0) {
        return info(
          'Your username can’t be used as a Bluesky handle, so this server can’t offer you one yet.'
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
        </Frame>
      )
    }

    const active = repo.status === 'active'
    // Handle and recovery key changes need the server's offer, and are off
    // while the account is being handed to another server.
    const editable = active && !limited && !moving && !moved

    return (
      <>
        {limited
          ? info(
              'This server no longer offers Bluesky accounts to this profile. You can still turn yours off, move it to another server, or delete it.'
            )
          : null}
        {moved && !moving
          ? info(
              `This account now lives on ${state.movedTo}. Link it again under “Your Bluesky account” to keep posting from here.`
            )
          : null}
        <Frame form>
          <FormRow label="Status">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              {active ? (
                <Badge tone="success">Active</Badge>
              ) : (
                <Badge>Off</Badge>
              )}
              {moved ? (
                <Badge tone="warning">Moved to {state.movedTo}</Badge>
              ) : null}
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
          {editable ? (
            <FormRow label="Handle">
              {({ labelledBy }) =>
                editingHandle ? (
                  <div className="space-y-2">
                    <SegmentedControl
                      aria-labelledby={labelledBy}
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
                )
              }
            </FormRow>
          ) : null}
          {editable ? (
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
              {moved && !moving ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete the copy left here
                </Button>
              ) : moving ? (
                <span className="text-sm text-muted-foreground">
                  Moving to {moveHost}
                </span>
              ) : (
                <>
                  {active || !limited ? (
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
                  ) : null}
                  {active ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setMoveFormOpen(true)}
                    >
                      Move to another server
                    </Button>
                  ) : null}
                  {deleteButton}
                </>
              )}
            </div>
          </FormRow>
        </Frame>
        {moving && state.moveOut ? (
          <>
            {copy.error ? (
              <Alert
                title={copy.error}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={copy.running}
                    onClick={() => void runCopy()}
                  >
                    Try again
                  </Button>
                }
              >
                {copy.failedStep
                  ? `Stopped while copying ${copyStepLabel[copy.failedStep]}.`
                  : null}
              </Alert>
            ) : null}
            {copy.failed > 0 ? (
              <Alert
                tone="warning"
                title={`${copy.failed} ${copy.failed === 1 ? 'image or video' : 'images or videos'} couldn't be copied to ${moveHost}.`}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={copy.running}
                    onClick={retryBlobs}
                  >
                    Try again
                  </Button>
                }
              >
                You can still switch; those files will be missing on {moveHost}.
              </Alert>
            ) : null}
            <Frame form>
              {state.moveOut.stage === 'started' ? (
                <>
                  <FormRow label="Progress">{copyChecklist}</FormRow>
                  <FormRow label="Account">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {copyComplete ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setSwitchOpen(true)}
                          >
                            Switch to {moveHost}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy !== null || copy.running}
                          onClick={cancelMove}
                        >
                          {busy === 'cancel-move'
                            ? 'Cancelling…'
                            : 'Cancel the move'}
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {`Cancelling leaves the switched-off account on ${moveHost}; delete it there if you want.`}
                      </p>
                    </div>
                  </FormRow>
                </>
              ) : (
                <>
                  <FormRow label="Status">
                    <p className="text-sm">
                      The account has switched to {moveHost}. Finish the move to
                      turn it on there.
                    </p>
                  </FormRow>
                  <FormRow label="Account">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setSwitchOpen(true)}
                    >
                      Finish the move
                    </Button>
                  </FormRow>
                </>
              )}
            </Frame>
          </>
        ) : null}
        {moveFormOpen && !moving && !moved && error ? (
          // scroll-mt clears the sticky page header the alert scrolls under.
          <div ref={moveErrorRef} className="scroll-mt-20">
            <Alert title={error} />
          </div>
        ) : null}
        {moveFormOpen && !moving && !moved ? (
          <Frame form>
            <form onSubmit={submitStart}>
              <FormRow
                label="New server"
                htmlFor="hosted-bluesky-move-server"
                hint="The https address of the server you are moving to."
              >
                <Input
                  id="hosted-bluesky-move-server"
                  type="url"
                  placeholder="https://bsky.social"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={movePdsUrl}
                  onChange={(event) => setMovePdsUrl(event.target.value)}
                />
              </FormRow>
              <FormRow
                label="Handle there"
                htmlFor="hosted-bluesky-move-handle"
              >
                <Input
                  id="hosted-bluesky-move-handle"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={moveHandle}
                  onChange={(event) => setMoveHandle(event.target.value)}
                />
              </FormRow>
              <FormRow label="Email" htmlFor="hosted-bluesky-move-email">
                <Input
                  id="hosted-bluesky-move-email"
                  type="email"
                  autoComplete="email"
                  value={moveEmail}
                  onChange={(event) => setMoveEmail(event.target.value)}
                />
              </FormRow>
              <FormRow
                label="Password there"
                htmlFor="hosted-bluesky-move-password"
                hint="Sent to that server once, never stored"
              >
                <Input
                  id="hosted-bluesky-move-password"
                  type="password"
                  autoComplete="new-password"
                  value={movePassword}
                  onChange={(event) => setMovePassword(event.target.value)}
                />
              </FormRow>
              <FormRow
                label="Your password here"
                htmlFor="hosted-bluesky-move-current-password"
                hint="The password you sign in to this site with"
              >
                <Input
                  id="hosted-bluesky-move-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={moveCurrentPassword}
                  onChange={(event) =>
                    setMoveCurrentPassword(event.target.value)
                  }
                />
              </FormRow>
              <FormRow
                label="Invite code"
                htmlFor="hosted-bluesky-move-invite"
                hint="If the server asks for one"
              >
                <Input
                  id="hosted-bluesky-move-invite"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={moveInviteCode}
                  onChange={(event) => setMoveInviteCode(event.target.value)}
                />
              </FormRow>
              <FormRow label="Account">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    disabled={
                      busy !== null ||
                      movePdsUrl.trim() === '' ||
                      moveHandle.trim() === '' ||
                      moveEmail.trim() === '' ||
                      movePassword === '' ||
                      moveCurrentPassword === ''
                    }
                  >
                    {busy === 'move-start' ? 'Starting…' : 'Start the move'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => setMoveFormOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </FormRow>
            </form>
          </Frame>
        ) : null}
      </>
    )
  })()

  return (
    <div className="space-y-4">
      {status && !error ? <Alert tone="success" title={status} /> : null}
      {error && !(moveFormOpen && !moving && !moved) ? (
        <Alert title={error} />
      ) : null}
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
        open={switchOpen}
        onOpenChange={(next) => (next ? undefined : closeSwitch())}
      >
        <DialogContent
          showCloseButton={false}
          className="motion-reduce:animate-none"
        >
          <DialogHeader>
            <DialogTitle>
              {moveStage === 'switched'
                ? 'Finish the move?'
                : `Switch to ${moveHost}?`}
            </DialogTitle>
            <DialogDescription>
              After this, only {moveHost} can change your Bluesky identity. Your
              recovery key stays. Enter your current password to confirm.
              {copy.failed > 0
                ? ` ${copy.failed} ${copy.failed === 1 ? 'image or video' : 'images or videos'} will be missing on ${moveHost}.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <form
            id="hosted-bluesky-switch-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitSwitch()
            }}
          >
            <FormRow
              stacked
              className="p-0"
              label="Current password"
              htmlFor="hosted-bluesky-switch-password"
            >
              <Input
                id="hosted-bluesky-switch-password"
                type="password"
                autoComplete="current-password"
                value={switchPassword}
                onChange={(event) => setSwitchPassword(event.target.value)}
              />
            </FormRow>
            {switchError ? <Alert title={switchError} /> : null}
          </form>
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={closeSwitch}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="hosted-bluesky-switch-form"
              disabled={busy !== null || switchPassword === ''}
            >
              {busy === 'switch'
                ? 'Switching…'
                : moveStage === 'switched'
                  ? 'Finish the move'
                  : `Switch to ${moveHost}`}
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
            <DialogTitle>
              {moved
                ? 'Delete the copy left here?'
                : 'Delete this Bluesky account?'}
            </DialogTitle>
            <DialogDescription>
              {moved
                ? `This removes the old copy of the posts from this server. The account on ${state.movedTo} is not affected.`
                : 'This removes the account’s posts and its handle from this server. Type the handle to confirm.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {moved ? null : (
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
            )}
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
              {busy === 'delete'
                ? 'Deleting…'
                : moved
                  ? 'Delete the copy'
                  : 'Delete account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
