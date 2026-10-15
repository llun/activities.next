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
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
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

export function FitnessImport({ actorHandle }: FitnessImportProps) {
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
    <Section
      title="Import activities"
      description={
        <>
          Upload and import multiple <code>.fit</code>, <code>.gpx</code>, or{' '}
          <code>.tcx</code> files in one batch.
        </>
      }
    >
      <Frame
        form
        footer={
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleStartImport}
              disabled={files.length === 0 || isImporting}
            >
              {isImporting
                ? 'Importing…'
                : `Import ${files.length || ''}`.trim()}
            </Button>
          </div>
        }
      >
        {actorHandle && (
          <div className="px-4 pt-1 pb-1.5">
            <ActorInfoBanner actorHandle={actorHandle} />
          </div>
        )}

        <input
          ref={fileInputRef}
          id="fitnessImportFiles"
          type="file"
          multiple
          className="hidden"
          accept={ACCEPTED_FITNESS_FILE_EXTENSIONS.join(',')}
          onChange={handleFileChange}
        />

        <FormRow
          label="Files"
          htmlFor="fitnessImportFiles"
          hint="Choose one or more files to import."
        >
          {({ describedBy, labelledBy }) => (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  id="fitnessImportChooseFiles"
                  variant="outline"
                  onClick={handleChooseFiles}
                  disabled={isImporting}
                  aria-labelledby={`${labelledBy} fitnessImportChooseFiles`}
                  aria-describedby={describedBy}
                >
                  Choose files
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedFileNames.length === 0
                    ? 'No files chosen'
                    : `${selectedFileNames.length} ${selectedFileNames.length === 1 ? 'file' : 'files'} chosen`}
                </span>
              </div>
              {selectedFileNames.length > 0 && (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {selectedFileNames.map((name, index) => (
                    <li key={`${name}-${index}`} className="break-all">
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </FormRow>

        <FormRow label="Visibility" hint="Who can see the imported activities.">
          {({ describedBy, labelledBy }) => (
            <div
              role="group"
              aria-labelledby={labelledBy}
              aria-describedby={describedBy}
            >
              <VisibilitySelector
                visibility={visibility}
                onVisibilityChange={setVisibility}
              />
            </div>
          )}
        </FormRow>
      </Frame>

      {(batchResult || error) && (
        <div className="space-y-4">
          {batchResult && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Batch {batchResult.batchId} • {batchResult.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  {batchResult.summary.completed}/{batchResult.summary.total}{' '}
                  completed, {batchResult.summary.failed} failed
                </p>
              </div>

              <div className="divide-y rounded-lg border">
                {batchResult.files.map((file) => {
                  const fileState = getFitnessImportFileState(file)
                  const fileError = getFitnessImportFileError(file)
                  const statusLink = file.statusId
                    ? getStatusLink(file.actorId, file.statusId)
                    : null

                  return (
                    <div
                      key={file.id}
                      className="flex flex-col gap-1 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{getFitnessImportFileIcon(fileState)}</span>
                        <span className="min-w-0 break-all font-medium">
                          {file.fileName}
                        </span>
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
                            className="text-xs text-primary-text hover:underline"
                          >
                            View status →
                          </Link>
                        )}
                      </div>
                      {fileError && (
                        <p className="text-destructive-text text-xs">
                          {fileError}
                        </p>
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

          {error && (
            <Alert title="We couldn’t import these files">{error}</Alert>
          )}
        </div>
      )}
    </Section>
  )
}
