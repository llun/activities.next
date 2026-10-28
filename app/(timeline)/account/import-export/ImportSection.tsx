'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { RefreshCw } from 'lucide-react'
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
import { focusStartCandidate } from './focusStartCandidate'
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
  // The options snapshotted onto the waiting upload at the moment another
  // file was picked while it waited. While the .zip the upload came from is
  // still the chosen file they are null, and the row starts with the
  // switches as they stand; once another file is picked, the row starts
  // with the snapshot, whatever the switches show for the new file.
  const [keptOptions, setKeptOptions] = useState<AccountImportOptions | null>(
    null
  )
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
  // Set by a start whose pressed control held the focus: the button the
  // user pressed (the warning's Start import, the rate-limit alert's Try
  // again, the generic alert's Retry) unmounts as soon as the start clears
  // its alert or drops the row, so the [startInFlight] effect hands the
  // focus back on the commit that releases the lock.
  const focusAfterStart = useRef(false)
  // Same, for the resets that unmount the focused button ("Import another
  // file", "Start again"): the empty form appears, and the picker must take
  // the focus a keyboard user just lost.
  const focusPickerAfterReset = useRef(false)
  const filePickerRef = useRef<HTMLButtonElement>(null)
  const archiveFormRef = useRef<HTMLFormElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  // The warning and the start alerts, whose buttons all start the waiting
  // row: whether one of them held the focus decides the hand-off when the
  // start ends.
  const startControlsRef = useRef<HTMLDivElement>(null)
  // The warning's Start import button: the focus target when a start that
  // keeps the row ends and the pressed button is gone.
  const warningStartRef = useRef<HTMLButtonElement>(null)
  // The start alerts' Try again and Retry buttons, in the order the focus
  // rule tries them once the warning's Start import cannot take the focus.
  // The upload-failure alert is the only one that can show without a kept
  // row: the discard, rate-limit and generic alerts only appear while the
  // warning does, so the warning's Start import comes first for them.
  const rateLimitTryAgainRef = useRef<HTMLButtonElement>(null)
  const genericRetryRef = useRef<HTMLButtonElement>(null)
  const uploadAlertTryAgainRef = useRef<HTMLButtonElement>(null)
  const discardRetryRef = useRef<HTMLButtonElement>(null)
  // Whether the progress view holds (or last held) the focus. A page-load
  // import nobody touched must not grab the focus when it finishes, and
  // "the body has the focus" cannot tell that apart from "the progress view
  // just unmounted with the focus inside it": only a focusin inside the
  // progress view can.
  const progressHadFocus = useRef(false)
  // The cancel confirm is portalled outside the progress view, so its
  // focus cannot be seen from the focusin tracker. While it is open the
  // user is still deciding about this import, so the poll that ends it
  // must hand the focus to the report all the same.
  const cancelConfirmOpen = useRef(false)
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

  // The focus rule in one place: the waiting upload's Start import, the
  // showing alert's Retry or Try again, then the file picker. The first
  // candidate that is mounted and not disabled takes the focus; one that
  // cannot (offline disables the Start import and every Retry and Try
  // again) falls through to the next.
  const handOffFocus = () =>
    focusStartCandidate([
      warningStartRef.current,
      rateLimitTryAgainRef.current,
      genericRetryRef.current,
      uploadAlertTryAgainRef.current,
      discardRetryRef.current,
      filePickerRef.current
    ])

  useEffect(() => {
    if (startInFlight) return
    if (focusAfterStart.current) {
      focusAfterStart.current = false
      // A started import hands the focus to the progress view itself, and
      // a start from the warning that kept the row leaves it on the Start
      // import button, which never unmounted: both are left alone. Only a
      // focus that fell to the body (the pressed control is gone) is
      // handed back, by the rule above.
      if (document.activeElement === document.body) handOffFocus()
    }
    if (!focusPickerAfterDiscard.current) return
    focusPickerAfterDiscard.current = false
    // The pressed Discard unmounts with the row, so the focus falls to the
    // body — unless the user moved on to another control while the request
    // was in flight, in which case it stays where the user put it. The
    // same check the failed paths make.
    if (document.activeElement === document.body) handOffFocus()
    // The effect also runs on the commit that shows a waiting upload found
    // through a 409 (a re-upload whose presign finds another tab's row):
    // no start of the section's own is in flight there, so the row's
    // arrival is what must trigger the hand-off. A running found row is
    // left alone: its progress view takes the focus in its own (child)
    // effect first, and this one only acts on a focus left on the body.
  }, [startInFlight, notStartedImport?.id])

  // The picker is focusable on the commit that swaps the report or the CSV
  // result for the empty form, so the reset focuses it there.
  useEffect(() => {
    if (!focusPickerAfterReset.current) return
    focusPickerAfterReset.current = false
    filePickerRef.current?.focus()
  }, [file, accountImport])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      progressHadFocus.current = Boolean(
        progressRef.current?.contains(event.target as Node)
      )
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // When the poll ends an import the user started, the progress view
  // unmounts with the focus inside it, so the focus falls to the body and
  // the report that replaces it is never announced. The report must take
  // the focus itself — but only when the progress view had it: focus
  // elsewhere on the page (the export section, say) is left alone.
  useIsomorphicLayoutEffect(() => {
    const active = Boolean(accountImport && isActiveImport(accountImport))
    if (wasActiveImport.current && !active && accountImport) {
      if (progressHadFocus.current || cancelConfirmOpen.current) {
        setFocusReport(true)
      }
      progressHadFocus.current = false
      cancelConfirmOpen.current = false
    }
    wasActiveImport.current = active
  }, [accountImport])

  const onFileChange = (selected: File | null) => {
    // Picking another file is the moment the waiting upload's options are
    // frozen: until then its switches are live and it starts with what
    // they show, from then on it starts with this snapshot.
    if (notStartedImport && keptOptions === null) setKeptOptions(options)
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

  // A waiting upload found through a 409 was not uploaded from the chosen
  // file (if any): like one the page loaded with, it starts with the
  // defaults until its own .zip is the chosen file, which it never is here.
  const showFoundImport = (found: AccountImportResponse) => {
    if (isUploadedNotStarted(found) && found.id !== notStartedImport?.id) {
      setKeptOptions(INITIAL_OPTIONS)
    }
    showImport(found)
  }

  const findActiveImport = async () => {
    const imports = await listAccountImports({ actorId }).catch(() => [])
    const activeImport = imports.find(
      (item) => item.status === 'queued' || item.status === 'running'
    )
    if (activeImport) showFoundImport(activeImport)
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
    // Some start answers drop the warning's row, and the warning (with the
    // focused Start import button) unmounts with it; the alert buttons
    // unmount as soon as the alert is cleared below. Whether a start
    // control held the focus decides the hand-off in the [startInFlight]
    // effect. The archive form counts as a start control too: a start that
    // a focused Try again began runs after the upload's Cancel took the
    // focus, and that focus is about to be lost with the form's unmount.
    const startControlHadFocus =
      (startControlsRef.current?.contains(document.activeElement) ?? false) ||
      (archiveFormRef.current?.contains(document.activeElement) ?? false)
    setStartAlert(null)
    // A row another file was picked over carries the options snapshotted
    // then; every other row (one the page loaded with, a fresh upload, a
    // kept failure on the file still chosen) takes the switches as they
    // stand, which for a fresh upload is what it was just uploaded with.
    const uploadOptions = keptOptions ?? options
    // A start that gives up on the upload cancels the row server-side, so it
    // must also drop it here: otherwise the "earlier upload" warning stays up
    // with a Start button that can only fail again, until the next poll
    // reports the row as cancelled.
    const discardUploaded = async () => {
      await cancelBestEffort(actorId, uploaded.id)
      setKeptOptions(null)
      if (notStartedImport?.id === uploaded.id) {
        setAccountImport(null)
        setCancelError(false)
        // The warning (and its focused button) unmounts; the focus is
        // handed over on the commit that releases the start lock, as
        // after Discard.
        if (startControlHadFocus) focusAfterStart.current = true
      }
    }
    try {
      const started = await startAccountImport({
        actorId,
        importId: uploaded.id,
        options: uploadOptions
      })
      setKeptOptions(null)
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
        // the slot: re-read it and show it. It is never this page's to
        // cancel. A row that comes back cancelled and never started was
        // discarded elsewhere: nothing ran, so there is nothing to report —
        // it is gone, and the user is asked to upload again.
        try {
          const current = await getAccountImport({ actorId, id: uploaded.id })
          if (current.status === 'cancelled' && current.startedAt === null) {
            setKeptOptions(null)
            if (notStartedImport?.id === uploaded.id) {
              setAccountImport(null)
              // Same hand-off as a row dropped by the start itself: the
              // warning's focused button unmounts with the row.
              if (startControlHadFocus) focusAfterStart.current = true
            }
            setStartAlert({ type: 'upload' })
          } else {
            showImport(current)
          }
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
      // An answer that keeps the row unmounts the pressed alert button
      // too (the alert was cleared above), so the hand-off applies to
      // every start whose control held the focus.
      if (startControlHadFocus) focusAfterStart.current = true
      setStartInFlight(false)
    }
  }

  const handleDiscardUpload = async (id: string) => {
    if (startInFlight) return
    setStartInFlight(true)
    // The discard alert's Retry sits in the same start controls box as the
    // warning's buttons: whether one of them held the focus decides the
    // hand-off when the discard ends (see the [startInFlight] effect).
    const startControlHadFocus =
      startControlsRef.current?.contains(document.activeElement) ?? false
    setStartAlert(null)
    try {
      await cancelAccountImport({ actorId, id })
      setAccountImport(null)
      setKeptOptions(null)
      setCancelError(false)
      focusPickerAfterDiscard.current = true
    } catch (error) {
      if (isActorChanged(error)) {
        setActorChangedLocally(true)
      } else if (isAlreadyFinished(error)) {
        // The 24 h sweep got there first: the row is gone either way.
        setAccountImport(null)
        setKeptOptions(null)
        setCancelError(false)
        focusPickerAfterDiscard.current = true
      } else {
        // The cancel the user asked for did not happen, so the row is
        // still queued: keep the warning and say what failed. The alert
        // that unmounts took the focus with it, so a discard that fails
        // again hands it back like a start that keeps the row.
        setStartAlert({ type: 'discard', id })
        if (startControlHadFocus) focusAfterStart.current = true
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
    setKeptOptions(null)
    setFocusReport(false)
    setFocusProgress(false)
    // The button that was pressed unmounts with the report, so the picker
    // must take the focus on the commit that shows the empty form.
    focusPickerAfterReset.current = true
  }

  // The CSV result's "Import another file" unmounts the form the button
  // sits in, so it goes through the section for the same focus hand-off.
  const handleCsvImportAnotherFile = () => {
    focusPickerAfterReset.current = true
    onFileChange(null)
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
      } else if (isAlreadyFinished(error)) {
        // The import finished between the last poll and the confirmed
        // cancel: it is over, not failed. Show what became of it, the same
        // way a successful cancel does.
        try {
          setAccountImport(
            await getAccountImport({ actorId, id: accountImport.id })
          )
          setFocusReport(true)
        } catch {
          setCancelError(true)
        }
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
            cannot hide the upload that is still waiting to be started.
            The start alerts sit inside the same ref'd element, because
            their buttons start the warning's row too: whichever of these
            controls held the focus, the end of the start hands it back
            (see the [startInFlight] effect).
            The ActorChangedAlert and the moved alert replace this whole
            block: a Retry or Try again left live beside them would send a
            start under an actorId the server has already refused. */}
        {(showWarning || startAlert !== null) && !actorChanged && !moved ? (
          <div ref={startControlsRef} className="space-y-4">
            {showWarning && notStartedImport ? (
              <Alert
                tone="warning"
                title="An earlier upload was not started"
                action={
                  <div className="flex gap-2">
                    <Button
                      ref={warningStartRef}
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
                      onClick={() =>
                        void handleDiscardUpload(notStartedImport.id)
                      }
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
                    ref={uploadAlertTryAgainRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      startInFlight || isOffline || !file || showCsvForm
                    }
                    onClick={() => archiveFormRef.current?.requestSubmit()}
                  >
                    Try again
                  </Button>
                }
              />
            ) : null}
            {startAlert?.type === 'unreadable' ? (
              <Alert tone="error" title="We could not read this file">
                Choose an activities.next archive, a Mastodon archive (.zip) or
                a Mastodon CSV file.
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
                action={
                  <Button
                    ref={discardRetryRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={startInFlight || isOffline}
                    onClick={() => void handleDiscardUpload(startAlert.id)}
                  >
                    <RefreshCw aria-hidden="true" />
                    Retry
                  </Button>
                }
              />
            ) : null}
            {startAlert?.type === 'rate-limit' && notStartedImport ? (
              <Alert
                tone="warning"
                title="Too many imports started recently"
                action={
                  <Button
                    ref={rateLimitTryAgainRef}
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
            {/* A generic start failure is shown whatever became of the row:
                the branches that set it may drop it (a fresh upload whose
                re-read failed), so gating on the kept row would hide the only
                explanation. Retry needs a row to start, so it is offered only
                when one is kept. */}
            {startAlert?.type === 'generic' ? (
              <Alert
                tone="error"
                title="Could not start the import"
                action={
                  notStartedImport ? (
                    <Button
                      ref={genericRetryRef}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={startInFlight || isOffline}
                      onClick={() => void startQueuedImport(notStartedImport)}
                    >
                      <RefreshCw aria-hidden="true" />
                      Retry
                    </Button>
                  ) : undefined
                }
              >
                {startAlert.message}
              </Alert>
            ) : null}
          </div>
        ) : null}

        {showForm ? (
          showCsvForm ? (
            <CsvImportForm
              actorId={actorId}
              file={file!}
              maxCsvBytes={maxCsvBytes}
              filePickerRef={filePickerRef}
              onFileChange={onFileChange}
              onImportAnotherFile={handleCsvImportAnotherFile}
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
              onStarted={(found) => {
                // A waiting upload found through the presign's 409 is an
                // upload attempt that ends with a row waiting: the pressed
                // control (the form's Try again, or Import archive) is gone
                // or locked, so the found row's Start import must take the
                // focus the rule hands back (see the effect above). A
                // running row arms nothing: no control of the section's
                // own was pressed, so the flag must not stay set for a
                // later start to fire.
                focusAfterStart.current = isUploadedNotStarted(found)
                showFoundImport(found)
              }}
              onUploaded={(uploaded) => void startQueuedImport(uploaded)}
              onSubmitStart={() => setStartAlert(null)}
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
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={canceling || isOffline}
                onClick={() => void handleCancelImport()}
              >
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            }
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
              onConfirmOpenChange={(open) => {
                cancelConfirmOpen.current = open
              }}
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
