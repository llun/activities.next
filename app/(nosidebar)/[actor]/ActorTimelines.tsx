'use client'

import { FC, useState } from 'react'

import { ActorAttachments } from '@/lib/components/ActorAttachments'
import { ActorTab, ActorTabs } from '@/lib/components/ActorTab'
import { Posts } from '@/lib/components/Posts/Posts'
import { AttachmentData } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'

interface Props {
  host: string
  currentTime: Date
  statuses: Status[]
  attachments: AttachmentData[]
}

export const ActorTimelines: FC<Props> = ({
  host,
  currentTime,
  statuses,
  attachments
}) => {
  const [currentTab, setCurrentTab] = useState<ActorTab>(ActorTab.Posts)

  return (
    <>
      {attachments.length > 0 && (
        <ActorTabs
          currentTab={currentTab}
          onClickTab={async (tab) => setCurrentTab(tab)}
        />
      )}
      {currentTab === ActorTab.Posts && (
        <Posts
          host={host}
          className={attachments.length > 0 ? 'mt-2' : 'mt-4'}
          currentTime={currentTime}
          statuses={statuses}
        />
      )}
      {currentTab === ActorTab.Medias && (
        <ActorAttachments className="mt-2" attachments={attachments} />
      )}
    </>
  )
}
