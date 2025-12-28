'use client'

import { FC } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { Status, StatusType } from '@/lib/models/status'

import { ActorMediaGallery } from './ActorMediaGallery'

interface Props {
  host: string
  statuses: Status[]
}

const getPostAttachments = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.attachments
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

export const ActorTimelines: FC<Props> = ({ host, statuses }) => {
  const currentTime = new Date()

  const postStatuses = statuses.filter((status) => !isReply(status))
  const mediaAttachments = statuses
    .flatMap((status) =>
      getPostAttachments(status).map((attachment) => ({
        attachment,
        createdAt: status.createdAt
      }))
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter(
      (entry, index, list) =>
        list.findIndex((item) => item.attachment.id === entry.attachment.id) ===
        index
    )
    .map((entry) => entry.attachment)

  return (
    <Tabs defaultValue="posts" className="w-full">
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
        {mediaAttachments.length > 0 ? (
          <div className="p-2 sm:p-4">
            <ActorMediaGallery attachments={mediaAttachments} />
          </div>
        ) : (
          <p className="p-8 text-center text-muted-foreground">
            No media posts yet
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}
