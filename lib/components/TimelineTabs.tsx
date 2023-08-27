import cn from 'classnames'
import { FC } from 'react'

import { Timeline } from '../timelines/types'

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
    <ul className={cn('nav', 'nav-tabs', 'mt-4')}>
      {tabs.map((tab) => (
        <li key={tab.name} className="nav-item">
          <a
            href={`#timeline/${tab.timeline}`}
            className={cn('nav-link', {
              active: currentTab.name === tab.name
            })}
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
