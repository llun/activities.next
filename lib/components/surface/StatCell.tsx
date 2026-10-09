import { LucideIcon } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  label: string
  icon: LucideIcon
  /**
   * The formatted value. `null` when there is nothing to show: with `loading`
   * it is a skeleton, otherwise a dash, never a zero, because no data is not
   * the same as nothing recorded.
   */
  value: ReactNode | null
  loading?: boolean
  /**
   * Makes the cell a button that picks it (a chart's metric): `aria-pressed`
   * follows `selected`, and the pressed cell is tinted with a primary value and
   * a primary rule along its bottom edge.
   */
  onSelect?: () => void
  selected?: boolean
}

// The cell paints an OPAQUE background (the strip's 1px gaps cut into hairline
// dividers over its `bg-border` track), so a tint has to be mixed into that
// background, never laid over it as `bg-primary/10`: `cn` would then drop
// `bg-background` and the 10% tint would sit on the grey track, which takes the
// `text-primary-text` value below AA in light mode.
const CELL_CLASS = 'flex min-w-0 items-center gap-3 px-4 py-3'
const IDLE_BACKGROUND = 'bg-background'
const SELECTED_BACKGROUND =
  'bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]'

const SELECTABLE_CLASS =
  'relative w-full cursor-pointer text-left outline-none transition-colors hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:content-[""]'

/**
 * One cell of a `StatStrip` `summary` strip: the value over its label, with the
 * icon beside them only where the strip is wide enough for it (four across on
 * the overview), as in the designs. The cell paints the background that the
 * strip's 1px gaps cut into hairline dividers.
 *
 * The skeleton is the app's shared shimmering `.skeleton` bar, as on every
 * other loading surface; under `prefers-reduced-motion` it is the still
 * `--skeleton` block.
 */
export const StatCell: FC<Props> = ({
  label,
  icon: Icon,
  value,
  loading = false,
  onSelect,
  selected = false
}) => {
  const valueClass = cn(
    'text-xl font-semibold tabular-nums break-words',
    loading && 'text-transparent',
    selected && 'text-primary-text'
  )
  const valueContent = loading ? (
    <>
      <span className="sr-only">Loading</span>
      <span
        aria-hidden="true"
        className="my-1 block h-5 w-20 rounded skeleton"
      />
    </>
  ) : value === null ? (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">Unavailable</span>
    </>
  ) : (
    value
  )
  const icon = (
    <Icon
      className="text-muted-foreground hidden size-5 shrink-0 @min-[43.75rem]:block"
      aria-hidden="true"
    />
  )

  if (!onSelect) {
    return (
      <div className={cn(CELL_CLASS, IDLE_BACKGROUND)}>
        {icon}
        <dl className="flex min-w-0 flex-col-reverse">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className={valueClass}>{valueContent}</dd>
        </dl>
      </div>
    )
  }

  // A button's content must be phrasing content, so a selectable cell cannot
  // hold a `dl`. Its label and value are spans in reading order (label, then
  // value), which is also what the button's accessible name reads: "Distance
  // 12.3 km".
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      className={cn(
        CELL_CLASS,
        SELECTABLE_CLASS,
        selected
          ? cn(SELECTED_BACKGROUND, 'after:bg-primary')
          : cn(IDLE_BACKGROUND, 'after:bg-transparent')
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-col-reverse">
        <span className="text-muted-foreground text-sm">{label}</span>{' '}
        <span className={cn('block', valueClass)}>{valueContent}</span>
      </span>
    </button>
  )
}
