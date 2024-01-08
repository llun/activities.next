'use client'

import { FC, useState } from 'react'

import { ActorAttachments } from '@/lib/components/ActorAttachments'
import { ActorTab, ActorTabs } from '@/lib/components/ActorTab'
import { Posts } from '@/lib/components/Posts/Posts'
import { AttachmentData } from '@/lib/models/attachment'
import { StatusData } from '@/lib/models/status'

interface Props {
  currentTime: Date
  statuses: StatusData[]
  attachments: AttachmentData[]
}

export const ActorTimelines: FC<Props> = ({
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
