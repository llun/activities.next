import Link from 'next/link'
import { FC } from 'react'

import { cn } from '@/lib/utils'

export type NotificationTab = 'all' | 'mentions'

interface Props {
  active: NotificationTab
}

// Mastodon's two-tab default for the notifications feed: All, and Mentions
// (which covers mention + reply). Rendered as an in-header segmented control;
// switching tabs resets to the first page.
const TABS: { id: NotificationTab; label: string; href: string }[] = [
  { id: 'all', label: 'All', href: '/notifications' },
  { id: 'mentions', label: 'Mentions', href: '/notifications?type=mentions' }
]

export const NotificationFilterTabs: FC<Props> = ({ active }) => (
  <nav
    aria-label="Filter notifications"
    className="inline-flex gap-1 rounded-lg bg-muted p-1"
  >
    {TABS.map((tab) => {
      const isActive = tab.id === active
      return (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
            isActive
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </Link>
      )
    })}
  </nav>
)
