'use client'

import { FC, useReducer, useState } from 'react'

import { getTimeline } from '@/lib/client'
import { PostBox } from '@/lib/components/PostBox/PostBox'
import { Posts } from '@/lib/components/Posts/Posts'
import { TimelineLoadMoreButton } from '@/lib/components/TimelineLoadMoreButton'
import { Tab, TimelineTabs } from '@/lib/components/TimelineTabs'
import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus, Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'

import {
  clearAction,
  editAction,
  replyAction,
  statusActionReducer
} from './reducer'

const TIMELINES_TABS: Tab[] = [
  { timeline: Timeline.MAIN, name: 'Home' },
  { timeline: Timeline.NOANNOUNCE, name: 'No Announces' },
  { timeline: Timeline.MENTION, name: 'Mention' }
]

interface MainPageTimelineProps {
  host: string
  profile: ActorProfile
  isMediaUploadEnabled: boolean
  statuses: Status[]
}

export const MainPageTimeline: FC<MainPageTimelineProps> = ({
  host,
  profile,
  isMediaUploadEnabled,
  statuses
}) => {
  const [currentTab, setCurrentTab] = useState<Tab>(TIMELINES_TABS[0])
  const [statusActionState, dispatchStatusAction] = useReducer(
    statusActionReducer,
    {}
  )
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)

  const onReply = (status: Status) => {
    dispatchStatusAction(replyAction(status))
    window.scrollTo({ top: 0 })
  }

  const onEdit = (status: EditableStatus) => {
    dispatchStatusAction(editAction(status))
    window.scrollTo({ top: 0 })
  }

  const onPostDeleted = (status: Status) => {
    const statusIndex = currentStatuses.indexOf(status)
    setCurrentStatuses([
      ...currentStatuses.slice(0, statusIndex),
      ...currentStatuses.slice(statusIndex + 1)
    ])
  }

  return (
    <div>
      <PostBox
        host={host}
        profile={profile}
        replyStatus={statusActionState.replyStatus}
        editStatus={statusActionState.editStatus}
        isMediaUploadEnabled={isMediaUploadEnabled}
        onDiscardReply={() => dispatchStatusAction(clearAction())}
        onDiscardEdit={() => dispatchStatusAction(clearAction())}
        onPostCreated={(status: Status) => {
          setCurrentStatuses((previousValue) => [status, ...previousValue])
          dispatchStatusAction(clearAction())
        }}
        onPostUpdated={(updatedStatus: Status) => {
          const index = currentStatuses.findIndex(
            (status) => status.id === updatedStatus.id
          )
          // TODO: Update status in Timeline somehow.
          if (index >= 0) {
            currentStatuses[index] = updatedStatus
            setCurrentStatuses(() => currentStatuses)
          }
          dispatchStatusAction(clearAction())
        }}
      />
      <TimelineTabs
        currentTab={currentTab}
        tabs={TIMELINES_TABS}
        onClickTab={async (tab) => {
          setCurrentTab(tab)
          setCurrentStatuses([])
          setLoadingMoreStatuses(true)

          const statuses = await getTimeline({
            timeline: tab.timeline
          })
          setCurrentStatuses(statuses)
          setLoadingMoreStatuses(false)
        }}
      />
      <Posts
        host={host}
        className="mt-4"
        currentTime={new Date()}
        statuses={currentStatuses}
        currentActor={profile}
        showActions
        onReply={onReply}
        onEdit={onEdit}
        onPostDeleted={onPostDeleted}
      />
      <TimelineLoadMoreButton
        disabled={isLoadingMoreStatuses}
        onClick={async () => {
          setLoadingMoreStatuses(true)
          const statuses = await getTimeline({
            timeline: currentTab.timeline,
            maxStatusId: currentStatuses[currentStatuses.length - 1].id
          })
          setCurrentStatuses([...currentStatuses, ...statuses])
          setLoadingMoreStatuses(false)
        }}
      />
    </div>
  )
}
