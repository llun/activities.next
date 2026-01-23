'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

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
import { getMentionFromActorID } from '@/lib/models/actor'
import { formatFileSize } from '@/lib/utils/formatFileSize'

interface MediaItem {
  id: string
  actorId: string
  bytes: number
  mimeType: string
  width: number
  height: number
  description?: string
  url: string
  statusId?: string
}

interface Props {
  used: number
  limit: number
  medias: MediaItem[]
  currentPage: number
  itemsPerPage: number
  totalItems: number
}

export function MediaManagement({
  used,
  limit,
  medias: initialMedias,
  currentPage,
  itemsPerPage,
  totalItems
}: Props) {
  const router = useRouter()
  const [medias, setMedias] = useState(initialMedias)
  const [currentUsed, setCurrentUsed] = useState(used)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [mediaToDelete, setMediaToDelete] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const getPostLink = useCallback((actorId: string, statusId: string) => {
    try {
      const actorMention = getMentionFromActorID(actorId, true)
      const encodedStatusId = encodeURIComponent(statusId)
      return `/${actorMention}/${encodedStatusId}`
    } catch {
      return null
    }
  }, [])

  const handleDeleteClick = (media: MediaItem) => {
    setMediaToDelete(media)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!mediaToDelete) return

    setDeleting(true)
    try {
      const response = await fetch(
        `/api/v1/accounts/media/${mediaToDelete.id}`,
        {
          method: 'DELETE'
        }
      )

      if (response.ok) {
        // Update local state
        setMedias(medias.filter((m) => m.id !== mediaToDelete.id))
        setCurrentUsed(currentUsed - mediaToDelete.bytes)
        setDeleteDialogOpen(false)
        setMediaToDelete(null)
      }
    } catch {
      // Silently fail on network errors or API failures - user will see media is still present
    } finally {
      setDeleting(false)
    }
  }

  const percentUsed = (currentUsed / limit) * 100

  const handleItemsPerPageChange = (value: number) => {
    router.push(`/settings/media?limit=${value}&page=1`)
  }

  const goToPage = (page: number) => {
    router.push(`/settings/media?limit=${itemsPerPage}&page=${page}`)
  }

  // Calculate pagination based on total items
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const hasNextPage = currentPage < totalPages
  const hasPreviousPage = currentPage > 1
  const startItem = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Media Storage</h1>
        <p className="text-sm text-muted-foreground">
          Manage your media uploads and storage quota.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Storage Usage</CardTitle>
          <CardDescription>
            Your current storage usage across all media
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
              {percentUsed.toFixed(1)}% of your storage quota used
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Media</CardTitle>
              <CardDescription>
                All media files you have uploaded
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
          {medias.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No media uploaded yet.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {medias.map((media) => {
                  const isVideo = media.mimeType.startsWith('video')
                  const isAudio = media.mimeType.startsWith('audio')
                  const postLink = media.statusId
                    ? getPostLink(media.actorId, media.statusId)
                    : null

                  return (
                    <div
                      key={media.id}
                      className="flex items-center gap-4 rounded-lg border p-4"
                    >
                      {/* Square Preview */}
                      <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                        {isVideo ? (
                          <video
                            src={media.url}
                            className="h-full w-full object-cover"
                            muted
                          />
                        ) : isAudio ? (
                          <div className="flex h-full w-full items-center justify-center bg-muted">
                            <svg
                              className="h-8 w-8 text-muted-foreground"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                              />
                            </svg>
                          </div>
                        ) : (
                          <img
                            src={media.url}
                            alt={media.description || 'Media'}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>

                      {/* Media Info */}
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            ID: {media.id}
                          </span>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                            {media.mimeType}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {media.width} × {media.height} •{' '}
                          {formatFileSize(media.bytes)}
                        </div>
                        {media.description && (
                          <div className="text-sm">{media.description}</div>
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

                      {/* Delete Button */}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteClick(media)}
                      >
                        Delete
                      </Button>
                    </div>
                  )
                })}
              </div>

              {/* Pagination Controls */}
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
            <DialogTitle>Delete Media</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this media? This action cannot be
              undone. Posts containing this media will show a placeholder image.
            </DialogDescription>
          </DialogHeader>
          {mediaToDelete && (
            <div className="rounded-lg border p-4">
              <div className="text-sm">
                <div className="font-medium">Media ID: {mediaToDelete.id}</div>
                <div className="text-muted-foreground">
                  {mediaToDelete.mimeType} •{' '}
                  {formatFileSize(mediaToDelete.bytes)}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
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
