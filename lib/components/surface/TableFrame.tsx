import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Frame } from './Frame'

/**
 * A table header row in the Fitness overview's Activity types style: a faint
 * muted band, small muted labels, a hairline under it. Give header cells
 * `px-3 py-2.5 font-medium` (the same padding as `TABLE_CELL_CLASS`).
 */
export const TABLE_HEAD_ROW_CLASS =
  'bg-muted/40 text-muted-foreground border-b text-left text-xs'

/** Padding for body cells, so rows line up with the header band. */
export const TABLE_CELL_CLASS = 'px-3 py-2.5'

interface Props {
  className?: string
  /** The table's own classes, such as a `min-w-[560px]` to force the scroll. */
  tableClassName?: string
  /** `thead` and `tbody`. Use `TABLE_HEAD_ROW_CLASS` on the header row. */
  children: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * A table in a `Frame`, scrolling sideways inside it when the screen is too
 * narrow, with the muted header band from `TABLE_HEAD_ROW_CLASS`.
 */
export const TableFrame: FC<Props> = ({
  className,
  tableClassName,
  children,
  ...aria
}) => (
  <Frame className={cn('overflow-hidden', className)}>
    {/* `relative` makes the scroller the containing block of `sr-only` (absolutely
        positioned) text in cells, so it is clipped here instead of widening the page. */}
    <div data-slot="table-scroller" className="relative overflow-x-auto">
      <table className={cn('w-full text-sm', tableClassName)} {...aria}>
        {children}
      </table>
    </div>
  </Frame>
)
