import cn from 'classnames'
import { FC } from 'react'

export enum ActorTab {
  Posts,
  Medias
}

interface Props {
  currentTab: ActorTab
  onClickTab: (tab: ActorTab) => Promise<void>
}

export const ActorTabs: FC<Props> = ({ currentTab, onClickTab }) => {
  return (
    <ul className={cn('nav', 'nav-tabs', 'mt-4')}>
      <li className="nav-item">
        <a
          href={`#actors/posts`}
          className={cn('nav-link', {
            active: currentTab === ActorTab.Posts
          })}
          onClick={async (event) => {
            event.preventDefault()
            await onClickTab(ActorTab.Posts)
          }}
        >
          Posts
        </a>
      </li>
      <li className="nav-item">
        <a
          href={`#actors/medias`}
          className={cn('nav-link', {
            active: currentTab === ActorTab.Medias
          })}
          onClick={async (event) => {
            event.preventDefault()
            await onClickTab(ActorTab.Medias)
          }}
        >
          Medias
        </a>
      </li>
    </ul>
  )
}
