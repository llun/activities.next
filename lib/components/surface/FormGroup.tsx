import { FC, ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

type HeadingLevel = 2 | 3 | 4

interface Props {
  title: ReactNode
  /** Muted copy under the heading. */
  description?: ReactNode
  /** The heading's level, as `Section`'s: `2` by default. */
  headingLevel?: HeadingLevel
  className?: string
  /** The group's `FormRow`s. */
  children: ReactNode
}

/**
 * A titled group inside one `Frame form` that spans several former sections
 * (Profile and Privacy sharing one Save). A `px-4 pt-5 pb-0.5` heading block
 * (`pt-2.5` as the box's first child, since the box already has `py-1.5`) over
 * the group's rows, wrapped in a `role="group"` named by the heading so screen
 * readers keep the grouping the box no longer draws.
 */
export const FormGroup: FC<Props> = ({
  title,
  description,
  headingLevel = 2,
  className,
  children
}) => {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <div
      data-slot="form-group"
      role="group"
      aria-labelledby={headingId}
      className={cn('group/form-group', className)}
    >
      <div className="px-4 pt-5 pb-0.5 group-first/form-group:pt-2.5">
        <Heading id={headingId} className="text-sm font-semibold">
          {title}
        </Heading>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
