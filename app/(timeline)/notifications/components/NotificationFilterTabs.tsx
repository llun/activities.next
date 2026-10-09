import { FC } from 'react'

import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'

export type NotificationTab = 'all' | 'mentions'

interface Props {
  active: NotificationTab
}

// Mastodon's two-tab default for the notifications feed: All, and Mentions
// (which covers mention + reply). Rendered as an in-header segmented control;
// switching tabs resets to the first page.
const TABS = [
  { value: 'all', label: 'All', href: '/notifications' },
  { value: 'mentions', label: 'Mentions', href: '/notifications?type=mentions' }
] satisfies { value: NotificationTab; label: string; href: string }[]

export const NotificationFilterTabs: FC<Props> = ({ active }) => (
  <SegmentedControl
    asLinks
    size="sm"
    aria-label="Filter notifications"
    items={TABS}
    value={active}
  />
)
