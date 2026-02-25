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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

const MAX_ARCHIVE_BATCH_NOT_READY_POLLS = 90

export const StravaSettingsForm: FC = () => {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [isConfigured, setIsConfigured] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false)
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
  const [archiveActorHandle, setArchiveActorHandle] = useState('')
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
    const controller = new AbortController()
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/v1/settings/fitness/strava', {
          signal: controller.signal
        })
        const data = await response.json()

        if (data.configured) {
          setIsConfigured(true)
          setIsConnected(data.connected || false)
          setClientId(data.clientId)
          setClientSecret('••••••••')
          setWebhookUrl(data.webhookUrl || '')
        }
        if (
          typeof data.actorHandle === 'string' &&
          data.actorHandle.length > 0
        ) {
          setArchiveActorHandle(data.actorHandle)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError('Failed to load settings')
      }
    }

    const checkUrlParams = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('success') === 'true') {
        setMessage('Successfully connected to Strava!')
        setIsConnected(true)
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash
        )
      } else if (params.get('error')) {
        const errorType = params.get('error')
        setError(
          errorType === 'authorization_failed'
            ? 'Authorization was denied or failed'
            : errorType === 'webhook_subscription_failed'
              ? 'Failed to create webhook subscription. Please try again.'
              : 'Failed to connect to Strava'
        )
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash
        )
      }
    }

    const loadInitialState = async () => {
      await fetchSettings()
      checkUrlParams()
      const activeImport = await syncActiveArchiveImportState({
        showLoadError: true
      })
      if (activeImport?.status === 'importing') {
        setIsArchivePolling(true)
      }
    }

    void loadInitialState()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!archiveBatchId || !isArchivePolling) return

    let isActive = true
    let notReadyCount = 0
    let timeoutId: number | null = null

    const scheduleNextPoll = () => {
      if (!isActive) return

      timeoutId = window.setTimeout(() => {
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
        window.clearTimeout(timeoutId)
      }
    }
  }, [archiveBatchId, isArchivePolling])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/settings/fitness/strava', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clientId, clientSecret })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to save settings')
        return
      }

      setMessage('Redirecting to Strava for authorization...')
      setIsConfigured(true)
      setClientSecret('••••••••')

      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl
      }
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnlink = async () => {
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/settings/fitness/strava', {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to remove settings')
        return
      }

      setMessage('Settings removed successfully!')
      setIsConfigured(false)
      setIsConnected(false)
      setClientId('')
      setClientSecret('')
      setWebhookUrl('')
      setShowUnlinkDialog(false)
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

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
    <>
      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="clientId">Client ID</Label>
          <Input
            type="text"
            id="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isConfigured}
            required
            pattern="[0-9]+"
            title="Client ID must be numeric"
            placeholder="Enter your Strava Client ID"
          />
          <p className="text-[0.8rem] text-muted-foreground">
            Numeric ID from{' '}
            <a
              href="https://www.strava.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Strava API settings
            </a>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientSecret">Client Secret</Label>
          <Input
            type="password"
            id="clientSecret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={isConfigured}
            required
            placeholder="Enter your Strava Client Secret"
          />
          <p className="text-[0.8rem] text-muted-foreground">
            Secret key from your Strava application
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        {isConnected && (
          <div className="rounded-md bg-green-50 p-3 dark:bg-green-950">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              ✓ Connected to Strava
            </p>
          </div>
        )}

        {webhookUrl && (
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Webhook URL</Label>
            <Input
              type="text"
              id="webhookUrl"
              value={webhookUrl}
              readOnly
              className="bg-muted"
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Use this URL to configure Strava webhook subscriptions
            </p>
          </div>
        )}

        {isConfigured && !isConnected && (
          <div className="rounded-md bg-yellow-50 p-3 dark:bg-yellow-950">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              Credentials saved but not connected. Please reconnect.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={isLoading || isConfigured}>
            {isLoading ? 'Saving...' : 'Save'}
          </Button>

          <Button
            type="button"
            variant="destructive"
            disabled={!isConfigured || isLoading}
            onClick={() => setShowUnlinkDialog(true)}
          >
            Unlink
          </Button>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Import Strava Archive</h3>
            <p className="text-xs text-muted-foreground">
              Upload your Strava export <code>.zip</code>. This imports
              activities and attached media into local statuses.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Archive import always applies to{' '}
              {archiveActorHandle || 'your current actor'}.
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
              <p className="text-xs text-muted-foreground">
                {archiveFile.name}
              </p>
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
                <span className="font-medium">
                  {activeArchiveImport.batchId}
                </span>
              </p>
              <p>
                Status:{' '}
                <span className="font-medium">
                  {activeArchiveImport.status}
                </span>
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
      </form>

      <Dialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Strava Integration</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove your Strava integration? This will
              clear your Client ID and Client Secret. You will need to enter
              them again to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUnlinkDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnlink}
              disabled={isLoading}
            >
              {isLoading ? 'Unlinking...' : 'Unlink'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
