import cn from 'classnames'
import { FC, useState } from 'react'

export interface Tab {
  name: string
}

interface Props {
  tabs: Tab[]
  onClickTab: (tab: Tab) => void
}

export const TimelineTabs: FC<Props> = ({ tabs, onClickTab }) => {
  const [currentTab, setCurrentTab] = useState<Tab>()

  return (
    <ul>
      {tabs.map((tab) => (
        <a
          key={tab.name}
          className={cn('nav-link', { active: currentTab?.name === tab.name })}
          onClick={(event) => {
            event.preventDefault()
            setCurrentTab(tab)
            onClickTab(tab)
          }}
        >
          {tab.name}
        </a>
      ))}
    </ul>
  )
}
