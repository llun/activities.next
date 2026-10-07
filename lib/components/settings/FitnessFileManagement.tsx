'use client'

import {
  Download,
  FileUp,
  Files,
  Gauge,
  HardDrive,
  RefreshCw,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useEffect, useState } from 'react'

import { useViewerTimeZone } from '@/app/(timeline)/fitness/useViewerTimeZone'
import {
  deleteFitnessFile,
  retryAllFitnessImports,
  retryFitnessImportBatch
} from '@/lib/client'
import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { FitnessSection } from '@/lib/components/fitness/FitnessSection'
import {
  FITNESS_STAT_STRIP_CLASS,
  FitnessStatCell
} from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import {
  FileListPagination,
  ItemsPerPageDropdown,
  getFileStatusLink
} from '@/lib/components/settings/fileManagementShared'
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
import { Progress } from '@/lib/components/ui/progress'
import { formatInteger } from '@/lib/fitness/calendar/format'
import { formatFileSize } from '@/lib/utils/formatFileSize'

interface FitnessFileItem {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx' | 'zip'
  mimeType: string
  bytes: number
  description?: string
  createdAt: number
  url: string
  statusId?: string
  importStatus?: 'pending' | 'completed' | 'failed'
  importError?: string | null
  // Why this file's route map is missing. Separate from importError: the
  // activity itself imported fine. This page is the owner's own file list, so
  // it is the one surface that shows the reason rather than just the fact.
  mapError?: string | null
  // Whether a map exists despite `mapError` — a failed REgeneration keeps the
  // previous one, so the copy must not claim there is none.
  hasMapData?: boolean
  // A non-primary file (the second device of a merged same-ride post) never
  // owns the status's map, so a reason left on one is not actionable: the retry
  // the post offers deliberately skips it.
  isPrimary?: boolean
  importBatchId?: string
}

interface Props {
  used: number
  limit: number
  fitnessFiles: FitnessFileItem[]
  // Computed server-side across ALL the actor's files (failed import / failed
  // processing / stuck processing), so the "Retry all failed" button stays
  // visible even when the retriable files are on another page. Defaults to a
  // fail-safe `false` (button hidden) when not provided.
  hasRetriableImport?: boolean
  currentPage: number
  itemsPerPage: number
  totalItems: number
  /** The import section, rendered between the storage strip and the list. */
  children?: ReactNode
}

/**
 * When the file was uploaded, in the viewer's own zone. The zone is unknown on
 * the server and during hydration, so those renders use UTC and the first
 * client render switches; `toLocaleString()` in render used to give the
 * server's zone and the browser's a different string, a hydration mismatch.
 */
const FileUploadedAt: FC<{ createdAt: number }> = ({ createdAt }) => {
  const timeZone = useViewerTimeZone() ?? 'UTC'
  return (
    <time dateTime={new Date(createdAt).toISOString()}>
      {new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone
      }).format(createdAt)}
    </time>
  )
}

export function FitnessFileManagement({
  used,
  limit,
  fitnessFiles: initialFitnessFiles,
  hasRetriableImport = false,
  currentPage,
  itemsPerPage,
  totalItems,
  children
}: Props) {
  const router = useRouter()
  const [fitnessFiles, setFitnessFiles] = useState(initialFitnessFiles)
  const [currentUsed, setCurrentUsed] = useState(used)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FitnessFileItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null)
  const [queuedBatchIds, setQueuedBatchIds] = useState<Set<string>>(new Set())
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)

  useEffect(() => {
    setFitnessFiles(initialFitnessFiles)
    setCurrentUsed(used)
    // Drop the "retry queued" flag for any batch that is still failing in the
    // refreshed data, so its Retry button reappears instead of being stuck on
    // "Retry queued" forever when a retry did not clear the failure.
    setQueuedBatchIds((prev) => {
      if (prev.size === 0) return prev
      const stillFailingBatchIds = new Set(
        initialFitnessFiles
          .filter(
            (file) => file.importStatus === 'failed' && file.importBatchId
          )
          .map((file) => file.importBatchId as string)
      )
      const next = new Set(
        [...prev].filter((batchId) => !stillFailingBatchIds.has(batchId))
      )
      return next.size === prev.size ? prev : next
    })
  }, [initialFitnessFiles, used])

  const handleDeleteClick = (fitnessFile: FitnessFileItem) => {
    setFileToDelete(fitnessFile)
    setDeleteError(null)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!fileToDelete) return

    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteFitnessFile(fileToDelete.id)

      setFitnessFiles((prev) =>
        prev.filter((file) => file.id !== fileToDelete.id)
      )
      setCurrentUsed((prev) => Math.max(0, prev - fileToDelete.bytes))
      setDeleteDialogOpen(false)
      setFileToDelete(null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to delete fitness file. Please check your connection and try again.'
      setDeleteError(message)
    } finally {
      setDeleting(false)
    }
  }

  const handleRetryImport = async (batchId: string) => {
    if (retryingBatchId) return

    setRetryingBatchId(batchId)
    setRetryError(null)
    try {
      // Visibility is only consulted for manual-upload batches (Strava-activity
      // retries use the account's configured default visibility from fitness
      // settings). The original choice is not stored on the file, so retry
      // with the safe, non-publicizing `private` rather than risk
      // re-publishing an originally unlisted/private post as public. The
      // import runs asynchronously on the queue, so refresh to pick up the new
      // status.
      await retryFitnessImportBatch(batchId, 'private')
      setQueuedBatchIds((prev) => new Set(prev).add(batchId))
      router.refresh()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to retry import. Please try again.'
      setRetryError(message)
    } finally {
      setRetryingBatchId(null)
    }
  }

  const handleRetryAllFailed = async () => {
    if (retryingAll) return

    setRetryingAll(true)
    setRetryError(null)
    try {
      // Requeues every failed/stuck fitness import for the actor in one call so
      // a burst of failed Strava activities doesn't need a per-post retry. The
      // imports run asynchronously on the queue, so refresh to pick up the new
      // statuses.
      await retryAllFitnessImports()
      router.refresh()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to retry imports. Please try again.'
      setRetryError(message)
    } finally {
      setRetryingAll(false)
    }
  }

  const percentUsed = limit > 0 ? Math.min((currentUsed / limit) * 100, 100) : 0

  const handleItemsPerPageChange = (value: number) => {
    router.push(`/fitness/files?limit=${value}&page=1`)
  }

  const goToPage = (page: number) => {
    router.push(`/fitness/files?limit=${itemsPerPage}&page=${page}`)
  }

  return (
    <div className="space-y-6">
      <FitnessSection
        title="Storage"
        description="Fitness files share quota with media uploads."
      >
        <div className="space-y-2">
          <FitnessStatGrid
            variant="summary"
            columns={3}
            className={FITNESS_STAT_STRIP_CLASS}
          >
            <FitnessStatCell
              label="Used"
              icon={HardDrive}
              value={formatFileSize(currentUsed)}
            />
            <FitnessStatCell
              label="Quota"
              icon={Gauge}
              value={formatFileSize(limit)}
            />
            <FitnessStatCell
              label="Fitness files"
              icon={Files}
              value={formatInteger(totalItems)}
            />
          </FitnessStatGrid>
          <Progress
            value={percentUsed}
            aria-label="Storage quota used by fitness files"
          />
          <p className="text-muted-foreground text-xs tabular-nums">
            {percentUsed.toFixed(1)}% of your quota used
          </p>
        </div>
      </FitnessSection>

      {children}

      <FitnessSection
        title="Files"
        meta={`${formatInteger(totalItems)} ${totalItems === 1 ? 'file' : 'files'}`}
        actions={
          <>
            {hasRetriableImport ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryAllFailed}
                disabled={retryingAll}
              >
                <RefreshCw aria-hidden="true" />
                {retryingAll ? 'Retrying…' : 'Retry all failed'}
              </Button>
            ) : null}
            <ItemsPerPageDropdown
              itemsPerPage={itemsPerPage}
              onChange={handleItemsPerPageChange}
            />
          </>
        }
      >
        {retryError && (
          <FitnessAlert title="We couldn’t retry the import">
            {retryError}
          </FitnessAlert>
        )}
        {fitnessFiles.length === 0 ? (
          <FitnessEmptyState
            icon={FileUp}
            title="No fitness files uploaded yet."
          >
            Import a FIT, GPX, or TCX file above, or connect Strava, and its
            source file is kept here.
          </FitnessEmptyState>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {fitnessFiles.map((fitnessFile) => {
                const postLink = fitnessFile.statusId
                  ? getFileStatusLink(fitnessFile.actorId, fitnessFile.statusId)
                  : null
                const importFailed = fitnessFile.importStatus === 'failed'
                const retryBatchId = importFailed
                  ? fitnessFile.importBatchId
                  : undefined
                const retryQueued = Boolean(
                  retryBatchId && queuedBatchIds.has(retryBatchId)
                )

                return (
                  <li
                    key={fitnessFile.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium break-all">
                          {fitnessFile.fileName}
                        </span>
                        <Badge tone="gray" className="uppercase">
                          {fitnessFile.fileType}
                        </Badge>
                        {importFailed && (
                          <Badge tone="destructive">Import failed</Badge>
                        )}
                        {fitnessFile.mapError &&
                          !importFailed &&
                          fitnessFile.isPrimary !== false && (
                            // Muted, not destructive: the activity imported —
                            // only its route map is wrong. Retrying is offered
                            // on the post itself.
                            <Badge tone="gray">
                              {fitnessFile.hasMapData
                                ? 'Route map out of date'
                                : 'No route map'}
                            </Badge>
                          )}
                      </div>
                      {/* One muted line of facts. The ID stays: it is what the
                          fitness maintenance scripts take. */}
                      <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs tabular-nums">
                        <span>{formatFileSize(fitnessFile.bytes)}</span>
                        <span aria-hidden="true">·</span>
                        <FileUploadedAt createdAt={fitnessFile.createdAt} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono break-all">
                          ID: {fitnessFile.id}
                        </span>
                      </div>
                      {fitnessFile.description && (
                        <div className="text-sm">{fitnessFile.description}</div>
                      )}
                      {importFailed &&
                        (retryQueued || fitnessFile.importError) && (
                          <div className="space-y-0.5 text-xs">
                            {retryQueued && (
                              <p className="text-muted-foreground">
                                Retry queued — refresh to see the result.
                              </p>
                            )}
                            {fitnessFile.importError && (
                              <p className="text-destructive-text break-words">
                                {fitnessFile.importError}
                              </p>
                            )}
                          </div>
                        )}
                      {fitnessFile.mapError &&
                        !importFailed &&
                        fitnessFile.isPrimary !== false && (
                          <p className="text-muted-foreground text-xs break-words">
                            {fitnessFile.mapError}
                          </p>
                        )}
                      {postLink && (
                        <Link
                          href={postLink}
                          className="text-primary-text inline-block text-xs hover:underline"
                        >
                          View in post →
                        </Link>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {retryBatchId && !retryQueued && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetryImport(retryBatchId)}
                          disabled={retryingBatchId !== null}
                        >
                          {retryingBatchId === retryBatchId
                            ? 'Retrying…'
                            : 'Retry import'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <a href={fitnessFile.url} download>
                          <Download aria-hidden="true" />
                          Download
                        </a>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        onClick={() => handleDeleteClick(fitnessFile)}
                      >
                        <Trash2 aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <FileListPagination
              currentPage={currentPage}
              itemsPerPage={itemsPerPage}
              totalItems={totalItems}
              onPageChange={goToPage}
            />
          </>
        )}
      </FitnessSection>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Fitness File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this fitness file? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {fileToDelete && (
            <div className="rounded-lg border p-4">
              <div className="text-sm">
                <div className="font-medium">{fileToDelete.fileName}</div>
                <div className="text-muted-foreground">
                  {fileToDelete.fileType.toUpperCase()} •{' '}
                  {formatFileSize(fileToDelete.bytes)}
                </div>
              </div>
            </div>
          )}
          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteError(null)
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
