import { FC } from 'react'

import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import type { TimelineNetwork } from '@/lib/services/timelines/types'

interface Props {
  active?: TimelineNetwork
}

// An in-page filter of the one Home feed (like Notifications' All / Mentions),
// shown only to an actor with a linked Bluesky account. Real links, so the
// server renders the filtered first page.
const ITEMS = [
  { value: 'all', label: 'All', href: '/' },
  { value: 'activitypub', label: 'Fediverse', href: '/?network=activitypub' },
  { value: 'bluesky', label: 'Bluesky', href: '/?network=bluesky' }
]

export const HomeNetworkSwitch: FC<Props> = ({ active }) => (
  <SegmentedControl
    asLinks
    size="sm"
    aria-label="Show posts from"
    items={ITEMS}
    value={active ?? 'all'}
  />
)
