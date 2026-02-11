'use client'

import { FC, useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { getTimeline } from '@/lib/client'
import { PostBox } from '@/lib/components/post-box/post-box'
import { Posts } from '@/lib/components/posts/posts'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { Timeline } from '@/lib/services/timelines/types'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, Status } from '@/lib/types/domain/status'

import { clearAction, editAction, statusActionReducer } from './reducer'

interface Tab {
  name: string
  timeline: Timeline
}

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
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const tabRequestId = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)

  const onEdit = (status: EditableStatus) => {
    dispatchStatusAction(editAction(status))
    window.scrollTo({ top: 0 })
  }

  const onReplyCreated = (status: Status) => {
    setCurrentStatuses((previousValue) => [status, ...previousValue])
  }

  const onPostDeleted = (status: Status) => {
    const statusIndex = currentStatuses.indexOf(status)
    setCurrentStatuses([
      ...currentStatuses.slice(0, statusIndex),
      ...currentStatuses.slice(statusIndex + 1)
    ])
  }

  const loadMoreStatuses = useCallback(async () => {
    if (isLoadingRef.current || currentStatuses.length === 0) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      const statuses = await getTimeline({
        timeline: currentTab.timeline,
        maxStatusId: currentStatuses[currentStatuses.length - 1].id
      })
      if (statuses.length === 0) {
        setHasMoreStatuses(false)
        return
      }
      setCurrentStatuses((prev) => [...prev, ...statuses])
    } catch (_error) {
      // Error loading more - user can retry by clicking the button
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [currentTab.timeline, currentStatuses])

  // Set up IntersectionObserver for automatic loading
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        setIsLoadMoreVisible(entry.isIntersecting)

        // Automatically load more when the button comes into view
        // The loadMoreStatuses callback has its own guard against duplicate loads
        if (entry.isIntersecting) {
          loadMoreStatuses()
        }
      },
      {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
      }
    )

    observer.observe(loadMoreElement)

    return () => {
      observer.disconnect()
    }
  }, [loadMoreStatuses])

  const onTabChange = async (value: string) => {
    const tab = TIMELINES_TABS.find((t) => t.timeline === value)
    if (!tab) return

    const requestId = tabRequestId.current + 1
    tabRequestId.current = requestId

    setCurrentTab(tab)
    setCurrentStatuses([])
    setHasMoreStatuses(true)
    setLoadingMoreStatuses(true)

    try {
      const statuses = await getTimeline({
        timeline: tab.timeline
      })
      if (requestId !== tabRequestId.current) return
      setCurrentStatuses(statuses)
      setHasMoreStatuses(statuses.length > 0)
    } finally {
      if (requestId === tabRequestId.current) {
        setLoadingMoreStatuses(false)
      }
    }
  }

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <div>
        <h1 className="text-2xl font-semibold">Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Latest posts from your network.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <div className="p-4 pb-2">
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
        </div>

        <Tabs
          value={currentTab.timeline}
          onValueChange={onTabChange}
          className="w-full"
        >
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b bg-muted/40 p-1">
            {TIMELINES_TABS.map((tab) => (
              <TabsTrigger
                key={tab.timeline}
                value={tab.timeline}
                className="rounded-md data-[state=active]:bg-background"
              >
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={currentTab.timeline} className="mt-0">
            {currentStatuses.length > 0 ? (
              <Posts
                host={host}
                className="mt-0"
                currentTime={new Date()}
                statuses={currentStatuses}
                currentActor={profile}
                showActions
                isMediaUploadEnabled={isMediaUploadEnabled}
                onReplyCreated={onReplyCreated}
                onEdit={onEdit}
                onPostDeleted={onPostDeleted}
              />
            ) : isLoadingMoreStatuses ? (
              <div className="p-8 text-center text-muted-foreground">
                <p className="text-sm font-medium">Loading timeline...</p>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <h2 className="text-xl font-semibold mb-2">
                  Your timeline is empty
                </h2>
                <p className="mb-6">
                  Follow some people to see their posts here.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {hasMoreStatuses && currentStatuses.length > 0 && (
          <div ref={loadMoreRef} className="p-4 text-center border-t">
            <Button
              variant="outline"
              disabled={isLoadingMoreStatuses}
              onClick={loadMoreStatuses}
            >
              {isLoadingMoreStatuses ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
