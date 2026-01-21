'use client'

import { useState } from 'react'

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

interface MediaItem {
  id: string
  actorId: string
  bytes: number
  mimeType: string
  width: number
  height: number
  description?: string
}

interface Props {
  used: number
  limit: number
  medias: MediaItem[]
}

export function MediaManagement({ used, limit, medias: initialMedias }: Props) {
  const [medias, setMedias] = useState(initialMedias)
  const [currentUsed, setCurrentUsed] = useState(used)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [mediaToDelete, setMediaToDelete] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState(false)

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
      } else {
        console.error('Failed to delete media')
      }
    } catch (error) {
      console.error('Error deleting media:', error)
    } finally {
      setDeleting(false)
    }
  }

  const percentUsed = (currentUsed / limit) * 100

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
          <CardTitle>Your Media ({medias.length})</CardTitle>
          <CardDescription>
            All media files you have uploaded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {medias.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No media uploaded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {medias.map((media) => (
                <div
                  key={media.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
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
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteClick(media)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
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
                  {mediaToDelete.mimeType} • {formatFileSize(mediaToDelete.bytes)}
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
