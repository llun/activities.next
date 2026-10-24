'use client'

import { SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'

import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'

import {
  formatEmptyStateDescription,
  formatRemoveFilterLabel
} from './galleryMediaFilterLabels'
import {
  type GalleryMediaFilterState,
  clearGalleryFilters,
  setGalleryFilter
} from './galleryMediaFilterState'

export interface GalleryMediaFilterEmptyProps {
  filters: GalleryMediaFilterState
  facets: GalleryMediaFacetsResponse | null
  onChange: (next: GalleryMediaFilterState) => void
  className?: string
}

export const GalleryMediaFilterEmpty: FC<GalleryMediaFilterEmptyProps> = ({
  filters,
  facets,
  onChange,
  className
}) => {
  const removeLabel = formatRemoveFilterLabel(filters, facets)
  const description = formatEmptyStateDescription(filters, facets)

  const handleRemoveLast = () => {
    if (filters.order.length === 0) return
    const lastKey = filters.order[filters.order.length - 1]
    onChange(
      setGalleryFilter(
        filters,
        lastKey,
        (lastKey === 'notInAlbum' ? false : null) as never
      )
    )
  }

  const handleClear = () => {
    onChange(clearGalleryFilters(filters))
  }

  return (
    <EmptyState
      icon={SlidersHorizontal}
      title="No photos match these filters"
      className={className}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {removeLabel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemoveLast}
            >
              {removeLabel}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            Clear filters
          </Button>
        </div>
      }
    >
      {description || null}
    </EmptyState>
  )
}
