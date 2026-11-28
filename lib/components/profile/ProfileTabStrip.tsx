'use client'

import { FC } from 'react'

import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { PROFILE_TAB_LABELS, ProfileTab } from '@/lib/types/domain/profileTabs'

interface Props {
  tabs: ProfileTab[]
  value: ProfileTab
  onValueChange: (tab: ProfileTab) => void
}

/**
 * The profile's section tabs, shared by the profile page and the Edit profile
 * preview so the two cannot drift.
 */
export const ProfileTabStrip: FC<Props> = ({ tabs, value, onValueChange }) => (
  <SegmentedControl
    aria-label="Profile sections"
    items={tabs.map((tab) => ({ value: tab, label: PROFILE_TAB_LABELS[tab] }))}
    value={value}
    onValueChange={(next) => onValueChange(next as ProfileTab)}
    className="sm:w-fit"
  />
)
