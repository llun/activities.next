import { FC } from 'react'

import { cn } from '@/lib/utils'

interface BarProps {
  className?: string
}

/**
 * One shimmering placeholder bar (the app's shared `.skeleton`, still under
 * `prefers-reduced-motion`). Size it with classes to the shape it stands in
 * for: `h-5 w-32`, `aspect-square`, `h-[420px]`.
 */
export const SkeletonBar: FC<BarProps> = ({ className }) => (
  <span
    aria-hidden="true"
    data-slot="skeleton-bar"
    className={cn('skeleton block h-4 w-full rounded-md', className)}
  />
)

interface RowsProps {
  /** How many rows (default 3). */
  rows?: number
  /** Classes for each row's bar. */
  rowClassName?: string
  className?: string
  /** What a screen reader hears while it loads (default "Loading"). */
  label?: string
}

/**
 * A stack of placeholder rows for a `loading.tsx` or an in-view loading state
 * to draw the final layout's shape, with one polite "Loading" for assistive
 * tech instead of text on screen.
 */
export const SkeletonRows: FC<RowsProps> = ({
  rows = 3,
  rowClassName,
  className,
  label = 'Loading'
}) => (
  <div
    role="status"
    data-slot="skeleton-rows"
    className={cn('space-y-3', className)}
  >
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => (
      <SkeletonBar key={index} className={cn('h-12', rowClassName)} />
    ))}
  </div>
)
