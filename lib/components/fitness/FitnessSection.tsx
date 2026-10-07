import { FC, ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  title: ReactNode
  /** A short muted note beside the heading, such as "3 installed". */
  meta?: ReactNode
  /** Controls for the section, at the end of the heading row. */
  actions?: ReactNode
  /** Muted copy under the heading row. */
  description?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * A titled block of a fitness page, as the overview lays out "Training
 * calendar" and "Activity types": a plain `text-base` heading on the page
 * itself (no card around the whole section), its controls at the end of the
 * same row, and the content below in its own bordered surface. Sections stack
 * in the page's `space-y-6`.
 */
export const FitnessSection: FC<Props> = ({
  title,
  meta,
  actions,
  description,
  className,
  children
}) => {
  const headingId = useId()
  return (
    <section
      data-slot="fitness-section"
      aria-labelledby={headingId}
      className={cn('space-y-3', className)}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          {meta ? (
            <span className="text-muted-foreground text-sm">{meta}</span>
          ) : null}
          {actions ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/**
 * A table header row in the overview's Activity types style: a faint muted
 * band, small muted labels, a hairline under it.
 */
export const FITNESS_TABLE_HEAD_ROW_CLASS =
  'bg-muted/40 text-muted-foreground border-b text-left text-xs'

/** The bordered surface a section's table or list sits in. */
export const FITNESS_SURFACE_CLASS = 'rounded-lg border'
