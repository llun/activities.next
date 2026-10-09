import { LucideIcon } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  icon: LucideIcon
  title: ReactNode
  /**
   * The title's element. `p` inside a section that already has a heading; a
   * heading level when the empty state stands in for a whole section.
   */
  titleAs?: 'p' | 'h2' | 'h3'
  /** Muted copy under the title, such as a link to fill the gap. */
  children?: ReactNode
  /** A follow-up control (button or link) under the copy. */
  action?: ReactNode
  className?: string
}

/**
 * The shared empty state, as the Fitness overview draws it: a muted panel with
 * the page's own icon in a bordered tile, a bold line saying what is missing,
 * muted copy saying how to fill it, and an optional action.
 */
export const EmptyState: FC<Props> = ({
  icon: Icon,
  title,
  titleAs: Title = 'p',
  children,
  action,
  className
}) => (
  <div
    data-slot="empty-state"
    className={cn(
      'bg-muted/40 flex items-start gap-3 rounded-lg border p-4',
      className
    )}
  >
    <span
      aria-hidden="true"
      className="bg-background flex size-10 shrink-0 items-center justify-center rounded-lg border"
    >
      <Icon className="text-muted-foreground size-5" />
    </span>
    <div className="min-w-0 text-sm">
      <Title className="text-sm font-semibold break-words">{title}</Title>
      {children ? (
        <div className="text-muted-foreground break-words">{children}</div>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  </div>
)
