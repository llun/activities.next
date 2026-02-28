'use client'

import Link from 'next/link'
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessImportBatchResult,
  getFitnessImportBatch,
  retryFitnessImportBatch,
  startFitnessImport
} from '@/lib/client'
import { VisibilitySelector } from '@/lib/components/post-box/visibility-selector'
import { ActorInfoBanner } from '@/lib/components/settings/ActorInfoBanner'
import {
  getFitnessImportFileError,
  getFitnessImportFileIcon,
  getFitnessImportFileState
} from '@/lib/components/settings/fitnessImportStatus'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { ACCEPTED_FITNESS_FILE_EXTENSIONS } from '@/lib/services/fitness-files/constants'
import { getMentionFromActorID } from '@/lib/types/domain/actor'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

interface FitnessImportProps {
  actorHandle?: string
}

const getStatusLink = (actorId: string, statusId: string) => {
  try {
    const actorMention = getMentionFromActorID(actorId, true)
    return `/${actorMention}/${encodeURIComponent(statusId)}`
  } catch {
    return null
  }
}

export function FitnessImport({
  actorHandle: _actorHandle
}: FitnessImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [visibility, setVisibility] = useState<MastodonVisibility>('public')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchResult, setBatchResult] =
    useState<FitnessImportBatchResult | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const failedCount = batchResult?.summary.failed ?? 0
  const selectedFileNames = useMemo(
    () => files.map((file) => file.name),
    [files]
  )

  useEffect(() => {
    if (!batchId || !isPolling) return

    let isActive = true

    const pollBatchStatus = async () => {
      try {
        const result = await getFitnessImportBatch(batchId)
        if (!isActive) return
        setBatchResult(result)
        if (result.status !== 'pending') {
          setIsPolling(false)
        }
      } catch (pollError) {
        if (!isActive) return
        const message =
          pollError instanceof Error
            ? pollError.message
            : 'Failed to load import status'
        setError(message)
        setIsPolling(false)
      }
    }

    void pollBatchStatus()
    const intervalId = window.setInterval(() => {
      void pollBatchStatus()
    }, 2_000)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [batchId, isPolling])

  const handleChooseFiles = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length === 0) return

    const invalid = selected.find((file) => {
      const lowerName = file.name.toLowerCase()
      return !ACCEPTED_FITNESS_FILE_EXTENSIONS.some((ext) =>
        lowerName.endsWith(ext)
      )
    })

    if (invalid) {
      setError(
        `Invalid file type: ${invalid.name}. Allowed: ${ACCEPTED_FITNESS_FILE_EXTENSIONS.join(', ')}`
      )
      return
    }

    setError(null)
    setFiles(selected)
    event.currentTarget.value = ''
  }

  const handleStartImport = async () => {
    if (files.length === 0 || isImporting) return

    setIsImporting(true)
    setError(null)

    try {
      const result = await startFitnessImport(files, visibility)
      setBatchId(result.batchId)
      setBatchResult(null)
      setIsPolling(true)
      setFiles([])
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : 'Failed to start import'
      setError(message)
    } finally {
      setIsImporting(false)
    }
  }

  const handleRetry = async () => {
    if (!batchId || isRetrying) return

    setIsRetrying(true)
    setError(null)

    try {
      await retryFitnessImportBatch(batchId, visibility)
      setIsPolling(true)
    } catch (retryError) {
      const message =
        retryError instanceof Error
          ? retryError.message
          : 'Failed to retry import'
      setError(message)
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Fitness Files</CardTitle>
        <CardDescription>
          Upload and import multiple <code>.fit</code>, <code>.gpx</code>, or{' '}
          <code>.tcx</code> files in one batch.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {_actorHandle && <ActorInfoBanner actorHandle={_actorHandle} />}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={ACCEPTED_FITNESS_FILE_EXTENSIONS.join(',')}
          onChange={handleFileChange}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleChooseFiles}
            disabled={isImporting}
          >
            Choose files
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Visibility:</span>
            <VisibilitySelector
              visibility={visibility}
              onVisibilityChange={setVisibility}
            />
          </div>
          <Button
            type="button"
            onClick={handleStartImport}
            disabled={files.length === 0 || isImporting}
          >
            {isImporting ? 'Importing…' : `Import ${files.length || ''}`.trim()}
          </Button>
        </div>

        {selectedFileNames.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">
              Selected files ({selectedFileNames.length})
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {selectedFileNames.map((name, index) => (
                <li key={`${name}-${index}`}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        {batchResult && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Batch {batchResult.batchId} • {batchResult.status}
              </p>
              <p className="text-xs text-muted-foreground">
                {batchResult.summary.completed}/{batchResult.summary.total}{' '}
                completed, {batchResult.summary.failed} failed
              </p>
            </div>

            <div className="space-y-2">
              {batchResult.files.map((file) => {
                const fileState = getFitnessImportFileState(file)
                const fileError = getFitnessImportFileError(file)
                const statusLink = file.statusId
                  ? getStatusLink(file.actorId, file.statusId)
                  : null

                return (
                  <div
                    key={file.id}
                    className="flex flex-col gap-1 rounded border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{getFitnessImportFileIcon(fileState)}</span>
                      <span className="font-medium">{file.fileName}</span>
                      <span className="text-xs uppercase text-muted-foreground">
                        {file.fileType}
                      </span>
                      {file.isPrimary && (
                        <span className="text-xs text-muted-foreground">
                          primary
                        </span>
                      )}
                      {statusLink && (
                        <Link
                          href={statusLink}
                          className="text-xs text-primary hover:underline"
                        >
                          View status →
                        </Link>
                      )}
                    </div>
                    {fileError && (
                      <p className="text-xs text-destructive">{fileError}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {failedCount > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? 'Retrying…' : `Retry failed (${failedCount})`}
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
