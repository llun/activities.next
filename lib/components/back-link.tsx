import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { MOBILE_BACK_ROW_CLASS } from '@/lib/components/layout/chromeLayout'
import { BACK_LABEL } from '@/lib/components/navigation-history/backDestination'
import { cn } from '@/lib/utils'

export interface BackLinkProps {
  /** The parent route this Back returns to. */
  href: string
  /**
   * Names the destination for assistive tech ("Back to lists", "Back to
   * profile, Anna Nowak"). It must contain the visible `label`.
   */
  accessibleName: string
  /**
   * The visible text: "Back" by default; "Back to profile" when the
   * destination is a profile (`profileBack` in `backDestination`).
   */
  label?: string
  /**
   * From this breakpoint up the label is visually hidden and only the arrow
   * shows — the desktop look these links always had. Below it, the link is a
   * labelled 44px row in the content.
   */
  iconOnlyFrom?: 'md'
  className?: string
  iconClassName?: string
  /** `false` for a per-user `[actor]` route (see Link prefetching in feeds in docs/architecture.md). */
  prefetch?: boolean
  /**
   * For a Back that leaves an editor held in the page's own state: it runs on
   * a plain click (the link is not followed) while `href` stays the real
   * route, so a modified click or a right-click still works.
   */
  onClick?: () => void
  /**
   * Mutes the link and swallows clicks and Enter, for a Back that must wait
   * (a save in flight). It stays a link in the tab order, marked
   * `aria-disabled`.
   */
  disabled?: boolean
}

/**
 * A parent-route Back link that sits in the first content row, never in a
 * page bar. Its visible text is short ("Back", or "Back to profile" for a
 * profile) and its accessible name names the destination. A history-based Back
 * (the post page) is a different control — see the status `Header`.
 */
export function BackLink({
  href,
  accessibleName,
  label = BACK_LABEL,
  iconOnlyFrom,
  className,
  iconClassName = 'size-5 max-md:size-4',
  prefetch,
  onClick,
  disabled = false
}: BackLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={
        disabled
          ? (event) => event.preventDefault()
          : onClick
            ? (event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                event.preventDefault()
                onClick()
              }
            : undefined
      }
      aria-label={accessibleName}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        MOBILE_BACK_ROW_CLASS,
        disabled && 'pointer-events-none opacity-50',
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
