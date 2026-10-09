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

const CELL_CLASS = 'bg-background flex min-w-0 items-center gap-3 px-4 py-3'

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
  const content = (
    <>
      <Icon
        className="text-muted-foreground hidden size-5 shrink-0 @min-[43.75rem]:block"
        aria-hidden="true"
      />
      <dl className="flex min-w-0 flex-col-reverse">
        <dt className="text-muted-foreground text-sm">{label}</dt>
        <dd
          className={cn(
            'text-xl font-semibold tabular-nums break-words',
            loading && 'text-transparent',
            selected && 'text-primary-text'
          )}
        >
          {loading ? (
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
          )}
        </dd>
      </dl>
    </>
  )

  if (!onSelect) return <div className={CELL_CLASS}>{content}</div>

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        CELL_CLASS,
        SELECTABLE_CLASS,
        selected ? 'bg-primary/10 after:bg-primary' : 'after:bg-transparent'
      )}
    >
      {content}
    </button>
  )
}
