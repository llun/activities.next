'use client'

import {
  Archive,
  History,
  Images,
  MapPin,
  Pencil,
  Trash2,
  Video
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import { GalleryGearFormDialog } from '@/app/(timeline)/gallery/gear/GalleryGearFormDialog'
import {
  formatGearDay,
  getGearBrandModel,
  getGearHref
} from '@/app/(timeline)/gallery/gear/galleryGearUi'
import { deleteGalleryGear, setGalleryGearRetired } from '@/lib/client'
import { BackLink } from '@/lib/components/back-link'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import { formatCountryCount } from '@/lib/components/gallery/galleryTaxonomy'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
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
import { formatInteger } from '@/lib/fitness/calendar/format'
import type {
  GalleryGearEntity,
  GalleryGearWithUsageEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'

interface Props {
  ownerId: string
  gear: GalleryGearWithUsageEntity
  mostUsedWith: { gear: GalleryGearEntity; count: number }[]
  initialPage: GalleryMediaPage
}

const getMetaParts = (gear: GalleryGearWithUsageEntity): string[] => {
  const brandModel = getGearBrandModel(gear)
  return [
    // The title already reads this when the gear has no nickname.
    brandModel && brandModel !== gear.name ? brandModel : null,
    gear.kind,
    `added ${formatGearDay(gear.createdAt)}`,
    gear.firstUsedAt === null
      ? null
      : `first photo ${formatGearDay(gear.firstUsedAt)}`,
    gear.lastUsedAt === null
      ? null
      : `last photo ${formatGearDay(gear.lastUsedAt)}`
  ].filter((part): part is string => part !== null)
}

export const GalleryGearDetailView: FC<Props> = ({
  ownerId,
  gear,
  mostUsedWith,
  initialPage
}) => {
  const router = useRouter()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isRetiring, setIsRetiring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const isRetired = gear.retiredAt !== null
  const noun = gear.kind === 'camera' ? 'camera' : 'lens'

  const handleToggleRetired = async () => {
    setIsRetiring(true)
    setError(null)
    try {
      await setGalleryGearRetired(gear.id, !isRetired)
      router.refresh()
    } catch (retireError) {
      setError(
        retireError instanceof Error
          ? retireError.message
          : 'Failed to update gear.'
      )
    } finally {
      setIsRetiring(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteGalleryGear(gear.id)
      router.push('/gallery/gear')
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : 'Failed to delete gear.'
      )
      setIsDeleting(false)
    }
  }

  const handleDeleteOpenChange = (open: boolean) => {
    if (isDeleting) return
    setIsDeleteOpen(open)
    if (!open) setDeleteError(null)
  }

  return (
    <div className="space-y-6">
      <BackLink href="/gallery/gear" accessibleName="Back to gear" />

      <PageHeader
        className="mb-4"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {gear.name}
            {isRetired && <Badge tone="gray">retired</Badge>}
          </span>
        }
        description={
          <div className="text-xs [&_a]:align-top">
            <span>{getMetaParts(gear).join(' · ')}</span>
            {gear.productUrl && (
              <>
                <span aria-hidden="true"> · </span>
                <GearProductLink productUrl={gear.productUrl} />
              </>
            )}
          </div>
        }
      />

      {error && <Alert title={error} />}

      <div className="space-y-4">
        {/* `photoCount` is every gallery item (it matches the grid below), so
            the photos are what is left of it once the videos are taken out.
            The first and last use are in the header line. */}
        <StatStrip variant="summary" columns={3}>
          <StatCell
            label="Photos"
            icon={Images}
            value={formatInteger(
              Math.max(gear.photoCount - gear.videoCount, 0)
            )}
          />
          <StatCell
            label="Videos"
            icon={Video}
            value={formatInteger(gear.videoCount)}
          />
          <StatCell
            label="Places"
            icon={MapPin}
            value={
              gear.countryCount === null
                ? null
                : formatCountryCount(gear.countryCount)
            }
          />
        </StatStrip>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditOpen(true)}
          >
            <Pencil />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleRetired}
            disabled={isRetiring || isDeleting}
          >
            {isRetired ? <History /> : <Archive />}
            {isRetired ? 'Unretire' : 'Retire'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive-text"
            onClick={() => setIsDeleteOpen(true)}
            disabled={isRetiring || isDeleting}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <Section
        title={`Taken with this ${noun}`}
        icon={Images}
        meta={`${formatInteger(gear.photoCount)} ${gear.photoCount === 1 ? 'item' : 'items'}`}
      >
        {initialPage.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in your gallery was taken with this {noun} yet.
          </p>
        ) : (
          <GalleryPagedGrid
            key={gear.id}
            actorId={ownerId}
            gearId={gear.id}
            initialPage={initialPage}
            showCaption={false}
            albumsOwnerId={ownerId}
          />
        )}
      </Section>

      {mostUsedWith.length > 0 && (
        <Section title="Most used with">
          <ul className="flex flex-wrap gap-2">
            {mostUsedWith.map(({ gear: paired, count }) => (
              <li key={paired.id}>
                <Link
                  href={getGearHref(paired.id)}
                  prefetch={false}
                  className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium hover:bg-muted"
                >
                  {paired.name} · {formatInteger(count)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isEditOpen && (
        <GalleryGearFormDialog
          open
          kind={gear.kind}
          gear={gear}
          onOpenChange={setIsEditOpen}
          onSaved={() => router.refresh()}
        />
      )}

      <Dialog open={isDeleteOpen} onOpenChange={handleDeleteOpenChange}>
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>Delete {gear.name}?</DialogTitle>
            <DialogDescription>
              Your photos stay in the gallery, but will no longer be linked to
              this {noun}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <Alert title={deleteError} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDeleteOpenChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete gear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
