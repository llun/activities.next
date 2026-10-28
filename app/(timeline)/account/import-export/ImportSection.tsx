'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type {
  AccountImportOptions,
  AccountImportResponse
} from '@/lib/client/accountImports'
import {
  cancelAccountImport,
  getAccountImport,
  listAccountImports,
  startAccountImport
} from '@/lib/client/accountImports'
import { ApiRequestError } from '@/lib/client/http'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import { formatBytes } from '@/lib/utils/formatBytes'

import { ArchiveImportForm } from './ArchiveImportForm'
import { CsvImportForm } from './CsvImportForm'
import { ImportProgress } from './ImportProgress'
import { ImportReport } from './ImportReport'
import { useImportPolling } from './useImportPolling'

interface Props {
  actorId: string
  handle: string
  currentTime: number
  initialImport: AccountImportResponse | null
  maxImportBytes: number
  maxCsvBytes: number
}

interface SelectionError {
  title: string
  message: string
}

type StartAlert =
  | { type: 'upload' }
  | { type: 'unreadable' }
  | { type: 'too-large' }
  | { type: 'discard'; id: string }
  | { type: 'rate-limit'; retryAt: number | null }
  | { type: 'generic'; message: string }
  | null

const INITIAL_OPTIONS: AccountImportOptions = {
  likes: false,
  bookmarks: false,
  repliesToOthers: 'skip',
  profile: false,
  settings: false
}

// A queued row that was never started is an upload waiting for its start, not
// an import in progress: nothing will ever move it, so it is offered back to
// the user (start it or discard it) instead of being polled as progress.
const isUploadedNotStarted = (accountImport: AccountImportResponse | null) =>
  accountImport !== null &&
  accountImport.status === 'queued' &&
  accountImport.startedAt === null

const isActiveImport = (accountImport: AccountImportResponse | null) =>
  accountImport !== null &&
  (accountImport.status === 'running' ||
    (accountImport.status === 'queued' && accountImport.startedAt !== null))

const isActorChanged = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 409 &&
  error.message === 'Actor changed'

const isMoved = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 422 &&
  error.message === 'This account has moved'

// The only start failures that cancel the stored upload: the file behind the
// row can never start, so the row is dead weight. Every other failure leaves
// the queued upload alone (see the cancel rule on startQueuedImport).
const isUnreadableStart = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 422 &&
  error.message === 'Archive format is not recognised'

const isUploadLostStart = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 409 &&
  (error.message === 'Upload is incomplete; upload it again' ||
    error.message === 'Archive changed; upload it again')

// The server deletes the stored file before answering 413, so the row can
// never start, exactly like an unreadable or lost upload.
const isTooLargeStart = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 413

const isAlreadyFinished = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 409 &&
  error.message === 'Import is already finished'

const cancelBestEffort = (actorId: string, id: string) =>
  cancelAccountImport({ actorId, id }).catch(() => undefined)

// `useLayoutEffect` warns when React renders on the server, and this section
// does: the focus hand-off must run before the browser paints, but only in
// the browser.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

export const ImportSection = ({
  actorId,
  handle,
  currentTime,
  initialImport,
  maxImportBytes,
  maxCsvBytes
}: Props) => {
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState(INITIAL_OPTIONS)
  const [selectionError, setSelectionError] = useState<SelectionError | null>(
    null
  )
  const [actorChangedLocally, setActorChangedLocally] = useState(false)
  const [moved, setMoved] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  // Set for the report that appears because the user just cancelled, so it
  // takes the focus the closing dialog leaves on a button that unmounts.
  const [focusReport, setFocusReport] = useState(false)
  // Same for the progress that appears because the user just started an
  // import: the form (and with it the focused button) unmounts.
  const [focusProgress, setFocusProgress] = useState(false)
  // The start or discard of the earlier upload, which the section owns: it
  // must lock the warning's buttons and the form even when the form that
  // uploaded the row has been swapped for the CSV form.
  const [startInFlight, setStartInFlight] = useState(false)
  const [startAlert, setStartAlert] = useState<StartAlert>(null)
  const [clock, setClock] = useState(currentTime)
  const hasHydrated = useHasHydrated()
  const isOffline = useConnectionStatus().state === 'offline'
  // The warning that held the focused Discard button unmounts on a
  // successful Discard, so the file picker must take the focus. It cannot
  // do that inside the handler: the picker is disabled while the start
  // lock is held, and a disabled button is not focusable. The effect runs
  // on the commit that releases the lock.
  const focusPickerAfterDiscard = useRef(false)
  const filePickerRef = useRef<HTMLButtonElement>(null)
  const archiveFormRef = useRef<HTMLFormElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  // Whether the previous render showed an active import, so the poll that
  // ends one is recognised (see the layout effect below).
  const wasActiveImport = useRef(false)
  const {
    accountImport,
    setAccountImport,
    actorChanged: actorChangedWhilePolling
  } = useImportPolling({ actorId, initialImport })
  const actorChanged = actorChangedLocally || actorChangedWhilePolling
  const notStartedImport = isUploadedNotStarted(accountImport)
    ? accountImport
    : null

  useEffect(() => {
    if (hasHydrated) setClock(Date.now())
  }, [hasHydrated])

  useEffect(() => {
    if (!focusPickerAfterDiscard.current || startInFlight) return
    focusPickerAfterDiscard.current = false
    filePickerRef.current?.focus()
  }, [startInFlight])

  // When the poll ends an import the user started, the progress view
  // unmounts with the focus inside it, so the focus falls to the body and
  // the report that replaces it is never announced. The report must take
  // the focus itself — but only when the progress view had it: focus
  // elsewhere on the page (the export section, say) is left alone.
  useIsomorphicLayoutEffect(() => {
    const active = Boolean(accountImport && isActiveImport(accountImport))
    if (wasActiveImport.current && !active && accountImport) {
      const focused = document.activeElement
      if (focused === document.body || progressRef.current?.contains(focused)) {
        setFocusReport(true)
      }
    }
    wasActiveImport.current = active
  }, [accountImport])

  const onFileChange = (selected: File | null) => {
    setSelectionError(null)
    setStartAlert(null)
    setOptions(INITIAL_OPTIONS)
    if (!selected) {
      setFile(null)
      return
    }
    const filename = selected.name.toLowerCase()
    const maxBytes = filename.endsWith('.csv') ? maxCsvBytes : maxImportBytes
    if (!filename.endsWith('.zip') && !filename.endsWith('.csv')) {
      setFile(null)
      setSelectionError({
        title: 'We could not read this file',
        message:
          'Choose an activities.next archive, a Mastodon archive (.zip) or a Mastodon CSV file.'
      })
      return
    }
    if (selected.size === 0) {
      setFile(null)
      setSelectionError({ title: 'The file is empty', message: '' })
      return
    }
    if (selected.size > maxBytes) {
      setFile(null)
      setSelectionError({
        title: 'File is too large',
        message: `Choose a file no larger than ${formatBytes(maxBytes)}.`
      })
      return
    }
    setFile(selected)
  }

  const showImport = (shown: AccountImportResponse) => {
    setAccountImport(shown)
    // The failure to cancel belongs to the import it happened on, never to
    // whatever import is shown next.
    setCancelError(false)
    setFocusReport(false)
    setFocusProgress(true)
  }

  // Every start outcome that keeps the upload hands it to the polling state
  // the same way, so the "not started" warning owns the row from the start:
  // the row must stay visible whatever file is picked next — another archive
  // or a .csv, which swaps the form out from under it.
  const keepUpload = (uploaded: AccountImportResponse) => {
    if (uploaded.id !== notStartedImport?.id) showImport(uploaded)
  }

  const findActiveImport = async () => {
    const imports = await listAccountImports({ actorId }).catch(() => [])
    const activeImport = imports.find(
      (item) => item.status === 'queued' || item.status === 'running'
    )
    if (activeImport) showImport(activeImport)
    return Boolean(activeImport)
  }

  // The cancel rule: the client cancels an account import only when the user
  // presses Discard or Cancel, when the upload itself failed or was aborted,
  // or when the start answers that the stored file can never start (422
  // unrecognised, 409 upload incomplete or archive changed, 413 too large).
  // Everything else leaves the queued upload alone — a failed start, another
  // file, leaving the page or switching to CSV — so the row survives and the
  // page offers it back as the "not started" warning.
  const startQueuedImport = async (uploaded: AccountImportResponse) => {
    if (startInFlight) return
    setStartInFlight(true)
    setStartAlert(null)
    // A start that gives up on the upload cancels the row server-side, so it
    // must also drop it here: otherwise the "earlier upload" warning stays up
    // with a Start button that can only fail again, until the next poll
    // reports the row as cancelled.
    const discardUploaded = async () => {
      await cancelBestEffort(actorId, uploaded.id)
      if (notStartedImport?.id === uploaded.id) {
        setAccountImport(null)
        setCancelError(false)
      }
    }
    try {
      const started = await startAccountImport({
        actorId,
        importId: uploaded.id,
        options
      })
      showImport(started)
    } catch (error) {
      if (isActorChanged(error)) {
        setActorChangedLocally(true)
      } else if (isMoved(error)) {
        setMoved(true)
      } else if (error instanceof ApiRequestError && error.status === 429) {
        keepUpload(uploaded)
        setClock(Date.now())
        setStartAlert({
          type: 'rate-limit',
          retryAt:
            error.retryAfterMs === undefined
              ? null
              : Date.now() + error.retryAfterMs
        })
      } else if (isUnreadableStart(error)) {
        await discardUploaded()
        setStartAlert({ type: 'unreadable' })
      } else if (isUploadLostStart(error)) {
        // The stored file is broken, so the row is cancelled and the user
        // must upload again; the form's Import archive button (enabled
        // again once the row is dropped) is that retry.
        await discardUploaded()
        setStartAlert({ type: 'upload' })
      } else if (isTooLargeStart(error)) {
        await discardUploaded()
        setStartAlert({ type: 'too-large' })
      } else if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.message === 'An import is already active'
      ) {
        const found = await findActiveImport()
        if (!found) setStartAlert({ type: 'generic', message: error.message })
      } else if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.message === 'Import is not queued'
      ) {
        // The row has already started (another tab) or another import took
        // the slot: re-read it and show it. It is never this page's to cancel.
        try {
          showImport(await getAccountImport({ actorId, id: uploaded.id }))
        } catch {
          setStartAlert({
            type: 'generic',
            message: 'Could not start the import'
          })
        }
      } else {
        // 503, a network error, a 422 or 409 the rule does not name, a 500:
        // the upload stays queued, so keep it and let the owner try again.
        // Only a server message is worth showing: a browser network failure
        // rejects with a TypeError whose text ("Failed to fetch") says
        // nothing the title does not.
        keepUpload(uploaded)
        setStartAlert({
          type: 'generic',
          message: error instanceof ApiRequestError ? error.message : ''
        })
      }
    } finally {
      setStartInFlight(false)
    }
  }

  const handleDiscardUpload = async (id: string) => {
    if (startInFlight) return
    setStartInFlight(true)
    setStartAlert(null)
    try {
      await cancelAccountImport({ actorId, id })
      setAccountImport(null)
      setCancelError(false)
      focusPickerAfterDiscard.current = true
    } catch (error) {
      if (isActorChanged(error)) {
        setActorChangedLocally(true)
      } else if (isAlreadyFinished(error)) {
        // The 24 h sweep got there first: the row is gone either way.
        setAccountImport(null)
        setCancelError(false)
        focusPickerAfterDiscard.current = true
      } else {
        // The cancel the user asked for did not happen, so the row is
        // still queued: keep the warning and say what failed.
        setStartAlert({ type: 'discard', id })
      }
    } finally {
      setStartInFlight(false)
    }
  }

  const handleStartAgain = () => {
    setAccountImport(null)
    setFile(null)
    setSelectionError(null)
    setMoved(false)
    setCancelError(false)
    setStartAlert(null)
    setOptions(INITIAL_OPTIONS)
    setFocusReport(false)
    setFocusProgress(false)
  }

  const handleCancelImport = async () => {
    if (!accountImport || !isActiveImport(accountImport) || isOffline) return
    setCanceling(true)
    setCancelError(false)
    try {
      const cancelled = await cancelAccountImport({
        actorId,
        id: accountImport.id
      })
      try {
        setAccountImport(
          await getAccountImport({ actorId, id: accountImport.id })
        )
      } catch {
        setAccountImport(cancelled)
      }
      setFocusReport(true)
    } catch (error) {
      if (isActorChanged(error)) {
        setActorChangedLocally(true)
      } else {
        setCancelError(true)
      }
    } finally {
      setCanceling(false)
    }
  }

  const showForm =
    (!accountImport || notStartedImport !== null) && !actorChanged && !moved
  const showCsvForm = file?.name.toLowerCase().endsWith('.csv') ?? false
  const showWarning = notStartedImport !== null && !actorChanged && !moved
  const retryDescription =
    startAlert?.type === 'rate-limit'
      ? startAlert.retryAt === null
        ? 'Try again later.'
        : `You can try again ${
            hasHydrated
              ? formatDistance(new Date(startAlert.retryAt), new Date(clock), {
                  addSuffix: true
                })
              : 'later'
          }.`
      : null

  return (
    <Section
      title="Import"
      description="Bring in an archive or a list from activities.next or Mastodon."
    >
      <div className="space-y-4">
        <Alert tone="info" title={`Posts will be imported into ${handle}`}>
          Switch profile first if they belong somewhere else. Imported posts
          keep their original dates. They are not sent to your followers, and
          nobody is notified.
        </Alert>

        {selectionError ? (
          <Alert tone="error" title={selectionError.title}>
            {selectionError.message}
          </Alert>
        ) : null}
        {actorChanged ? <ActorChangedAlert /> : null}
        {moved ? <Alert tone="info" title="This account has moved" /> : null}

        {/* The warning lives here, above whichever form is shown, so that
            picking a .csv (which swaps the archive form for the CSV form)
            cannot hide the upload that is still waiting to be started. */}
        {showWarning && notStartedImport ? (
          <Alert
            tone="warning"
            title="An earlier upload was not started"
            action={
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={startInFlight || isOffline}
                  onClick={() => void startQueuedImport(notStartedImport)}
                >
                  Start import
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={startInFlight || isOffline}
                  onClick={() => void handleDiscardUpload(notStartedImport.id)}
                >
                  Discard
                </Button>
              </div>
            }
          />
        ) : null}
        {startAlert?.type === 'upload' ? (
          <Alert
            tone="error"
            title="The upload did not finish"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startInFlight || isOffline || !file}
                onClick={() => archiveFormRef.current?.requestSubmit()}
              >
                Try again
              </Button>
            }
          />
        ) : null}
        {startAlert?.type === 'unreadable' ? (
          <Alert tone="error" title="We could not read this file">
            Choose an activities.next archive, a Mastodon archive (.zip) or a
            Mastodon CSV file.
          </Alert>
        ) : null}
        {startAlert?.type === 'too-large' ? (
          <Alert tone="error" title="File is too large">
            Choose a file no larger than {formatBytes(maxImportBytes)}.
          </Alert>
        ) : null}
        {startAlert?.type === 'discard' ? (
          <Alert
            tone="error"
            title="Could not discard the upload"
            onRetry={() => void handleDiscardUpload(startAlert.id)}
          />
        ) : null}
        {startAlert?.type === 'rate-limit' && notStartedImport ? (
          <Alert
            tone="warning"
            title="Too many imports started recently"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startInFlight || isOffline}
                onClick={() => void startQueuedImport(notStartedImport)}
              >
                Try again
              </Button>
            }
          >
            {retryDescription}
          </Alert>
        ) : null}
        {startAlert?.type === 'generic' && notStartedImport ? (
          <Alert
            tone="error"
            title="Could not start the import"
            onRetry={() => void startQueuedImport(notStartedImport)}
          >
            {startAlert.message}
          </Alert>
        ) : null}

        {showForm ? (
          showCsvForm ? (
            <CsvImportForm
              actorId={actorId}
              file={file!}
              maxCsvBytes={maxCsvBytes}
              filePickerRef={filePickerRef}
              onFileChange={onFileChange}
              onActorChanged={() => setActorChangedLocally(true)}
              onMoved={() => setMoved(true)}
            />
          ) : (
            <ArchiveImportForm
              actorId={actorId}
              file={file}
              maxImportBytes={maxImportBytes}
              notStartedImport={notStartedImport}
              options={options}
              onOptionsChange={setOptions}
              onFileChange={onFileChange}
              onActorChanged={() => setActorChangedLocally(true)}
              onMoved={() => setMoved(true)}
              onStarted={showImport}
              onUploaded={(uploaded) => void startQueuedImport(uploaded)}
              startInFlight={startInFlight}
              filePickerRef={filePickerRef}
              formRef={archiveFormRef}
            />
          )
        ) : null}

        {cancelError &&
        accountImport &&
        !actorChanged &&
        isActiveImport(accountImport) ? (
          <Alert
            tone="error"
            title="Could not cancel the import"
            onRetry={() => void handleCancelImport()}
          />
        ) : null}
        {accountImport && !actorChanged && isActiveImport(accountImport) ? (
          <div ref={progressRef}>
            <ImportProgress
              accountImport={accountImport}
              currentTime={currentTime}
              canceling={canceling}
              offline={isOffline}
              focusOnMount={focusProgress}
              onCancel={() => void handleCancelImport()}
            />
          </div>
        ) : null}
        {accountImport &&
        !actorChanged &&
        !isActiveImport(accountImport) &&
        !notStartedImport ? (
          <ImportReport
            accountImport={accountImport}
            onStartAgain={handleStartAgain}
            focusOnMount={focusReport}
          />
        ) : null}
      </div>
    </Section>
  )
}
