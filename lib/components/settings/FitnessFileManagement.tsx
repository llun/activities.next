'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { deleteFitnessFile } from '@/lib/client'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Progress } from '@/lib/components/ui/progress'
import { getMentionFromActorID } from '@/lib/types/domain/actor'
import { formatFileSize } from '@/lib/utils/formatFileSize'

interface FitnessFileItem {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  mimeType: string
  bytes: number
  description?: string
  createdAt: number
  url: string
  statusId?: string
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

  useEffect(() => {
    setFitnessFiles(initialFitnessFiles)
    setCurrentUsed(used)
  }, [initialFitnessFiles, used])

  const getPostLink = useCallback((actorId: string, statusId: string) => {
    try {
      const actorMention = getMentionFromActorID(actorId, true)
      const encodedStatusId = encodeURIComponent(statusId)
      return `/${actorMention}/${encodedStatusId}`
    } catch {
      return null
    }
  }, [])

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

  const percentUsed = limit > 0 ? Math.min((currentUsed / limit) * 100, 100) : 0

  const handleItemsPerPageChange = (value: number) => {
    router.push(`/settings/fitness/general?limit=${value}&page=1`)
  }

  const goToPage = (page: number) => {
    router.push(`/settings/fitness/general?limit=${itemsPerPage}&page=${page}`)
  }

  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const hasNextPage = currentPage < totalPages
  const hasPreviousPage = currentPage > 1
  const startItem = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fitness Files</h1>
        <p className="text-sm text-muted-foreground">
          Manage your uploaded fitness files and storage quota.
        </p>
      </div>

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {itemsPerPage} per page
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleItemsPerPageChange(25)}>
                  25 per page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleItemsPerPageChange(50)}>
                  50 per page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleItemsPerPageChange(100)}>
                  100 per page
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                    ? getPostLink(fitnessFile.actorId, fitnessFile.statusId)
                    : null

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
                      </div>

                      <div className="flex gap-2">
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

              {totalItems > 0 && (
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages} • Showing {startItem}-
                    {endItem} of {totalItems} items
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={!hasPreviousPage}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={!hasNextPage}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
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
