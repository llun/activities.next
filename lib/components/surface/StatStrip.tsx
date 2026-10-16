import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Column rules for the labelled stat strips (Fitness, Gallery, and wherever a
 * set of totals is shown), straight from the design system's
 * `FitnessKit.StatGrid` / `FitnessChip` grids.
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
 * - `detail` — the activity page's header tiles. Values are 24px, so a cell
 *   needs ~130px: 2×2 on a phone and 4-up from 560px, as the activity design
 *   lays them out.
 * - `chip` — the inline card inside a timeline post. Values are `text-sm`, so
 *   four cells still fit in 424px (the kit derives that from 4×100px + 3×8px of
 *   gap) and it never drops to a single column — a 4-row chip in a feed is a
 *   worse trade than a slightly tight cell.
 * - `summary` — the Fitness overview's totals (Activities, Distance, Duration,
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
 * - `counts` — a few short integers (a profile's Posts, Following and
 *   Followers, a post's Boosts, Likes and Comments). Same hairline strip as
 *   `summary`, but a count is "12,345", not "35,670.2 km", so three cells fit
 *   across a phone: 3-up from 17rem (a 320px phone's 288px column is already
 *   3-up, ~96px a cell), and one column only when the text is so large that
 *   they truly cannot, as at 200% text. `summary` would leave the third count
 *   alone on a second row on a 390px phone.
 * - `band` — the activity post's headline figures: the hairline strip without
 *   its own frame, for a strip that runs edge to edge inside a post (the
 *   caller bleeds it out with a negative margin and draws the `border-t` /
 *   `border-b` lines, so the dividers are full-width hairlines, not a box
 *   inside the post). Values are 24px like `detail`, so it is 2 across and
 *   4-up from 560px, but it is built with `columns` like `summary`, so an
 *   uneven count never leaves a border-coloured gap: see
 *   `BAND_COLUMN_CLASS_NAMES`.
 */
const VARIANT_CLASS_NAMES = {
  detail: 'gap-2 grid-cols-2 @min-[560px]:grid-cols-4',
  chip: 'gap-2 grid-cols-2 @min-[424px]:grid-cols-4',
  summary:
    'gap-px grid-cols-1 @min-[16rem]:grid-cols-2 @min-[43.75rem]:grid-cols-4'
} as const

export type StatStripVariant =
  keyof typeof VARIANT_CLASS_NAMES | 'counts' | 'band'

/**
 * The `counts` strip's columns for the number of cells it holds. Rem, not px,
 * for the same reason as the `summary` thresholds: at 200% text 17rem is 544px,
 * so a phone stacks to one column instead of clipping a label.
 */
const COUNT_COLUMN_CLASS_NAMES = {
  1: 'gap-px grid-cols-1',
  2: 'gap-px grid-cols-1 @min-[12rem]:grid-cols-2',
  3: 'gap-px grid-cols-1 @min-[17rem]:grid-cols-3',
  4: 'gap-px grid-cols-1 @min-[12rem]:grid-cols-2 @min-[24rem]:grid-cols-4',
  5: 'gap-px grid-cols-1 @min-[12rem]:grid-cols-3 @min-[30rem]:grid-cols-5'
} as const

/**
 * The `summary` strip with fewer than four cells — the gear pages' totals use
 * the overview's hairline strip too, with two or three values. Four columns
 * there would leave an empty, border-coloured cell at the end of the row, so
 * the strip spans exactly as many columns as it has cells. Three values go
 * 3-up from 30rem (a 480px column still gives each "35,670.2 km" ~160px) and,
 * on a phone, two over one with the third cell spanning the row, the 2×2
 * strip's shape rather than a tall single column; two follow the four-cell
 * strip's own 16rem step; a lone cell is one full-width column. Five values
 * (the activity page's best efforts: 5 s, 1, 5, 20 and 60 min) go 5-up from
 * 30rem and three over two below it. Same `rem` reasoning as above.
 */
const SUMMARY_COLUMN_CLASS_NAMES = {
  1: 'gap-px grid-cols-1',
  2: 'gap-px grid-cols-1 @min-[16rem]:grid-cols-2',
  3: 'gap-px grid-cols-1 @min-[16rem]:grid-cols-2 @min-[16rem]:[&>*:nth-child(3)]:col-span-2 @min-[30rem]:grid-cols-3 @min-[30rem]:[&>*:nth-child(3)]:col-span-1',
  4: VARIANT_CLASS_NAMES.summary,
  5: 'gap-px grid-cols-1 @min-[16rem]:grid-cols-3 @min-[30rem]:grid-cols-5'
} as const

/**
 * The `band` strip's columns for the number of cells it holds: 2 across and
 * 4-up from 560px (the `detail` rule), with the 1px gaps over the strip's
 * `bg-border` track drawing the dividers. A count that does not fill its last
 * row would show the track as an empty grey cell, so that cell spans the rest
 * of the row: the odd last cell of a 2-across row, and the third of three
 * (which goes 3-up from 560px instead of leaving a fourth, empty column).
 */
const BAND_COLUMN_CLASS_NAMES = {
  1: 'gap-px bg-border grid-cols-1',
  2: 'gap-px bg-border grid-cols-2',
  3: 'gap-px bg-border grid-cols-2 [&>*:nth-child(3)]:col-span-2 @min-[560px]:grid-cols-3 @min-[560px]:[&>*:nth-child(3)]:col-span-1',
  4: 'gap-px bg-border grid-cols-2 @min-[560px]:grid-cols-4',
  5: 'gap-px bg-border grid-cols-2 [&>*:nth-child(5)]:col-span-2 @min-[560px]:grid-cols-5 @min-[560px]:[&>*:nth-child(5)]:col-span-1'
} as const

export type StatStripColumns = keyof typeof SUMMARY_COLUMN_CLASS_NAMES

/** The `summary` strip's own classes: the hairline track, border and radius. */
export const STAT_STRIP_CLASS = 'bg-border overflow-hidden rounded-lg border'

/**
 * The wrapper is what carries `@container`: a container query styles a
 * container's *descendants*, never the container itself, so the grid cannot
 * both establish the container and read it. The wrapper is a plain block, so
 * its content box is exactly the grid's width.
 *
 * The `summary` and `counts` variants are the hairline strip: they also paint `bg-border`, the
 * border and the radius that its cells' 1px gaps cut into dividers, so a caller
 * only passes margins. Fill it with `StatCell`s. The `band` variant paints the
 * track but not the frame, so its caller adds the bleed and the hairlines.
 */
export const StatStrip: FC<{
  variant?: StatStripVariant
  /** `summary`, `counts` and `band`: how many cells the strip holds (default four). */
  columns?: StatStripColumns
  className?: string
  children: ReactNode
}> = ({ variant = 'summary', columns = 4, className, children }) => (
  <div
    className={cn(
      '@container',
      (variant === 'summary' || variant === 'counts') && STAT_STRIP_CLASS,
      className
    )}
  >
    <div
      className={cn(
        'grid',
        variant === 'counts'
          ? COUNT_COLUMN_CLASS_NAMES[columns]
          : variant === 'band'
            ? BAND_COLUMN_CLASS_NAMES[columns]
            : variant === 'summary'
              ? SUMMARY_COLUMN_CLASS_NAMES[columns]
              : VARIANT_CLASS_NAMES[variant]
      )}
    >
      {children}
    </div>
  </div>
)
