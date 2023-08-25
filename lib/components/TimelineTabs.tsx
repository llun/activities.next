import cn from 'classnames'
import { FC } from 'react'

export interface Tab {
  name: string
  link: string
}

interface Props {
  currentTab: Tab
  tabs: Tab[]
  onClickTab: (tab: Tab) => void
}

export const TimelineTabs: FC<Props> = ({ currentTab, tabs, onClickTab }) => {
  return (
    <ul className="nav nav-tabs">
      {tabs.map((tab) => (
        <li key={tab.name} className="nav-item">
          <a
            href={`#timeline/${tab.link}`}
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
