'use client'

import { Aperture, Camera, Pencil, Plus, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  GEAR_TABLE_SCROLLER,
  STICKY_CLICKABLE_COLUMN,
  STICKY_COLUMN,
  STICKY_HEAD_CELL
} from '@/app/(timeline)/fitness/gear/gearUi'
import { getGalleryGearsWithUsage } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Section } from '@/lib/components/surface/Section'
import { TABLE_HEAD_ROW_CLASS } from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import type { GalleryGearWithUsageEntity } from '@/lib/services/gallery/galleryEntities'
import type { GalleryGearKind } from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import { GalleryGearFormDialog } from './GalleryGearFormDialog'
import { getGearHref, getGearSubline, getGearUsedLabel } from './galleryGearUi'

interface KindCopy {
  sectionTitle: string
  columnHeader: string
  addLabel: string
  emptyTitle: string
  emptyState: string
  retiredCountLabel: (count: number) => string
  hideRetiredLabel: (count: number) => string
}

const KIND_COPY: Record<GalleryGearKind, KindCopy> = {
  camera: {
    sectionTitle: 'Cameras',
    columnHeader: 'Camera',
    addLabel: 'Add camera',
    emptyTitle: 'No cameras yet.',
    emptyState:
      'Upload a photo and its camera is added for you, or add one by hand.',
    retiredCountLabel: (count) =>
      `${count} retired camera${count === 1 ? '' : 's'}`,
    hideRetiredLabel: (count) =>
      `Hide ${count} retired camera${count === 1 ? '' : 's'}`
  },
  lens: {
    sectionTitle: 'Lenses',
    columnHeader: 'Lens',
    addLabel: 'Add lens',
    emptyTitle: 'No lenses yet.',
    emptyState:
      'Upload a photo and its lens is added for you, or add one by hand.',
    retiredCountLabel: (count) =>
      `${count} retired lens${count === 1 ? '' : 'es'}`,
    hideRetiredLabel: (count) =>
      `Hide ${count} retired lens${count === 1 ? '' : 'es'}`
  }
}

const KIND_ICON = { camera: Camera, lens: Aperture }

const GearActionsCell: FC<{
  gear: GalleryGearWithUsageEntity
  onEdit: (gear: GalleryGearWithUsageEntity) => void
}> = ({ gear, onEdit }) => (
  <td className={cn('px-2 py-3 align-middle', gear.retiredAt && 'opacity-60')}>
    {/* The label shows only where its own cell has room; a container query
        answers that, a viewport breakpoint cannot (the table's width follows
        the side navigation as much as the viewport). */}
    <div className="@container flex w-full justify-center">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          onEdit(gear)
        }}
        aria-label={`Edit ${gear.name}`}
      >
        <Pencil className="size-3.5" />
        <span className="sr-only @min-[4rem]:not-sr-only">Edit</span>
      </Button>
    </div>
  </td>
)

interface SectionProps {
  kind: GalleryGearKind
  gears: GalleryGearWithUsageEntity[]
  onAdd: (kind: GalleryGearKind) => void
  onEdit: (gear: GalleryGearWithUsageEntity) => void
}

const GearSection: FC<SectionProps> = ({ kind, gears, onAdd, onEdit }) => {
  const router = useRouter()
  const [showRetired, setShowRetired] = useState(false)

  const copy = KIND_COPY[kind]
  const KindIcon = KIND_ICON[kind]
  const active = gears.filter((gear) => !gear.retiredAt)
  const retired = gears.filter((gear) => gear.retiredAt)
  const visible = showRetired ? [...active, ...retired] : active

  return (
    <Section
      title={copy.sectionTitle}
      icon={KindIcon}
      meta={`${active.length} active`}
      actions={
        <Button variant="outline" size="sm" onClick={() => onAdd(kind)}>
          <Plus />
          {copy.addLabel}
        </Button>
      }
    >
      {visible.length === 0 ? (
        <EmptyState icon={KindIcon} title={copy.emptyTitle}>
          {copy.emptyState}
        </EmptyState>
      ) : (
        <div className={GEAR_TABLE_SCROLLER}>
          {/* Below `sm` the table is compact: Product page and Used drop out
              (Used moves under the name), so Photos and Edit stay on a phone
              screen instead of scrolling away. From `sm` it is the full
              560px table. */}
          <table className="w-full table-fixed text-sm sm:min-w-[560px]">
            <colgroup>
              <col className="sm:w-[33.5%]" />
              <col className="hidden sm:table-column sm:w-[22.5%]" />
              <col className="hidden sm:table-column sm:w-[19.5%]" />
              <col className="w-16 sm:w-[14.5%]" />
              <col className="w-14 sm:w-[10%]" />
            </colgroup>
            <thead>
              <tr className={TABLE_HEAD_ROW_CLASS}>
                <th
                  className={cn(
                    STICKY_COLUMN,
                    STICKY_HEAD_CELL,
                    'px-3 py-2.5 font-medium sm:min-w-[150px] sm:px-4'
                  )}
                >
                  {copy.columnHeader}
                </th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">
                  Product page
                </th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">
                  Used
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Photos</th>
                <th className="px-2 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((gear) => {
                const subline = getGearSubline(gear)
                const dim = gear.retiredAt && 'opacity-60'
                return (
                  <tr
                    key={gear.id}
                    className="group cursor-pointer border-t hover:bg-muted"
                    onClick={() => router.push(getGearHref(gear.id))}
                  >
                    <td
                      className={cn(
                        STICKY_CLICKABLE_COLUMN,
                        'px-3 py-3 align-top sm:min-w-[150px] sm:px-4'
                      )}
                    >
                      {/* Retired gear dims its contents rather than the row:
                          fading the row would take the pinned column's own
                          background down with it. */}
                      <div className={cn(dim)}>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* A real link so the row is reachable by keyboard;
                              the row's own onClick is a pointer affordance. */}
                          <Link
                            href={getGearHref(gear.id)}
                            prefetch={false}
                            className="font-medium hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {gear.name}
                          </Link>
                          {gear.retiredAt && <Badge tone="gray">retired</Badge>}
                        </div>
                        {subline && (
                          <div className="text-xs text-muted-foreground">
                            {subline}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground sm:hidden">
                          Used {getGearUsedLabel(gear)}
                        </div>
                      </div>
                    </td>
                    <td
                      className={cn(
                        'hidden px-3 py-3 align-middle text-xs text-muted-foreground truncate sm:table-cell',
                        dim
                      )}
                    >
                      <GearProductLink
                        productUrl={gear.productUrl}
                        onEdit={() => onEdit(gear)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td
                      className={cn(
                        'hidden px-3 py-3 align-middle text-xs text-muted-foreground whitespace-nowrap sm:table-cell',
                        dim
                      )}
                    >
                      {getGearUsedLabel(gear)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 text-right align-middle font-semibold tabular-nums',
                        dim
                      )}
                    >
                      {gear.photoCount}
                    </td>
                    <GearActionsCell gear={gear} onEdit={onEdit} />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {retired.length > 0 && (
        <div>
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-primary-text hover:underline"
            aria-expanded={showRetired}
            onClick={() => setShowRetired((current) => !current)}
          >
            {showRetired
              ? copy.hideRetiredLabel(retired.length)
              : `Show ${copy.retiredCountLabel(retired.length)}`}
          </button>
        </div>
      )}
    </Section>
  )
}

export const GearListSkeleton: FC = () => (
  <div className="space-y-6">
    <p role="status" className="sr-only">
      Loading gear
    </p>
    {[0, 1].map((section) => (
      <div key={section} aria-hidden="true" className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="block h-5 w-16 rounded skeleton" />
          <span className="ml-auto block h-8 w-24 rounded-md skeleton" />
        </div>
        <div className="rounded-lg border">
          <div className="bg-muted/40 h-9 border-b" />
          {[0, 1].map((row) => (
            <div
              key={row}
              className="flex items-center gap-6 border-b px-4 py-4 last:border-b-0"
            >
              <span className="block h-3.5 w-1/3 max-w-40 rounded skeleton" />
              <span className="ml-auto block h-3.5 w-16 rounded skeleton" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
)

export const GalleryGearListView: FC = () => {
  const [gears, setGears] = useState<GalleryGearWithUsageEntity[]>([])
  // Only the first load blanks the page. A refetch keeps the sections mounted
  // and merely marks them busy, so a save does not collapse each section's
  // "Show N retired" toggle.
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dialogKind, setDialogKind] = useState<GalleryGearKind | null>(null)
  const [editingGear, setEditingGear] =
    useState<GalleryGearWithUsageEntity | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsRefreshing(true)

    getGalleryGearsWithUsage()
      .then((list) => {
        if (cancelled) return
        setGears(list)
        setError(null)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load gear.'
        )
      })
      .finally(() => {
        if (cancelled) return
        setIsInitialLoading(false)
        setIsRefreshing(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // Every save refetches: photo counts and the dates are derived server-side.
  const reload = () => setReloadToken((token) => token + 1)

  return (
    <div className="space-y-6">
      {error && (
        <Alert
          title="We couldn’t load your gear"
          action={
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={reload}
              disabled={isRefreshing}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {isInitialLoading ? (
        <GearListSkeleton />
      ) : (
        <div
          className={cn(
            'space-y-6 transition-opacity duration-150',
            isRefreshing && 'opacity-60'
          )}
          aria-busy={isRefreshing}
        >
          <GearSection
            kind="camera"
            gears={gears.filter((gear) => gear.kind === 'camera')}
            onAdd={setDialogKind}
            onEdit={setEditingGear}
          />
          <GearSection
            kind="lens"
            gears={gears.filter((gear) => gear.kind === 'lens')}
            onAdd={setDialogKind}
            onEdit={setEditingGear}
          />
        </div>
      )}

      {dialogKind && (
        <GalleryGearFormDialog
          open
          kind={dialogKind}
          onOpenChange={(open) => {
            if (!open) setDialogKind(null)
          }}
          onSaved={reload}
        />
      )}
      {editingGear && (
        <GalleryGearFormDialog
          open
          kind={editingGear.kind}
          gear={editingGear}
          onOpenChange={(open) => {
            if (!open) setEditingGear(null)
          }}
          onSaved={reload}
        />
      )}
    </div>
  )
}
