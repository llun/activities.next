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
}

/**
 * One cell of a `FitnessStatGrid` `summary` strip: the value over its label,
 * with the icon beside them only where the strip is wide enough for it (four
 * across on the overview), as in the designs. The cell paints the background
 * that the grid's 1px gaps cut into hairline dividers, so the strip's own
 * wrapper carries `bg-border`, the border and the radius.
 *
 * The skeleton is a STATIC block (`--skeleton`), never the shared shimmering
 * `.skeleton`: loading on fitness surfaces is a dim and still bars, no motion.
 */
export const FitnessStatCell: FC<Props> = ({
  label,
  icon: Icon,
  value,
  loading = false
}) => (
  <div className="bg-background flex min-w-0 items-center gap-3 px-4 py-3">
    <Icon
      className="text-muted-foreground hidden size-5 shrink-0 @min-[43.75rem]:block"
      aria-hidden="true"
    />
    <dl className="flex min-w-0 flex-col-reverse">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd
        className={cn(
          'text-xl font-semibold tabular-nums break-words',
          loading && 'text-transparent'
        )}
      >
        {loading ? (
          <>
            <span className="sr-only">Loading</span>
            <span
              aria-hidden="true"
              className="my-1 block h-5 w-20 rounded bg-(--skeleton)"
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
  </div>
)

/** The strip wrapper's classes: the hairline track, the border and radius. */
export const FITNESS_STAT_STRIP_CLASS =
  'bg-border overflow-hidden rounded-lg border'
