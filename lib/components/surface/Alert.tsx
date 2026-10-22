import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
  RefreshCw
} from 'lucide-react'
import { FC, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export type AlertTone = 'error' | 'warning' | 'success' | 'info'

const TONES = {
  error: {
    Icon: AlertTriangle,
    surface: 'bg-destructive-surface',
    outline: 'border-destructive/25',
    rule: 'border-l-destructive',
    icon: 'text-destructive-text',
    role: 'alert'
  },
  warning: {
    Icon: AlertTriangle,
    surface: 'bg-warning-surface',
    outline: 'border-warning/25',
    rule: 'border-l-warning',
    icon: 'text-warning-text',
    role: 'alert'
  },
  success: {
    Icon: CheckCircle2,
    surface: 'bg-success-surface',
    outline: 'border-success/25',
    rule: 'border-l-success',
    icon: 'text-success-text',
    role: 'status'
  },
  info: {
    Icon: Info,
    surface: 'bg-info-surface',
    outline: 'border-info/25',
    rule: 'border-l-info',
    icon: 'text-info-text',
    role: 'status'
  }
} as const

interface Props {
  /** `error` unless said otherwise. */
  tone?: AlertTone
  title: ReactNode
  /** Replaces the tone's icon, for a state the tone does not name (offline). */
  icon?: LucideIcon
  /** Friendly copy saying what happened and what to do; muted under the title. */
  children?: ReactNode
  /** A recovery control, set at the end of the row. */
  action?: ReactNode
  /** Shorthand for an outline "Retry" action; `action` wins if both are given. */
  onRetry?: () => void
  /**
   * Whether it speaks when it appears (default). Turn it off for a row that is
   * simply part of the page at load, such as the danger zone or a standing
   * "two-factor is off" state: that is content to read, not news to announce,
   * so it drops the `alert` / `status` role.
   */
  live?: boolean
  /**
   * Extra classes for layout (margin, width). Do not override the fill with a
   * `bg-*` class: the tone's opaque surface is part of the component.
   */
  className?: string
}

/**
 * The shared message surface, as the Fitness overview draws its error: a
 * bordered card with an opaque fill tinted in the tone's colour (so it never
 * reads see-through), a tone-tinted outline, a 4px rule down the left edge in
 * the tone's full colour, the tone's icon, a bold line saying what happened
 * and a muted one saying what to do, and an optional action. Errors and
 * warnings are live `alert`s, so a failure that lands after the page settled
 * announces itself; success and info are polite `status` regions. Every Alert
 * is this standalone card: it sits in the page or section stack beside the
 * boxes, aligned with their edges, never inside a `Frame` (the exceptions are
 * an `AuthCard` and the Messages chat panes, which are the page's surface).
 */
export const Alert: FC<Props> = ({
  tone = 'error',
  title,
  icon,
  children,
  action,
  onRetry,
  live = true,
  className
}) => {
  const {
    Icon: ToneIcon,
    surface,
    outline,
    rule,
    icon: iconClass,
    role
  } = TONES[tone]
  const Icon = icon ?? ToneIcon
  return (
    <div
      role={live ? role : undefined}
      data-slot="alert"
      data-tone={tone}
      className={cn(
        'flex flex-wrap items-center gap-3 p-4',
        surface,
        'rounded-lg border border-l-4',
        outline,
        rule,
        className
      )}
    >
      {/* The icon and the words wrap as one unit, so in a narrow container
          (the sidebar) the action drops below the row instead of the icon
          dropping above the title. */}
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        <Icon className={cn('size-5 shrink-0', iconClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold break-words">{title}</p>
          {children ? (
            <div className="text-muted-foreground break-words">{children}</div>
          ) : null}
        </div>
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
