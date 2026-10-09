'use client'

import { type ReactNode } from 'react'

import {
  MOBILE_COMPACT_HEADER_CLASS,
  breakoutStyle
} from '@/lib/components/layout/chromeLayout'
import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { cn } from '@/lib/utils'

export interface MobileCompactHeaderProps {
  /** One short page or section title. Long titles truncate visually. */
  title: ReactNode
  /**
   * `h1` when the bar's title is the page's heading below `md` (the content
   * hides its own); `p` when the content keeps a visible heading of its own
   * and the bar only names the section.
   */
  as?: 'h1' | 'p'
  /**
   * Overlay hung just below the bar (`top-full`) without taking space — the
   * home timeline's "N new posts" and announcements pills, which stay
   * reachable on scroll because the bar is sticky.
   */
  bottomSlot?: ReactNode
  /**
   * Controls at the end of the bar, after the title (the home timeline's
   * Refresh). Every other page keeps its actions in the content below.
   */
  actions?: ReactNode
  className?: string
}

/**
 * The mobile "Compact B" bar: the menu button and one truncating title —
 * no logo, subtitle, breadcrumb, unread badge or Back. Page actions, counts,
 * descriptions, filters and Back live in the content below it, except an
 * `actions` slot a page opts into (the home timeline's Refresh). Renders only
 * under a `MobileNavigationProvider` and only below `md`.
 */
export function MobileCompactHeader({
  title,
  as: Title = 'h1',
  bottomSlot,
  actions,
  className
}: MobileCompactHeaderProps) {
  const nav = useMobileNavigation()
  if (!nav) return null

  return (
    <div
      data-mobile-compact-header=""
      className={cn(MOBILE_COMPACT_HEADER_CLASS, className)}
      style={breakoutStyle}
    >
      <MobileNavigationTrigger className="shrink-0" />
      <Title
        className="min-w-0 flex-1 truncate text-lg font-semibold"
        // The visual title truncates; a string title stays whole in the
        // tooltip, and the heading's accessible name is never cut.
        title={typeof title === 'string' ? title : undefined}
      >
        {title}
      </Title>
      {actions ? <div className="shrink-0">{actions}</div> : null}
      {bottomSlot ? (
        <div className="pointer-events-none absolute inset-x-0 top-full flex justify-center px-4 pt-2">
          {bottomSlot}
        </div>
      ) : null}
    </div>
  )
}
