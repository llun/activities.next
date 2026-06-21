'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { deleteFitnessFile, retryFitnessImportBatch } from '@/lib/client'
import {
  FileListPagination,
  ItemsPerPageDropdown,
  getFileStatusLink
} from '@/lib/components/settings/fileManagementShared'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Progress } from '@/lib/components/ui/progress'
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
  importBatchId?: string
}

interface Props {
  used: number
  limit: number
  fitnessFiles: FitnessFileItem[]
  currentPage: number
  itemsPerPage: number
  totalItems: number
}

export function FitnessFileManagement({
  used,
  limit,
  fitnessFiles: initialFitnessFiles,
  currentPage,
  itemsPerPage,
  totalItems
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

  useEffect(() => {
    setFitnessFiles(initialFitnessFiles)
    setCurrentUsed(used)
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
      // retries re-derive the activity's real visibility server-side). The
      // original choice is not stored on the file, so retry with the safe,
      // non-publicizing `private` rather than risk re-publishing an originally
      // unlisted/private post as public. The import runs asynchronously on the
      // queue, so refresh to pick up the new status.
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

  const percentUsed = limit > 0 ? Math.min((currentUsed / limit) * 100, 100) : 0

  const handleItemsPerPageChange = (value: number) => {
    router.push(`/fitness/files?limit=${value}&page=1`)
  }

  const goToPage = (page: number) => {
    router.push(`/fitness/files?limit=${itemsPerPage}&page=${page}`)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Storage Usage</CardTitle>
          <CardDescription>
            Fitness files share quota with media uploads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Used</span>
              <span className="font-medium">
                {formatFileSize(currentUsed)} / {formatFileSize(limit)}
              </span>
            </div>
            <Progress value={percentUsed} />
            <p className="text-xs text-muted-foreground">
              {percentUsed.toFixed(1)}% of your storage quota used by fitness
              files
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Fitness Files</CardTitle>
              <CardDescription>
                All fitness activity files you have uploaded
              </CardDescription>
            </div>
            <ItemsPerPageDropdown
              itemsPerPage={itemsPerPage}
              onChange={handleItemsPerPageChange}
            />
          </div>
        </CardHeader>
        <CardContent>
          {fitnessFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fitness files uploaded yet.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {fitnessFiles.map((fitnessFile) => {
                  const postLink = fitnessFile.statusId
                    ? getFileStatusLink(
                        fitnessFile.actorId,
                        fitnessFile.statusId
                      )
                    : null
                  const importFailed = fitnessFile.importStatus === 'failed'
                  const retryBatchId = importFailed
                    ? fitnessFile.importBatchId
                    : undefined
                  const retryQueued = Boolean(
                    retryBatchId && queuedBatchIds.has(retryBatchId)
                  )

                  return (
                    <div
                      key={fitnessFile.id}
                      className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {fitnessFile.fileName}
                          </span>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs uppercase">
                            {fitnessFile.fileType}
                          </span>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          ID: {fitnessFile.id}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {fitnessFile.mimeType} •{' '}
                          {formatFileSize(fitnessFile.bytes)} •{' '}
                          {new Date(fitnessFile.createdAt).toLocaleString()}
                        </div>
                        {fitnessFile.description && (
                          <div className="text-sm">
                            {fitnessFile.description}
                          </div>
                        )}
                        {postLink && (
                          <div className="pt-1">
                            <Link
                              href={postLink}
                              className="text-xs text-primary hover:underline"
                            >
                              View in post →
                            </Link>
                          </div>
                        )}
                        {importFailed && (
                          <div className="space-y-1 pt-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                                Import failed
                              </span>
                              {retryQueued && (
                                <span className="text-xs text-muted-foreground">
                                  Retry queued — refresh to see the result.
                                </span>
                              )}
                            </div>
                            {fitnessFile.importError && (
                              <p className="text-xs text-destructive">
                                {fitnessFile.importError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
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
                            Download
                          </a>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteClick(fitnessFile)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {retryError && (
                <p className="pt-3 text-sm text-destructive">{retryError}</p>
              )}

              <FileListPagination
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                totalItems={totalItems}
                onPageChange={goToPage}
              />
            </>
          )}
        </CardContent>
      </Card>

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
