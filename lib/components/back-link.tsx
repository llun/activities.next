import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { MOBILE_BACK_ROW_CLASS } from '@/lib/components/layout/chromeLayout'
import { cn } from '@/lib/utils'

export interface BackLinkProps {
  /** The parent route this Back returns to. */
  href: string
  /** Descriptive visible label, e.g. "Back to profile". */
  label: string
  /**
   * Accessible name when it should say more than the visible label (it must
   * still contain it). Defaults to the label.
   */
  accessibleName?: string
  /**
   * From this breakpoint up the label is visually hidden and only the arrow
   * shows — the desktop look these links always had. Below it, the link is a
   * labelled 44px row in the content.
   */
  iconOnlyFrom?: 'md'
  className?: string
  iconClassName?: string
  /** `false` for a per-user `[actor]` route (see Link prefetching in feeds). */
  prefetch?: boolean
}

/**
 * A parent-route Back link that sits in the first content row, never in a
 * page bar. A history-based Back (the post page) is a different control — see
 * the status `Header`.
 */
export function BackLink({
  href,
  label,
  accessibleName,
  iconOnlyFrom,
  className,
  iconClassName = 'h-5 w-5',
  prefetch
}: BackLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={accessibleName}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        MOBILE_BACK_ROW_CLASS,
        className
      )}
    >
      <ArrowLeft className={cn('shrink-0', iconClassName)} aria-hidden="true" />
      <span className={iconOnlyFrom === 'md' ? 'md:sr-only' : undefined}>
        {label}
      </span>
    </Link>
  )
}
