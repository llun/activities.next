import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Column rules for the labelled stat strips on fitness surfaces, straight from
 * the design system's `FitnessKit.StatGrid` / `FitnessChip` grids.
 *
 * They are **container** queries, not viewport breakpoints, because that is
 * what the design measures: the kit's grids read their own width with a
 * `ResizeObserver` precisely so a strip that sits in a narrow column on a wide
 * window still reflows. The old `sm:grid-cols-4` looked at the viewport, so the
 * detail page's four `text-[28px]` tiles stayed 4-up in a 565px column on a
 * tablet and wrapped "31.1 km/h" onto two lines, while a post chip in a wide
 * column below a 640px viewport stayed needlessly 2-up. Same reasoning as
 * `useCompactActionBar` on the post action row.
 *
 * The two variants really do differ, and it is the type size that separates
 * them:
 *
 * - `detail` — the activity page's header strip and the strip under its map.
 *   Values are 21–28px, so they need ~200px a cell: 4-up from 780px, 2-up from
 *   420px, 1-up on a phone.
 * - `chip` — the inline card inside a timeline post. Values are `text-sm`, so
 *   four cells still fit in 424px (the kit derives that from 4×100px + 3×8px of
 *   gap) and it never drops to a single column — a 4-row chip in a feed is a
 *   worse trade than a slightly tight cell.
 */
const VARIANT_CLASS_NAMES = {
  detail: 'gap-3 grid-cols-1 @min-[420px]:grid-cols-2 @min-[780px]:grid-cols-4',
  chip: 'gap-2 grid-cols-2 @min-[424px]:grid-cols-4'
} as const

export type FitnessStatGridVariant = keyof typeof VARIANT_CLASS_NAMES

/**
 * The wrapper is what carries `@container`: a container query styles a
 * container's *descendants*, never the container itself, so the grid cannot
 * both establish the container and read it. The wrapper is a plain block, so
 * its content box is exactly the grid's width.
 */
export const FitnessStatGrid: FC<{
  variant?: FitnessStatGridVariant
  className?: string
  children: ReactNode
}> = ({ variant = 'detail', className, children }) => (
  <div className={cn('@container', className)}>
    <div className={cn('grid', VARIANT_CLASS_NAMES[variant])}>{children}</div>
  </div>
)
