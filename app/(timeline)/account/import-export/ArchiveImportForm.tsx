'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  AccountImportOptions,
  AccountImportResponse,
  PresignedAccountImportResponse,
  cancelAccountImport,
  createPresignedImport,
  listAccountImports,
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
import { formatBytes } from '@/lib/utils/formatBytes'

interface Props {
  actorId: string
  file: File | null
  maxImportBytes: number
  /**
   * A queued import that was uploaded but never started (the row the presign
   * leaves behind when the start never happened). The section owns its
   * warning; the form only needs it to lock its own Save bar.
   */
  notStartedImport: AccountImportResponse | null
  /** The import options, owned by the section: it needs them to start. */
  options: AccountImportOptions
  onOptionsChange: (options: AccountImportOptions) => void
  onFileChange: (file: File | null) => void
  onActorChanged: () => void
  onMoved: () => void
  /** Hands a queued row to the section when another import holds the slot. */
  onStarted: (accountImport: AccountImportResponse) => void
  /** The upload finished; the section starts the row it uploaded. */
  onUploaded: (uploaded: PresignedAccountImportResponse) => void
  /** True while the section is starting or discarding the earlier upload. */
  startInFlight: boolean
  /** The section focuses the picker after a successful Discard. */
  filePickerRef: RefObject<HTMLButtonElement | null>
  /** Lets the section's "The upload did not finish" Try again upload again. */
  formRef: RefObject<HTMLFormElement | null>
}

type AlertState =
  { type: 'upload' } | { type: 'generic'; message: string } | null

interface UploadProgress {
  loaded: number
  total: number
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

const cancelBestEffort = (actorId: string, id: string) =>
  cancelAccountImport({ actorId, id }).catch(() => undefined)

const ToggleOption = ({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) => (
  <FormRow label={label} htmlFor={id} hint={hint} inline>
    <Switch
      id={id}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    />
  </FormRow>
)

export const ArchiveImportForm = ({
  actorId,
  file,
  maxImportBytes,
  notStartedImport,
  options,
  onOptionsChange,
  onFileChange,
  onActorChanged,
  onMoved,
  onStarted,
  onUploaded,
  startInFlight,
  filePickerRef,
  formRef
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null
  )
  const [alert, setAlert] = useState<AlertState>(null)
  const isOffline = useConnectionStatus().state === 'offline'
  const busy = submitting || startInFlight
  const isUploading = uploadProgress !== null && submitting

  useEffect(() => {
    setAlert(null)
    setUploadProgress(null)
  }, [actorId, file])

  // Aborting the upload makes it fail, and a failed upload is one of the
  // cases that cancel the row (in handleSubmit's catch). The start needs no
  // cleanup: the section starts the row, and it is the server's, not the
  // page's.
  useEffect(
    () => () => {
      uploadController.current?.abort()
    },
    [actorId]
  )

  const findActiveImport = async () => {
    const imports = await listAccountImports({ actorId }).catch(() => [])
    const activeImport = imports.find(isActiveImport)
    if (activeImport) onStarted(activeImport)
    return Boolean(activeImport)
  }

  const handleSubmit = async () => {
    if (!file || busy || isOffline || file.size > maxImportBytes) return
    setAlert(null)
    setSubmitting(true)
    let uploaded: PresignedAccountImportResponse | null = null
    let uploadSucceeded = false
    const controller = new AbortController()
    uploadController.current = controller
    try {
      uploaded = await createPresignedImport({ actorId, size: file.size })
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
        setUploadProgress(null)
        setAlert({ type: 'upload' })
      } else {
        // Only a server message is worth showing: a browser network
        // failure rejects with a TypeError whose text ("Failed to fetch")
        // says nothing the title does not.
        setAlert({
          type: 'generic',
          message:
            error instanceof ApiRequestError
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
      onUploaded(uploaded)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.currentTarget.files?.[0] ?? null)
    event.currentTarget.value = ''
  }

  const handleCancelUpload = () => uploadController.current?.abort()

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
      {alert?.type === 'upload' ? (
        <Alert
          tone="error"
          title="The upload did not finish"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || isOffline || !file}
              onClick={() => void handleSubmit()}
            >
              Try again
            </Button>
          }
        />
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
        ref={formRef}
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
              actionLabel={busy ? 'Importing…' : 'Import archive'}
              submit
              disabled={!file || busy}
              disabledReason={
                isOffline
                  ? "You're offline"
                  : notStartedImport
                    ? 'Start or discard the earlier upload first'
                    : !file
                      ? 'Choose a file to start.'
                      : undefined
              }
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
                    value={
                      file ? `${file.name} · ${formatBytes(file.size)}` : ''
                    }
                    readOnly
                    placeholder="No file chosen"
                    aria-describedby={describedBy}
                    className="flex-1 bg-muted dark:bg-muted"
                  />
                  <Button
                    ref={filePickerRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-center"
                    disabled={busy}
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

          {/* The switches belong to the chosen .zip (the mockup's
              "nothing chosen yet" and "file not recognised" boards show
              only the File row), and they are locked while the form is
              busy: the start sends the options of the render that pressed
              Import, so what is sent must be what is shown. */}
          {file ? (
            <>
              <ToggleOption
                id="archive-import-replies"
                label="Import replies to other people's posts"
                hint="Off: your replies to other people's posts are skipped. On: they come in as standalone posts that link to the original."
                checked={options.repliesToOthers === 'keep'}
                disabled={busy}
                onCheckedChange={(checked) =>
                  onOptionsChange({
                    ...options,
                    repliesToOthers: checked ? 'keep' : 'skip'
                  })
                }
              />
              <ToggleOption
                id="archive-import-likes"
                label="Import likes"
                hint="Only for posts already on this server."
                checked={options.likes}
                disabled={busy}
                onCheckedChange={(likes) =>
                  onOptionsChange({ ...options, likes })
                }
              />
              <ToggleOption
                id="archive-import-bookmarks"
                label="Import bookmarks"
                checked={options.bookmarks}
                disabled={busy}
                onCheckedChange={(bookmarks) =>
                  onOptionsChange({ ...options, bookmarks })
                }
              />
              <ToggleOption
                id="archive-import-profile"
                label="Replace my profile with the one in the archive"
                checked={options.profile}
                disabled={busy}
                onCheckedChange={(profile) =>
                  onOptionsChange({ ...options, profile })
                }
              />
              <ToggleOption
                id="archive-import-settings"
                label="Replace my settings with the ones in the archive"
                checked={options.settings}
                disabled={busy}
                onCheckedChange={(settings) =>
                  onOptionsChange({ ...options, settings })
                }
              />
            </>
          ) : null}

          {isUploading && uploadProgress ? (
            <div className="space-y-2 px-4 py-3">
              {/* The live region says only that the upload began: XHR
                  progress fires many times a second, and announcing each
                  percentage would talk over everything else for minutes.
                  The bytes, percent and bar stay outside it. */}
              <span role="status" className="sr-only">
                Uploading the archive
              </span>
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
