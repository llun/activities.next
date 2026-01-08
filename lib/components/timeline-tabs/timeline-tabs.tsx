import { FC } from 'react'

import { Timeline } from '@/lib/services/timelines/types'
import { cn } from '@/lib/utils'

export interface Tab {
  name: string
  timeline: Timeline
}

interface Props {
  currentTab: Tab
  tabs: Tab[]
  onClickTab: (tab: Tab) => void
}

export const TimelineTabs: FC<Props> = ({ currentTab, tabs, onClickTab }) => {
  return (
    <ul className="flex border-b border-border mt-4">
      {tabs.map((tab) => (
        <li key={tab.name} className="mr-2">
          <a
            href={`#timeline/${tab.timeline}`}
            className={cn(
              'inline-block px-4 py-2 rounded-t-lg hover:text-foreground hover:border-border',
              {
                'border-b-2 border-primary text-primary':
                  currentTab.name === tab.name,
                'border-transparent': currentTab.name !== tab.name
              }
            )}
            onClick={(event) => {
              event.preventDefault()
              onClickTab(tab)
            }}
          >
            {tab.name}
          </a>
        </li>
      ))}
    </ul>
  )
}
