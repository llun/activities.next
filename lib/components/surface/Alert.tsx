import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export type AlertTone = 'error' | 'warning' | 'success' | 'info'

const TONES = {
  error: {
    Icon: AlertTriangle,
    rule: 'border-l-destructive',
    icon: 'text-destructive-text',
    role: 'alert'
  },
  warning: {
    Icon: AlertTriangle,
    rule: 'border-l-warning',
    icon: 'text-warning-text',
    role: 'alert'
  },
  success: {
    Icon: CheckCircle2,
    rule: 'border-l-success',
    icon: 'text-success-text',
    role: 'status'
  },
  info: {
    Icon: Info,
    rule: 'border-l-info',
    icon: 'text-info-text',
    role: 'status'
  }
} as const

interface Props {
  /** `error` unless said otherwise. */
  tone?: AlertTone
  title: ReactNode
  /** Friendly copy saying what happened and what to do; muted under the title. */
  children?: ReactNode
  /** A recovery control, set at the end of the row. */
  action?: ReactNode
  /** Shorthand for an outline "Retry" action; `action` wins if both are given. */
  onRetry?: () => void
  /**
   * A row of a `Frame` rather than a card of its own: no outline or rounded
   * corners, only the tone's rule down the left edge. The frame (give it
   * `overflow-hidden`) draws the outline around it.
   */
  flush?: boolean
  /**
   * Whether it speaks when it appears (default). Turn it off for a row that is
   * simply part of the page at load, such as the danger zone or a standing
   * "two-factor is off" state: that is content to read, not news to announce,
   * so it drops the `alert` / `status` role.
   */
  live?: boolean
  className?: string
}

/**
 * The shared message surface, as the Fitness overview draws its error: a
 * bordered card with a 4px rule down the left edge in the tone's colour, the
 * tone's icon, a bold line saying what happened and a muted one saying what to
 * do, and an optional action. Errors and warnings are live `alert`s, so a
 * failure that lands after the page settled announces itself; success and info
 * are polite `status` regions.
 */
export const Alert: FC<Props> = ({
  tone = 'error',
  title,
  children,
  action,
  onRetry,
  flush = false,
  live = true,
  className
}) => {
  const { Icon, rule, icon, role } = TONES[tone]
  return (
    <div
      role={live ? role : undefined}
      data-slot="alert"
      data-tone={tone}
      className={cn(
        'flex flex-wrap items-center gap-3 border-l-4 p-4',
        flush ? 'border-y-0 border-r-0' : 'rounded-lg border',
        rule,
        className
      )}
    >
      <Icon className={cn('size-5 shrink-0', icon)} aria-hidden="true" />
      <div className="min-w-0 flex-[1_1_16rem] text-sm">
        <p className="font-semibold break-words">{title}</p>
        {children ? (
          <div className="text-muted-foreground break-words">{children}</div>
        ) : null}
      </div>
      {action ??
        (onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        ) : null)}
    </div>
  )
}
