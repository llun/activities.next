import type { LucideIcon } from 'lucide-react'
import { FC, ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

type HeadingLevel = 2 | 3 | 4

interface Props {
  title: ReactNode
  /** The subject's icon, drawn before the heading. */
  icon?: LucideIcon
  /** A short muted note beside the heading, such as "3 installed". */
  meta?: ReactNode
  /** Controls for the section, at the end of the heading row. */
  actions?: ReactNode
  /** Muted copy under the heading row. */
  description?: ReactNode
  /**
   * The heading's level. `2` under the page's section heading, `3` for a
   * section nested in another one. The look is the same at every level.
   */
  headingLevel?: HeadingLevel
  className?: string
  children: ReactNode
}

/**
 * A titled block of a page, as the Fitness overview lays out "Training
 * calendar" and "Activity types": a plain `text-base` heading on the page
 * itself (no card around the whole section), its controls at the end of the
 * same row, and the content below in its own bordered surface (a `Frame`,
 * `FramedList`, `StatStrip`...). Sections stack in the page's `space-y-6`.
 */
export const Section: FC<Props> = ({
  title,
  icon: Icon,
  meta,
  actions,
  description,
  headingLevel = 2,
  className,
  children
}) => {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section
      data-slot="section"
      aria-labelledby={headingId}
      className={cn('space-y-3', className)}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {Icon ? (
            <Icon aria-hidden className="text-primary -mr-1 size-4 shrink-0" />
          ) : null}
          <Heading id={headingId} className="text-base font-semibold">
            {title}
          </Heading>
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
