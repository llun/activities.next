'use client'

import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import {
  ActiveStravaArchiveImport,
  ApiRequestError,
  FitnessImportBatchResult,
  cancelStravaArchiveImport,
  getActiveStravaArchiveImport,
  getFitnessImportBatch,
  retryStravaArchiveImport,
  startStravaArchiveImport
} from '@/lib/client'
import { VisibilitySelector } from '@/lib/components/post-box/visibility-selector'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

const MAX_ARCHIVE_BATCH_NOT_READY_POLLS = 90

interface Props {
  actorHandle?: string
}

export const StravaArchiveImportSection: FC<Props> = ({ actorHandle }) => {
  const [archiveFile, setArchiveFile] = useState<File | null>(null)
  const [archiveVisibility, setArchiveVisibility] =
    useState<MastodonVisibility>('private')
  const [archiveBatchId, setArchiveBatchId] = useState<string | null>(null)
  const [archiveBatchResult, setArchiveBatchResult] =
    useState<FitnessImportBatchResult | null>(null)
  const [isArchiveImporting, setIsArchiveImporting] = useState(false)
  const [isArchiveActionLoading, setIsArchiveActionLoading] = useState(false)
  const [isArchivePolling, setIsArchivePolling] = useState(false)
  const [archiveMessage, setArchiveMessage] = useState('')
  const [archiveError, setArchiveError] = useState('')
  const [activeArchiveImport, setActiveArchiveImport] =
    useState<ActiveStravaArchiveImport | null>(null)

  const hasLockedArchiveImport =
    activeArchiveImport?.status === 'importing' ||
    activeArchiveImport?.status === 'failed'
  const isArchiveControlsDisabled =
    isArchiveImporting || isArchiveActionLoading || hasLockedArchiveImport

  const syncActiveArchiveImportState = async ({
    showLoadError
  }: {
    showLoadError: boolean
  }): Promise<ActiveStravaArchiveImport | null> => {
    try {
      const response = await getActiveStravaArchiveImport()
      const activeImport = response.activeImport

      setActiveArchiveImport(activeImport)
      if (activeImport) {
        setArchiveBatchId(activeImport.batchId)
      }

      if (!activeImport) {
        return null
      }

      if (activeImport.status === 'importing') {
        setArchiveError('')
        setArchiveMessage('A Strava archive import is currently running.')
      } else {
        const failedMessage =
          activeImport.lastError ||
          activeImport.firstFailureMessage ||
          'Strava archive import failed. Retry or cancel before importing a new archive.'
        setArchiveError(failedMessage)
        setArchiveMessage('')
      }

      return activeImport
    } catch (archiveStateError) {
      if (showLoadError) {
        const loadMessage =
          archiveStateError instanceof Error
            ? archiveStateError.message
            : 'Failed to load Strava archive import state'
        setArchiveError(loadMessage)
      }
      return null
    }
  }

  useEffect(() => {
    const loadInitialState = async () => {
      const activeImport = await syncActiveArchiveImportState({
        showLoadError: true
      })
      if (activeImport?.status === 'importing') {
        setIsArchivePolling(true)
      }
    }

    void loadInitialState()
  }, [])

  useEffect(() => {
    if (!archiveBatchId || !isArchivePolling) return

    let isActive = true
    let notReadyCount = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextPoll = () => {
      if (!isActive) return

      timeoutId = setTimeout(() => {
        void pollArchiveImportBatch()
      }, 2_000)
    }

    const pollArchiveImportBatch = async () => {
      try {
        const result = await getFitnessImportBatch(archiveBatchId)
        if (!isActive) return

        setArchiveBatchResult(result)
        if (result.status !== 'pending') {
          setIsArchivePolling(false)
          const activeImport = await syncActiveArchiveImportState({
            showLoadError: false
          })
          if (activeImport?.status === 'failed') {
            return
          }

          setArchiveMessage(
            result.status === 'completed'
              ? 'Strava archive import completed.'
              : 'Strava archive import finished with partial failures.'
          )
          setArchiveError('')
          return
        }
      } catch (pollError) {
        if (!isActive) return

        const isBatchNotReady =
          pollError instanceof ApiRequestError && pollError.status === 404
        const pollMessage =
          pollError instanceof Error
            ? pollError.message
            : 'Failed to load Strava archive import progress'

        if (
          isBatchNotReady &&
          notReadyCount < MAX_ARCHIVE_BATCH_NOT_READY_POLLS
        ) {
          notReadyCount += 1
          scheduleNextPoll()
          return
        }

        setArchiveError(pollMessage)
        setIsArchivePolling(false)
        return
      }

      scheduleNextPoll()
    }

    void pollArchiveImportBatch()

    return () => {
      isActive = false
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }, [archiveBatchId, isArchivePolling])

  const handleArchiveFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.currentTarget.files?.[0] ?? null
    if (!file) {
      setArchiveFile(null)
      return
    }

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setArchiveError('Please select a valid Strava export ZIP archive.')
      setArchiveFile(null)
      event.currentTarget.value = ''
      return
    }

    setArchiveError('')
    setArchiveFile(file)
  }

  const handleStartArchiveImport = async () => {
    if (!archiveFile || isArchiveControlsDisabled) {
      return
    }

    setArchiveError('')
    setArchiveMessage('')
    setArchiveBatchResult(null)
    setIsArchiveImporting(true)

    try {
      const result = await startStravaArchiveImport(
        archiveFile,
        archiveVisibility
      )
      setArchiveBatchId(result.batchId)
      setArchiveMessage(
        'Strava archive uploaded. Import started in the background.'
      )
      setArchiveFile(null)
      const activeImport = await syncActiveArchiveImportState({
        showLoadError: false
      })
      if (activeImport?.status === 'importing') {
        setIsArchivePolling(true)
      }
    } catch (archiveImportError) {
      const archiveImportMessage =
        archiveImportError instanceof Error
          ? archiveImportError.message
          : 'Failed to import Strava archive'
      setArchiveError(archiveImportMessage)
    } finally {
      setIsArchiveImporting(false)
    }
  }

  const handleRetryArchiveImport = async () => {
    if (activeArchiveImport?.status !== 'failed' || isArchiveActionLoading) {
      return
    }

    setArchiveError('')
    setArchiveMessage('')
    setIsArchiveActionLoading(true)

    try {
      const result = await retryStravaArchiveImport()
      setActiveArchiveImport(result.activeImport)
      if (result.activeImport) {
        setArchiveBatchId(result.activeImport.batchId)
      }
      setArchiveBatchResult(null)
      setIsArchivePolling(true)
      setArchiveMessage('Retrying Strava archive import...')
    } catch (retryError) {
      const retryMessage =
        retryError instanceof Error
          ? retryError.message
          : 'Failed to retry Strava archive import'
      setArchiveError(retryMessage)
    } finally {
      setIsArchiveActionLoading(false)
    }
  }

  const handleCancelArchiveImport = async () => {
    if (!activeArchiveImport || isArchiveActionLoading) {
      return
    }

    setArchiveError('')
    setArchiveMessage('')
    setIsArchiveActionLoading(true)

    try {
      await cancelStravaArchiveImport()
      setActiveArchiveImport(null)
      setArchiveFile(null)
      setIsArchivePolling(false)
      setArchiveBatchId(null)
      setArchiveMessage(
        'Cancelled remaining archive import. Already imported activities were kept.'
      )
    } catch (cancelError) {
      const cancelMessage =
        cancelError instanceof Error
          ? cancelError.message
          : 'Failed to cancel Strava archive import'
      setArchiveError(cancelMessage)
    } finally {
      setIsArchiveActionLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Import Strava Archive</h3>
        <p className="text-xs text-muted-foreground">
          Upload your Strava export <code>.zip</code>. This imports activities
          and attached media into local statuses.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Archive import always applies to {actorHandle || 'your current actor'}
          .
        </p>

        <Label htmlFor="archiveFile">Archive File</Label>
        <Input
          id="archiveFile"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={handleArchiveFileChange}
          disabled={isArchiveControlsDisabled}
        />
        {archiveFile && (
          <p className="text-xs text-muted-foreground">{archiveFile.name}</p>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Visibility:</span>
        <VisibilitySelector
          visibility={archiveVisibility}
          onVisibilityChange={setArchiveVisibility}
        />
      </div>

      {activeArchiveImport && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          <p>
            Active import batch:{' '}
            <span className="font-medium">{activeArchiveImport.batchId}</span>
          </p>
          <p>
            Status:{' '}
            <span className="font-medium">{activeArchiveImport.status}</span>
          </p>
          <p>
            Imported {activeArchiveImport.completedActivitiesCount}
            {activeArchiveImport.totalActivitiesCount
              ? `/${activeArchiveImport.totalActivitiesCount}`
              : ''}{' '}
            • Failed {activeArchiveImport.failedActivitiesCount}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={handleStartArchiveImport}
          disabled={!archiveFile || isArchiveControlsDisabled}
        >
          {isArchiveImporting ? 'Importing…' : 'Import archive'}
        </Button>
        {archiveBatchId && (
          <span className="text-xs text-muted-foreground">
            Batch: {archiveBatchId}
          </span>
        )}
        {activeArchiveImport?.status === 'failed' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleRetryArchiveImport}
              disabled={isArchiveActionLoading}
            >
              {isArchiveActionLoading ? 'Retrying…' : 'Retry and continue'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancelArchiveImport}
              disabled={isArchiveActionLoading}
            >
              {isArchiveActionLoading
                ? 'Cancelling…'
                : 'Cancel and remove archive'}
            </Button>
          </>
        )}
      </div>

      {archiveBatchResult && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          <p>
            Status:{' '}
            <span className="font-medium">{archiveBatchResult.status}</span>
          </p>
          <p>
            Completed {archiveBatchResult.summary.completed}/
            {archiveBatchResult.summary.total} • Failed{' '}
            {archiveBatchResult.summary.failed}
          </p>
          <p>
            View details in{' '}
            <Link href="/settings/fitness/general" className="underline">
              Fitness settings
            </Link>
            .
          </p>
        </div>
      )}

      {archiveError && (
        <p className="text-sm text-destructive">{archiveError}</p>
      )}
      {archiveMessage && (
        <p className="text-sm text-green-600">{archiveMessage}</p>
      )}
    </div>
  )
}
