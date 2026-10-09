'use client'

import { HardDrive, Image as ImageIcon, Music } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ReactNode, useEffect, useState } from 'react'

import { deleteAccountMedia } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import {
  FileListPagination,
  ItemsPerPageDropdown,
  getFileStatusLink
} from '@/lib/components/settings/fileManagementShared'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
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
  /** Media preferences shown between the page header and the storage card. */
  settings?: ReactNode
}

export function MediaManagement({
  used,
  limit,
  medias: initialMedias,
  currentPage,
  itemsPerPage,
  totalItems,
  settings
}: Props) {
  const router = useRouter()
  const [medias, setMedias] = useState(initialMedias)
  const [currentUsed, setCurrentUsed] = useState(used)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [mediaToDelete, setMediaToDelete] = useState<MediaItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setMedias(initialMedias)
    setCurrentUsed(used)
  }, [initialMedias, used])

  const handleDeleteClick = (media: MediaItem) => {
    setMediaToDelete(media)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!mediaToDelete) return

    setDeleting(true)
    try {
      await deleteAccountMedia({ mediaId: mediaToDelete.id })

      // Update local state
      setMedias(medias.filter((m) => m.id !== mediaToDelete.id))
      setCurrentUsed(currentUsed - mediaToDelete.bytes)
      setDeleteDialogOpen(false)
      setMediaToDelete(null)
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media"
        description="Describe and tag new media, and manage your uploads and storage quota."
      />

      {settings}

      <Section
        icon={HardDrive}
        title="Storage usage"
        description="Your current storage usage across all media."
      >
        <Frame className="space-y-1.5 px-4 py-4">
          <Progress value={percentUsed} aria-label="Storage quota used" />
          {/* Mono caption under the bar: what is used of the quota on the
              left, the share of it on the right. */}
          <div className="text-muted-foreground flex justify-between font-mono text-xs">
            <span>
              {formatFileSize(currentUsed)} / {formatFileSize(limit)}
            </span>
            <span>{percentUsed.toFixed(1)}%</span>
          </div>
        </Frame>
      </Section>

      <Section
        icon={ImageIcon}
        title="Your media"
        description="All media files you have uploaded."
        actions={
          <ItemsPerPageDropdown
            itemsPerPage={itemsPerPage}
            onChange={handleItemsPerPageChange}
          />
        }
      >
        {medias.length === 0 ? (
          <EmptyState icon={ImageIcon} title="No media uploaded yet">
            Photos and videos you attach to posts appear here, with the space
            they use.
          </EmptyState>
        ) : (
          <FramedList
            aria-label="Your media"
            footer={
              <FileListPagination
                className="mt-0 border-t-0 pt-0"
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                totalItems={totalItems}
                onPageChange={goToPage}
              />
            }
          >
            {medias.map((media) => {
              const isVideo = media.mimeType.startsWith('video')
              const isAudio = media.mimeType.startsWith('audio')
              const postLink = media.statusId
                ? getFileStatusLink(media.actorId, media.statusId)
                : null

              return (
                <FramedListItem
                  key={media.id}
                  className="flex items-center gap-4"
                >
                  {/* Square Preview */}
                  <div className="bg-muted size-20 flex-shrink-0 overflow-hidden rounded-md border">
                    {isVideo ? (
                      <video
                        src={media.url}
                        className="h-full w-full object-cover"
                        muted
                      />
                    ) : isAudio ? (
                      <div className="bg-muted flex h-full w-full items-center justify-center">
                        <Music
                          aria-hidden="true"
                          className="text-muted-foreground size-8"
                        />
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
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs break-all">
                        ID: {media.id}
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 text-xs">
                        {media.mimeType}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-sm">
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
                          className="text-primary-text text-xs hover:underline"
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
                </FramedListItem>
              )
            })}
          </FramedList>
        )}
      </Section>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete media</DialogTitle>
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
