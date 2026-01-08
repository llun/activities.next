import { FC } from 'react'

import { cn } from '@/lib/utils'

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
    <ul className="flex border-b border-border mt-4">
      <li className="mr-2">
        <a
          href={`#actors/posts`}
          className={cn(
            'inline-block px-4 py-2 rounded-t-lg hover:text-foreground hover:border-border',
            {
              'border-b-2 border-primary text-primary':
                currentTab === ActorTab.Posts,
              'border-transparent': currentTab !== ActorTab.Posts
            }
          )}
          onClick={async (event) => {
            event.preventDefault()
            await onClickTab(ActorTab.Posts)
          }}
        >
          Posts
        </a>
      </li>
      <li className="mr-2">
        <a
          href={`#actors/medias`}
          className={cn(
            'inline-block px-4 py-2 rounded-t-lg hover:text-foreground hover:border-border',
            {
              'border-b-2 border-primary text-primary':
                currentTab === ActorTab.Medias,
              'border-transparent': currentTab !== ActorTab.Medias
            }
          )}
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
