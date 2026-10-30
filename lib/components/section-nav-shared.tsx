// The shapes and small pieces shared by the section dropdown and the section
// index. Dependency-free and without `'use client'` so either side of the
// server/client boundary can read it (`section-nav.tsx` imports the dropdown,
// so the two must not import each other).
import { FC, ReactNode } from 'react'

import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'

export interface SectionNavItem {
  name: string
  url: string
  /**
   * A rendered element (`<Sun />`, an avatar), not a component, so a server
   * layout can pass the list straight to these client components. Colour comes
   * from the row: lucide icons draw in `currentColor`.
   */
  icon: ReactNode
  /** One line under the name on the desktop index cards. */
  description?: string
  /**
   * Other paths that belong to this page besides `url` and its children, for
   * the active-page match (Account's verify-email page under Email & name).
   */
  alsoMatches?: string[]
  /** A count shown beside the row in both the menu and the section index. */
  badge?: number
  /** The count's accessible description (for example, "unresolved reports"). */
  badgeLabel?: string
  /** Destructive action: icon and name in the destructive colour. */
  danger?: boolean
}

export interface SectionNavGroup {
  /** The small label above the group; a group without one is a plain run. */
  heading?: string
  items: SectionNavItem[]
  /**
   * Only in the menu: the index page renders this group itself (Settings'
   * profile card).
   */
  menuOnly?: boolean
  /**
   * After the footer row instead of before it (Settings' Moving and Delete
   * this profile, the last things on the list page and at the foot of the
   * menu).
   */
  afterFooter?: boolean
}

export interface SectionNavFooter {
  /** The index's label above the card ("Shared across your profiles"). */
  heading: string
  item: SectionNavItem
}

export const SECTION_NAV_ICON_CLASS =
  'flex shrink-0 items-center [&>svg]:size-4'

export const SectionNavItemBadge: FC<{ count?: number; label?: string }> = ({
  count,
  label
}) => {
  if (count === undefined || count <= 0) return null

  return (
    <>
      <NotificationBadge
        count={count}
        aria-hidden="true"
        className="static ml-auto"
      />
      <span className="sr-only">
        {' '}
        ({count} {label ?? 'updates'})
      </span>
    </>
  )
}

/**
 * Everything the menu lists, in order: the groups before the footer, then
 * (after the footer row) the `afterFooter` groups.
 */
export const orderSectionNavGroups = (groups: SectionNavGroup[]) => ({
  before: groups.filter((group) => !group.afterFooter),
  after: groups.filter((group) => group.afterFooter)
})
