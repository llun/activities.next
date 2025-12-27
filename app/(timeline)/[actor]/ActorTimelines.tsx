'use client'

import { FC, useState } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { Status, StatusType } from '@/lib/models/status'

interface Props {
  host: string
  currentTime: Date
  statuses: Status[]
}

const getAttachments = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.attachments
    case StatusType.enum.Announce:
      return status.originalStatus.attachments
    default:
      return []
  }
}

const isReply = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return !!status.reply
    case StatusType.enum.Announce:
      return false
    default:
      return false
  }
}

export const ActorTimelines: FC<Props> = ({ host, currentTime, statuses }) => {
  const [activeTab, setActiveTab] = useState('posts')

  const postStatuses = statuses.filter((status) => !isReply(status))
  const mediaStatuses = statuses.filter(
    (status) => getAttachments(status).length > 0
  )

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-muted/40 p-1">
        <TabsTrigger
          value="posts"
          className="rounded-md data-[state=active]:bg-background"
        >
          Posts
        </TabsTrigger>
        <TabsTrigger
          value="replies"
          className="rounded-md data-[state=active]:bg-background"
        >
          Posts & Replies
        </TabsTrigger>
        <TabsTrigger
          value="media"
          className="rounded-md data-[state=active]:bg-background"
        >
          Media
        </TabsTrigger>
      </TabsList>

      <TabsContent value="posts" className="mt-0">
        {postStatuses.length > 0 ? (
          <Posts
            host={host}
            className="mt-0"
            currentTime={currentTime}
            statuses={postStatuses}
          />
        ) : (
          <p className="p-8 text-center text-muted-foreground">No posts yet</p>
        )}
      </TabsContent>

      <TabsContent value="replies" className="mt-0">
        <Posts
          host={host}
          className="mt-0"
          currentTime={currentTime}
          statuses={statuses}
        />
      </TabsContent>

      <TabsContent value="media" className="mt-0">
        {mediaStatuses.length > 0 ? (
          <Posts
            host={host}
            className="mt-0"
            currentTime={currentTime}
            statuses={mediaStatuses}
          />
        ) : (
          <p className="p-8 text-center text-muted-foreground">
            No media posts yet
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}
