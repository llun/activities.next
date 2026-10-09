import { FC } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** How many placeholder tiles (default 8). */
  tiles?: number
  /**
   * What a screen reader hears, as one polite `role="status"`. Leave it out
   * when the screen it sits in already announces itself.
   */
  label?: string
  /** Leave room under each tile for the caption the loaded grid prints. */
  captions?: boolean
  className?: string
}

/**
 * The gallery's photo grid while it loads: square shimmer tiles on the same
 * 3-up (4-up from `sm`) grid `GalleryGrid` uses, so the page does not move when
 * the photos arrive. Used by the paged grid and by the gallery `loading.tsx`s.
 */
export const GalleryGridSkeleton: FC<Props> = ({
  tiles = 8,
  label,
  captions = false,
  className
}) => (
  <div
    data-slot="gallery-grid-skeleton"
    role={label ? 'status' : undefined}
    aria-busy="true"
    className={cn('grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2', className)}
  >
    {label ? <span className="sr-only">{label}</span> : null}
    {Array.from({ length: tiles }, (_, index) =>
      captions ? (
        <div key={index} aria-hidden="true" className="space-y-1.5">
          <div className="skeleton aspect-square rounded-md" />
          <div className="skeleton h-3.5 w-2/3 rounded" />
        </div>
      ) : (
        <div
          key={index}
          aria-hidden="true"
          className="skeleton aspect-square rounded-md"
        />
      )
    )}
  </div>
)
