import type { LucideIcon } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { cn } from '@/lib/utils'

import { SkeletonBar } from './Skeleton'
import { StatCell } from './StatCell'
import { StatStrip, type StatStripColumns } from './StatStrip'

interface DescriptionProps {
  /**
   * How many lines of `text-sm` copy the loaded description wraps to, so the
   * content below starts where the loaded page puts it. `[phone, wider]` when
   * the wrap differs by width (the extra phone lines hide from `md`).
   */
  lines?: number | [number, number]
  className?: string
}

/**
 * The muted description under a page title, as bars: one `h-5` line box per
 * wrapped line (the loaded text's `text-sm` leading), the last one shorter.
 */
export const DescriptionSkeleton: FC<DescriptionProps> = ({
  lines = 1,
  className
}) => {
  const [phone, wide] = typeof lines === 'number' ? [lines, lines] : lines
  const count = Math.max(phone, wide)
  return (
    <div className={cn('max-w-full', className)}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn(
            'flex h-5 items-center',
            // A line only the narrower layout wraps onto.
            index >= wide && 'md:hidden',
            index >= phone && 'max-md:hidden'
          )}
        >
          <SkeletonBar
            className={cn('h-4', index === count - 1 ? 'w-2/3' : 'w-full')}
          />
        </div>
      ))}
    </div>
  )
}

interface Props {
  /**
   * What a screen reader hears while it loads, as the screen's one polite
   * status. Leave it out when `children` already carry the status (a client
   * view's own skeleton), so the screen never announces twice.
   */
  label?: string
  /** The title bar's width class (default `w-32`). */
  titleWidth?: string
  /** The description under the title: `false` for none. */
  description?: ReactNode | false
  /** Controls at the end of the title row (a button's worth of bars). */
  actions?: ReactNode
  /** The page's body, drawn in the final layout's shape. */
  children?: ReactNode
  className?: string
}

/**
 * The loading screen of a section's child page, for a `loading.tsx` under a
 * layout that already draws the section header and dropdown: the page's own
 * title block (the section-mode `PageHeader`, as bars) then the body. Draws no
 * text; one polite `role="status"`.
 */
export const ScreenSkeleton: FC<Props> = ({
  label,
  titleWidth = 'w-32',
  description = <DescriptionSkeleton />,
  actions,
  children,
  className
}) => (
  <div aria-busy="true" className={cn('space-y-6', className)}>
    {label ? (
      <span role="status" className="sr-only">
        {label}
      </span>
    ) : null}
    <PageHeader
      title={<SkeletonBar className={cn('h-7', titleWidth)} />}
      description={description === false ? undefined : description}
      actions={actions}
    />
    {children}
  </div>
)

interface StatStripSkeletonProps {
  /** One entry per cell: its label and icon are static, only the value waits. */
  cells: { label: string; icon: LucideIcon }[]
  columns?: StatStripColumns
}

/**
 * The hairline totals strip while its values load: the same cells the loaded
 * strip draws, with a shimmer bar where each value goes, so the strip keeps its
 * height. It carries no status of its own; the screen's one status names the
 * wait.
 */
export const StatStripSkeleton: FC<StatStripSkeletonProps> = ({
  cells,
  columns = cells.length > 4 ? 4 : (cells.length as StatStripColumns)
}) => (
  <StatStrip variant="summary" columns={columns}>
    {cells.map(({ label, icon }) => (
      <StatCell key={label} label={label} icon={icon} value={null} loading />
    ))}
  </StatStrip>
)
