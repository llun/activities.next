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
 * - `summary` — the fitness overview's totals (Activities, Distance, Duration,
 *   Elevation). Values are `text-xl`, with a 20px icon beside them only when
 *   four across, and a long total such as "1,234h 56m" then needs ~175px a
 *   cell, so it is 2×2 and 4-up only from 700px: the tablet's 715px column
 *   and the 908px desktop one are 4-up, a phone is 2×2. The 1px gap over a
 *   border-coloured track draws the hairline dividers.
 *
 *   Its thresholds are in `rem`, not `px`, so they follow the reader's text
 *   size: at 200% text a phone's column holds half as many characters, so the
 *   2×2 card stacks to one column (and 4-up waits for twice the width) instead
 *   of clipping "22.2 km" to "22.2 kr". At the default size 16rem is 256px
 *   (a 320px phone's 288px column is still 2×2) and 43.75rem is 700px.
 */
const VARIANT_CLASS_NAMES = {
  detail: 'gap-3 grid-cols-1 @min-[420px]:grid-cols-2 @min-[780px]:grid-cols-4',
  chip: 'gap-2 grid-cols-2 @min-[424px]:grid-cols-4',
  summary:
    'gap-px grid-cols-1 @min-[16rem]:grid-cols-2 @min-[43.75rem]:grid-cols-4'
} as const

export type FitnessStatGridVariant = keyof typeof VARIANT_CLASS_NAMES

/**
 * The `summary` strip with fewer than four cells — the gear pages' totals use
 * the overview's hairline strip too, with two or three values. Four columns
 * there would leave an empty, border-coloured cell at the end of the row, so
 * the strip spans exactly as many columns as it has cells. Three values go
 * 3-up from 30rem (a 480px column still gives each "35,670.2 km" ~160px) and,
 * on a phone, two over one with the third cell spanning the row, the 2×2
 * strip's shape rather than a tall single column; two follow the four-cell
 * strip's own 16rem step. Same `rem` reasoning as above.
 */
const SUMMARY_COLUMN_CLASS_NAMES = {
  2: 'gap-px grid-cols-1 @min-[16rem]:grid-cols-2',
  3: 'gap-px grid-cols-1 @min-[16rem]:grid-cols-2 @min-[16rem]:[&>*:nth-child(3)]:col-span-2 @min-[30rem]:grid-cols-3 @min-[30rem]:[&>*:nth-child(3)]:col-span-1',
  4: VARIANT_CLASS_NAMES.summary
} as const

export type FitnessSummaryColumns = keyof typeof SUMMARY_COLUMN_CLASS_NAMES

/**
 * The wrapper is what carries `@container`: a container query styles a
 * container's *descendants*, never the container itself, so the grid cannot
 * both establish the container and read it. The wrapper is a plain block, so
 * its content box is exactly the grid's width.
 */
export const FitnessStatGrid: FC<{
  variant?: FitnessStatGridVariant
  /** `summary` only: how many cells the strip holds (default four). */
  columns?: FitnessSummaryColumns
  className?: string
  children: ReactNode
}> = ({ variant = 'detail', columns = 4, className, children }) => (
  <div className={cn('@container', className)}>
    <div
      className={cn(
        'grid',
        variant === 'summary'
          ? SUMMARY_COLUMN_CLASS_NAMES[columns]
          : VARIANT_CLASS_NAMES[variant]
      )}
    >
      {children}
    </div>
  </div>
)
