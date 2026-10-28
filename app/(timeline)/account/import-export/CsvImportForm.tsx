'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { createBulkImport, getBulkImport } from '@/lib/client/bulkImports'
import type {
  BulkImportMode,
  BulkImportResponse,
  BulkImportType
} from '@/lib/client/bulkImports'
import { onConnectionRestored } from '@/lib/client/connection'
import { ApiRequestError } from '@/lib/client/http'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { RadioCard } from '@/lib/components/surface/RadioCard'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Progress } from '@/lib/components/ui/progress'
import { RadioGroup } from '@/lib/components/ui/radio-group'
import { Select } from '@/lib/components/ui/select'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { formatBytes } from '@/lib/utils/formatBytes'

const CSV_TYPES: Array<{ value: BulkImportType; label: string }> = [
  { value: 'following', label: 'Following' },
  { value: 'blocking', label: 'Blocked accounts' },
  { value: 'muting', label: 'Muted accounts' },
  { value: 'domain_blocking', label: 'Blocked domains' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'lists', label: 'Lists' }
]

const FILENAME_TYPES: Record<string, BulkImportType> = {
  'following_accounts.csv': 'following',
  'blocked_accounts.csv': 'blocking',
  'muted_accounts.csv': 'muting',
  'blocked_domains.csv': 'domain_blocking',
  'bookmarks.csv': 'bookmarks',
  'lists.csv': 'lists'
}

const labelForType = (type: BulkImportType) =>
  CSV_TYPES.find((item) => item.value === type)?.label ?? 'file'

export const guessCsvImportType = (
  filename: string | undefined
): BulkImportType =>
  FILENAME_TYPES[filename?.toLowerCase() ?? ''] ?? 'following'

interface Props {
  actorId: string
  file: File
  maxCsvBytes: number
  /** The section focuses the picker after discarding an earlier upload. */
  filePickerRef: RefObject<HTMLButtonElement | null>
  onFileChange: (file: File | null) => void
  /** "Import another file": the section focuses the picker for it. */
  onImportAnotherFile: () => void
  /**
   * Reports `submitting || running`: the import lives only in this
   * component's state, so the section must not unmount the form (by
   * starting the waiting archive upload) while it is busy.
   */
  onBusyChange: (busy: boolean) => void
  onActorChanged: () => void
  onMoved: () => void
}

export const CsvImportForm = ({
  actorId,
  file,
  maxCsvBytes,
  filePickerRef,
  onFileChange,
  onImportAnotherFile,
  onBusyChange,
  onActorChanged,
  onMoved
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState(() => guessCsvImportType(file.name))
  const [mode, setMode] = useState<BulkImportMode>('merge')
  const [bulkImport, setBulkImport] = useState<BulkImportResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOffline = useConnectionStatus().state === 'offline'
  const finished = bulkImport?.state === 'finished'
  // The import runs on the server after createBulkImport returns, so the
  // bar must stay locked until it finishes: a second press would post the
  // same file again and answer "An import is already in progress".
  const running = bulkImport !== null && !finished

  useEffect(() => {
    setType(guessCsvImportType(file.name))
    setMode('merge')
    setBulkImport(null)
    setError(null)
  }, [file])

  const refreshImport = useCallback(async () => {
    if (!bulkImport || bulkImport.state === 'finished') return
    try {
      setBulkImport(await getBulkImport({ actorId, id: bulkImport.id }))
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        if (cause.message === 'Actor changed') onActorChanged()
        else if (cause.message === 'This account has moved') onMoved()
      }
    }
  }, [actorId, bulkImport, onActorChanged, onMoved])

  useEffect(() => {
    if (!bulkImport || bulkImport.state === 'finished' || isOffline) return
    const interval = window.setInterval(() => void refreshImport(), 3_000)
    return () => window.clearInterval(interval)
  }, [bulkImport, isOffline, refreshImport])

  useEffect(() => {
    if (!bulkImport || bulkImport.state === 'finished') return
    return onConnectionRestored(() => void refreshImport())
  }, [bulkImport, refreshImport])

  // The section locks its start controls on this: a start of the waiting
  // archive upload that succeeds would unmount this form mid-import and
  // lose its result (nothing else polls it). The cleanup releases the
  // lock on unmount, and the effect re-reports on every change.
  useEffect(() => {
    onBusyChange(submitting || running)
    return () => onBusyChange(false)
  }, [submitting, running, onBusyChange])

  const submit = async () => {
    if (submitting || isOffline || file.size > maxCsvBytes) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await createBulkImport({ actorId, file, type, mode })
      setBulkImport(
        created.state === 'finished'
          ? await getBulkImport({ actorId, id: created.id }).catch(
              () => created
            )
          : created
      )
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        if (cause.message === 'Actor changed') onActorChanged()
        else setError(cause.message)
      } else if (
        cause instanceof ApiRequestError &&
        cause.status === 422 &&
        cause.message === 'This account has moved'
      ) {
        onMoved()
      } else {
        // Only a server message is worth showing: a browser network
        // failure rejects with a TypeError whose text ("Failed to fetch")
        // says nothing the title does not.
        setError(
          cause instanceof ApiRequestError
            ? cause.message
            : 'Could not start the import'
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.currentTarget.files?.[0] ?? null)
    event.currentTarget.value = ''
  }

  const progress = bulkImport
    ? bulkImport.totalItems > 0
      ? Math.min(
          100,
          Math.round((bulkImport.processedItems / bulkImport.totalItems) * 100)
        )
      : null
    : null

  return (
    <div className="space-y-4">
      {mode === 'overwrite' && !bulkImport ? (
        <Alert tone="warning" title="Overwrite replaces your current list">
          Anything not in the file is removed.
        </Alert>
      ) : null}
      {error ? (
        <Alert
          tone="error"
          title={
            error === 'We could not read this file'
              ? error
              : 'Could not start the import'
          }
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting || isOffline}
              onClick={() => void submit()}
            >
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          }
        >
          {/* The plain fallback and the unreadable-file message already say
              everything in the title; a server message adds the detail. */}
          {error === 'We could not read this file' ||
          error === 'Could not start the import'
            ? null
            : error}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Frame
          form
          footer={
            finished ? null : (
              <SaveBar
                variant="create"
                actionLabel={
                  submitting || running
                    ? 'Importing…'
                    : `Import ${labelForType(type).toLowerCase()}`
                }
                submit
                disabled={submitting || running || file.size > maxCsvBytes}
                disabledReason={isOffline ? "You're offline" : undefined}
              />
            )
          }
        >
          <FormRow
            label="File"
            htmlFor="csv-import-file"
            hint="An activities.next archive (.zip), a Mastodon archive (.zip) or a Mastodon CSV file."
          >
            {({ describedBy }) => (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* The visible field the label names, as in ImageUploadField:
                      the file input itself is display:none, so a label pointing
                      at it would name nothing. */}
                  <Input
                    type="text"
                    id="csv-import-file"
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
                    disabled={submitting || Boolean(bulkImport)}
                    onClick={() => inputRef.current?.click()}
                  >
                    Change file
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

          {!bulkImport ? (
            <>
              <FormRow label="What is in this file" htmlFor="csv-import-type">
                <Select
                  id="csv-import-type"
                  value={type}
                  // What is sent must be what is shown: the type is locked
                  // while the request that carries it is in flight.
                  disabled={submitting}
                  onChange={(event) =>
                    setType(event.currentTarget.value as BulkImportType)
                  }
                >
                  {CSV_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </FormRow>
              <FormRow label="When importing" htmlFor="csv-import-mode">
                {({ describedBy, labelledBy }) => (
                  <RadioGroup
                    id="csv-import-mode"
                    aria-labelledby={labelledBy}
                    aria-describedby={describedBy}
                    value={mode}
                    onValueChange={(value) => setMode(value as BulkImportMode)}
                    // Same lock as the type: the mode the request carries
                    // must be the mode the page shows.
                    disabled={submitting}
                    className="grid gap-2"
                  >
                    <RadioCard
                      value="merge"
                      title="Merge"
                      hint="Keep what you have and add the file."
                    />
                    <RadioCard
                      value="overwrite"
                      title="Overwrite"
                      hint="Replace what you have with the file."
                    />
                  </RadioGroup>
                )}
              </FormRow>
            </>
          ) : (
            <div className="space-y-3 px-4 py-3">
              {/* The heading and the counts are the news ("Importing" turning
                  into "Import finished", the counts moving); the Progress bar
                  stays outside the live region so every tick is not
                  announced. */}
              <div role="status" className="space-y-1">
                <p className="font-medium">
                  {finished ? 'Import finished' : 'Importing'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {bulkImport.importedItems.toLocaleString('en-US')} imported ·{' '}
                  {bulkImport.failedItems.toLocaleString('en-US')} failed
                </p>
              </div>
              {!finished ? (
                <Progress value={progress} aria-label="CSV import progress" />
              ) : null}
              {finished && bulkImport.failedRows?.length ? (
                <ul className="space-y-2 text-sm">
                  {bulkImport.failedRows.slice(0, 100).map((row) => (
                    <li key={row.rowIndex}>
                      <span className="font-medium">Row {row.rowIndex}:</span>{' '}
                      {row.error ?? 'Could not import this row'}
                    </li>
                  ))}
                </ul>
              ) : null}
              {finished ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onImportAnotherFile}
                >
                  Import another file
                </Button>
              ) : null}
            </div>
          )}
        </Frame>
      </form>
    </div>
  )
}
