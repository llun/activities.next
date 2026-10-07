import { AlertTriangle } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  title: ReactNode
  /** Friendly copy saying what happened and what to do; muted under the title. */
  children?: ReactNode
  /** A recovery control (Retry), set at the end of the row. */
  action?: ReactNode
  className?: string
}

/**
 * The fitness section's error surface, as the overview draws it: a bordered
 * card with a destructive left rule and a warning icon, a bold line saying what
 * failed and a muted one saying what to do, and an optional action. It is a
 * live `alert`, so a failure that lands after the page settled announces
 * itself instead of waiting to be noticed.
 */
export const FitnessAlert: FC<Props> = ({
  title,
  children,
  action,
  className
}) => (
  <div
    role="alert"
    className={cn(
      'border-l-destructive flex flex-wrap items-center gap-3 rounded-lg border border-l-4 p-4',
      className
    )}
  >
    <AlertTriangle
      className="text-destructive-text size-5 shrink-0"
      aria-hidden="true"
    />
    <div className="min-w-0 flex-[1_1_16rem] text-sm">
      <p className="font-semibold break-words">{title}</p>
      {children ? (
        <div className="text-muted-foreground break-words">{children}</div>
      ) : null}
    </div>
    {action}
  </div>
)
