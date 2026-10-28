'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  AccountImportOptions,
  AccountImportResponse,
  PresignedAccountImportResponse,
  cancelAccountImport,
  createPresignedImport,
  listAccountImports,
  startAccountImport,
  uploadAccountImport
} from '@/lib/client/accountImports'
import { ApiRequestError } from '@/lib/client/http'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Progress } from '@/lib/components/ui/progress'
import { Switch } from '@/lib/components/ui/switch'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import { formatBytes } from '@/lib/utils/formatBytes'

interface Props {
  actorId: string
  currentTime: number
  file: File | null
  maxImportBytes: number
  /**
   * A queued import that was uploaded but never started (the row the presign
   * leaves behind when the start never happened), offered back to the user
   * instead of being shown as progress that would never move.
   */
  notStartedImport: AccountImportResponse | null
  onFileChange: (file: File | null) => void
  onActorChanged: () => void
  onMoved: () => void
  onStarted: (accountImport: AccountImportResponse) => void
  onDiscarded: () => void
}

type AlertState =
  | { type: 'upload' }
  | { type: 'unreadable' }
  | { type: 'rate-limit'; retryAt: number | null }
  | { type: 'generic'; message: string }
  | null

interface UploadProgress {
  loaded: number
  total: number
}

const INITIAL_OPTIONS: AccountImportOptions = {
  likes: false,
  bookmarks: false,
  repliesToOthers: 'skip',
  profile: false,
  settings: false
}

const isActiveImport = (accountImport: AccountImportResponse) =>
  accountImport.status === 'queued' || accountImport.status === 'running'

const isActorChanged = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 409 &&
  error.message === 'Actor changed'

const isMoved = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status === 422 &&
  error.message === 'This account has moved'

// A start failure the owner can simply try again from: the server kept the
// upload queued, so retrying the start must not re-upload anything.
const isTransientStartFailure = (error: unknown) =>
  !(error instanceof ApiRequestError) ||
  error.status === 0 ||
  error.status === 503

const cancelBestEffort = (actorId: string, id: string) =>
  cancelAccountImport({ actorId, id }).catch(() => undefined)

const ToggleOption = ({
  id,
  label,
  hint,
  checked,
  onCheckedChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) => (
  <FormRow label={label} htmlFor={id} hint={hint} inline>
    <Switch
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  </FormRow>
)

export const ArchiveImportForm = ({
  actorId,
  currentTime,
  file,
  maxImportBytes,
  notStartedImport,
  onFileChange,
  onActorChanged,
  onMoved,
  onStarted,
  onDiscarded
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  // The upload awaiting a start, readable from effects and cleanups that run
  // after the state has moved on (the [file] reset, the unmount).
  const pendingUploadRef = useRef<PresignedAccountImportResponse | null>(null)
  const [options, setOptions] = useState(INITIAL_OPTIONS)
  const [submitting, setSubmitting] = useState(false)
  const [pendingUpload, setPendingUpload] =
    useState<PresignedAccountImportResponse | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null
  )
  const [alert, setAlert] = useState<AlertState>(null)
  const [clock, setClock] = useState(currentTime)
  const hasHydrated = useHasHydrated()
  const isOffline = useConnectionStatus().state === 'offline'
  const isUploading = uploadProgress !== null && submitting

  const storePendingUpload = useCallback(
    (uploaded: PresignedAccountImportResponse | null) => {
      pendingUploadRef.current = uploaded
      setPendingUpload(uploaded)
    },
    []
  )

  useEffect(() => {
    const stored = pendingUploadRef.current
    if (stored) void cancelBestEffort(actorId, stored.id)
    setOptions(INITIAL_OPTIONS)
    setAlert(null)
    storePendingUpload(null)
    setUploadProgress(null)
  }, [actorId, file, storePendingUpload])

  useEffect(() => {
    if (hasHydrated) setClock(Date.now())
  }, [hasHydrated])

  useEffect(
    () => () => {
      uploadController.current?.abort()
      const stored = pendingUploadRef.current
      if (stored) void cancelBestEffort(actorId, stored.id)
    },
    [actorId]
  )

  const findActiveImport = async () => {
    const imports = await listAccountImports({ actorId }).catch(() => [])
    const activeImport = imports.find(isActiveImport)
    if (activeImport) onStarted(activeImport)
    return Boolean(activeImport)
  }

  const startUploadedArchive = async (
    uploaded: PresignedAccountImportResponse
  ) => {
    setSubmitting(true)
    setAlert(null)
    try {
      const accountImport = await startAccountImport({
        actorId,
        importId: uploaded.id,
        options
      })
      storePendingUpload(null)
      setUploadProgress(null)
      onStarted(accountImport)
    } catch (error) {
      if (isActorChanged(error)) {
        onActorChanged()
      } else if (isMoved(error)) {
        onMoved()
      } else if (error instanceof ApiRequestError && error.status === 429) {
        storePendingUpload(uploaded)
        setClock(Date.now())
        setAlert({
          type: 'rate-limit',
          retryAt:
            error.retryAfterMs === undefined
              ? null
              : Date.now() + error.retryAfterMs
        })
      } else if (error instanceof ApiRequestError && error.status === 422) {
        await cancelBestEffort(actorId, uploaded.id)
        storePendingUpload(null)
        setAlert(
          error.message === 'Archive format is not recognised'
            ? { type: 'unreadable' }
            : { type: 'generic', message: error.message }
        )
      } else if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.message === 'An import is already active'
      ) {
        const found = await findActiveImport()
        if (!found) setAlert({ type: 'generic', message: error.message })
      } else if (error instanceof ApiRequestError && error.status === 409) {
        await cancelBestEffort(actorId, uploaded.id)
        storePendingUpload(null)
        setAlert({ type: 'upload' })
      } else if (isTransientStartFailure(error)) {
        storePendingUpload(uploaded)
        setAlert({
          type: 'generic',
          message:
            error instanceof Error
              ? error.message
              : 'Could not start the import'
        })
      } else {
        await cancelBestEffort(actorId, uploaded.id)
        storePendingUpload(null)
        setAlert({
          type: 'generic',
          message:
            error instanceof Error
              ? error.message
              : 'Could not start the import'
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (!file || submitting || isOffline || file.size > maxImportBytes) return
    setAlert(null)
    if (pendingUpload) {
      await startUploadedArchive(pendingUpload)
      return
    }

    setSubmitting(true)
    let uploaded: PresignedAccountImportResponse | null = null
    let uploadSucceeded = false
    const controller = new AbortController()
    uploadController.current = controller
    try {
      uploaded = await createPresignedImport({ actorId, size: file.size })
      storePendingUpload(uploaded)
      setUploadProgress({ loaded: 0, total: file.size })
      await uploadAccountImport({
        actorId,
        file,
        uploadUrl: uploaded.uploadUrl,
        directUploadPath: uploaded.directUploadPath,
        signal: controller.signal,
        onProgress: setUploadProgress
      })
      uploadSucceeded = true
    } catch (error) {
      if (isActorChanged(error)) {
        onActorChanged()
      } else if (isMoved(error)) {
        onMoved()
      } else if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.message === 'An import is already active'
      ) {
        const found = await findActiveImport()
        if (!found) setAlert({ type: 'generic', message: error.message })
      } else if (uploaded) {
        await cancelBestEffort(actorId, uploaded.id)
        storePendingUpload(null)
        setUploadProgress(null)
        setAlert({ type: 'upload' })
      } else {
        setAlert({
          type: 'generic',
          message:
            error instanceof Error
              ? error.message
              : 'Could not prepare the archive upload'
        })
      }
    } finally {
      uploadController.current = null
      setSubmitting(false)
    }

    if (uploaded && uploadSucceeded && !controller.signal.aborted) {
      setUploadProgress(null)
      await startUploadedArchive(uploaded)
    }
  }

  const handleDiscardUpload = async (id: string) => {
    setSubmitting(true)
    try {
      await cancelBestEffort(actorId, id)
      storePendingUpload(null)
      onDiscarded()
    } finally {
      setSubmitting(false)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.currentTarget.files?.[0] ?? null)
    event.currentTarget.value = ''
  }

  const handleCancelUpload = () => uploadController.current?.abort()

  const retryDescription =
    alert?.type === 'rate-limit'
      ? alert.retryAt === null
        ? 'Try again later.'
        : `You can try again ${
            hasHydrated
              ? formatDistance(new Date(alert.retryAt), new Date(clock), {
                  addSuffix: true
                })
              : 'later'
          }.`
      : null
  const percent = uploadProgress
    ? Math.min(
        100,
        Math.round(
          (uploadProgress.loaded / Math.max(uploadProgress.total, 1)) * 100
        )
      )
    : 0

  return (
    <div className="space-y-4">
      {notStartedImport ? (
        <Alert
          tone="warning"
          title="An earlier upload was not started"
          action={
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={submitting || isOffline}
                onClick={() =>
                  void startUploadedArchive({
                    ...notStartedImport,
                    uploadUrl: null,
                    directUploadPath: null
                  })
                }
              >
                Start import
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting || isOffline}
                onClick={() => void handleDiscardUpload(notStartedImport.id)}
              >
                Discard
              </Button>
            </div>
          }
        />
      ) : null}
      {alert?.type === 'upload' ? (
        <Alert
          tone="error"
          title="The upload did not finish"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting || isOffline || !file}
              onClick={() => void handleSubmit()}
            >
              Try again
            </Button>
          }
        />
      ) : null}
      {alert?.type === 'unreadable' ? (
        <Alert tone="error" title="We could not read this file">
          Choose an activities.next archive, a Mastodon archive (.zip) or a
          Mastodon CSV file.
        </Alert>
      ) : null}
      {alert?.type === 'rate-limit' && pendingUpload ? (
        <Alert
          tone="warning"
          title="Too many imports started recently"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting || isOffline}
              onClick={() => void startUploadedArchive(pendingUpload)}
            >
              Try again
            </Button>
          }
        >
          {retryDescription}
        </Alert>
      ) : null}
      {alert?.type === 'generic' ? (
        <Alert
          tone="error"
          title="Could not start the import"
          onRetry={() => void handleSubmit()}
        >
          {alert.message}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Frame
          form
          footer={
            <SaveBar
              variant="create"
              actionLabel={submitting ? 'Importing…' : 'Import archive'}
              submit
              disabled={!file || submitting}
              disabledReason={isOffline ? "You're offline" : undefined}
            />
          }
        >
          <FormRow
            label="File"
            htmlFor="archive-import-file"
            hint="An activities.next archive (.zip), a Mastodon archive (.zip) or a Mastodon CSV file."
          >
            {({ describedBy }) => (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* The visible field the label names, as in
                      ImageUploadField: the file input itself is
                      display:none, so a label pointing at it would name
                      nothing. It shows the chosen file instead of a URL. */}
                  <Input
                    type="text"
                    id="archive-import-file"
                    value={file ? `${file.name} · ${formatBytes(file.size)}` : ''}
                    readOnly
                    placeholder="No file chosen"
                    aria-describedby={describedBy}
                    className="flex-1 bg-muted dark:bg-muted"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-center"
                    disabled={submitting}
                    onClick={() => inputRef.current?.click()}
                  >
                    {file ? 'Change file' : 'Choose file'}
                  </Button>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".zip,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </FormRow>

          <ToggleOption
            id="archive-import-replies"
            label="Import replies to other people's posts"
            hint="Off: your replies to other people's posts are skipped. On: they come in as standalone posts that link to the original."
            checked={options.repliesToOthers === 'keep'}
            onCheckedChange={(checked) =>
              setOptions((previous) => ({
                ...previous,
                repliesToOthers: checked ? 'keep' : 'skip'
              }))
            }
          />
          <ToggleOption
            id="archive-import-likes"
            label="Import likes"
            hint="Only for posts already on this server."
            checked={options.likes}
            onCheckedChange={(likes) =>
              setOptions((previous) => ({ ...previous, likes }))
            }
          />
          <ToggleOption
            id="archive-import-bookmarks"
            label="Import bookmarks"
            checked={options.bookmarks}
            onCheckedChange={(bookmarks) =>
              setOptions((previous) => ({ ...previous, bookmarks }))
            }
          />
          <ToggleOption
            id="archive-import-profile"
            label="Replace my profile with the one in the archive"
            checked={options.profile}
            onCheckedChange={(profile) =>
              setOptions((previous) => ({ ...previous, profile }))
            }
          />
          <ToggleOption
            id="archive-import-settings"
            label="Replace my settings with the ones in the archive"
            checked={options.settings}
            onCheckedChange={(settings) =>
              setOptions((previous) => ({ ...previous, settings }))
            }
          />

          {isUploading && uploadProgress ? (
            <div className="space-y-2 px-4 py-3" role="status">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  {formatBytes(uploadProgress.loaded)} of{' '}
                  {formatBytes(uploadProgress.total)} · {percent}%
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelUpload}
                >
                  Cancel
                </Button>
              </div>
              <Progress value={percent} aria-label="Archive upload progress" />
            </div>
          ) : null}
        </Frame>
      </form>
    </div>
  )
}
