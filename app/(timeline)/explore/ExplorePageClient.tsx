'use client'

import { Compass } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { Posts } from '@/lib/components/posts/posts'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { TrendLinkCard } from '@/lib/components/trends/trend-link-card'
import { TrendTagRow } from '@/lib/components/trends/trend-tag-row'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Tag } from '@/lib/types/mastodon/tag'

type ExploreTab = 'tags' | 'posts' | 'news'

interface ExplorePageClientProps {
  host: string
  currentActor: ActorProfile
  currentTime: number
  isMediaUploadEnabled: boolean
  postLineLimit?: PostLineLimit
}

const EXPLORE_LIMIT = 20

const tabs: { value: ExploreTab; label: string }[] = [
  { value: 'tags', label: 'Hashtags' },
  { value: 'posts', label: 'Posts' },
  { value: 'news', label: 'News' }
]

const getExploreTab = (value: string | null): ExploreTab =>
  value === 'posts' || value === 'news' ? value : 'tags'

// Tag-shaped rows (a name over a "people" line, and a sparkline) in a frame,
// for the Hashtags and News tabs; the Posts tab draws `PostListSkeleton`.
const TrendRowsSkeleton = ({ count = 4 }: { count?: number }) => (
  <Frame divided>
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className="flex items-center justify-between gap-4 px-4 py-3"
      >
        <div className="min-w-0 space-y-2">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3 w-48 max-w-full" />
        </div>
        <SkeletonBar className="h-6 w-14 shrink-0" />
      </div>
    ))}
  </Frame>
)

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface ListState<T> {
  status: LoadStatus
  items: T[]
}

const initialState = <T,>(): ListState<T> => ({ status: 'idle', items: [] })

// The /explore page body — a segmented control over three trend lists
// (hashtags, posts, news). Each list is fetched lazily the first time its tab
// is shown and cached for the rest of the session.
export const ExplorePageClient = ({
  host,
  currentActor,
  currentTime,
  isMediaUploadEnabled,
  postLineLimit
}: ExplorePageClientProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = getExploreTab(searchParams.get('tab'))

  const [tagsState, setTagsState] = useState<ListState<Tag>>(initialState)
  const [postsState, setPostsState] = useState<ListState<Status>>(initialState)
  const [linksState, setLinksState] =
    useState<ListState<PreviewCard>>(initialState)

  const loadTags = useCallback(() => {
    setTagsState({ status: 'loading', items: [] })
    getTrendingTags(EXPLORE_LIMIT)
      .then((items) => setTagsState({ status: 'loaded', items }))
      .catch(() => setTagsState({ status: 'error', items: [] }))
  }, [])

  const loadPosts = useCallback(() => {
    setPostsState({ status: 'loading', items: [] })
    getTrendingStatuses(EXPLORE_LIMIT)
      .then((items) => setPostsState({ status: 'loaded', items }))
      .catch(() => setPostsState({ status: 'error', items: [] }))
  }, [])

  const loadLinks = useCallback(() => {
    setLinksState({ status: 'loading', items: [] })
    getTrendingLinks(EXPLORE_LIMIT)
      .then((items) => setLinksState({ status: 'loaded', items }))
      .catch(() => setLinksState({ status: 'error', items: [] }))
  }, [])

  // Fetch the active tab once, lazily. The loaders are stable (memoized with
  // empty deps), so depending on them keeps the effect honest without re-running
  // on every render.
  useEffect(() => {
    if (tab === 'tags' && tagsState.status === 'idle') {
      loadTags()
    }
    if (tab === 'posts' && postsState.status === 'idle') {
      loadPosts()
    }
    if (tab === 'news' && linksState.status === 'idle') {
      loadLinks()
    }
  }, [
    tab,
    tagsState.status,
    postsState.status,
    linksState.status,
    loadTags,
    loadPosts,
    loadLinks
  ])

  const onTabChange = (value: string) => {
    const nextTab = getExploreTab(value)
    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'tags') {
      params.delete('tab')
    } else {
      params.set('tab', nextTab)
    }
    const query = params.toString()
    // Keep the reader's scroll position when flipping tabs.
    router.replace(query ? `/explore?${query}` : '/explore', { scroll: false })
  }

  const activeState =
    tab === 'tags' ? tagsState : tab === 'posts' ? postsState : linksState
  const reloadActiveTab =
    tab === 'tags' ? loadTags : tab === 'posts' ? loadPosts : loadLinks

  const renderBody = () => {
    if (activeState.status === 'loading' || activeState.status === 'idle') {
      return (
        <div role="status">
          <span className="sr-only">
            {tab === 'posts' ? 'Loading posts' : 'Loading trends'}
          </span>
          {tab === 'posts' ? (
            <PostListSkeleton rows={4} />
          ) : (
            <TrendRowsSkeleton count={4} />
          )}
        </div>
      )
    }
    if (activeState.status === 'error') {
      // The loader flips the tab back to 'loading' immediately, so the Retry
      // button unmounts on click — no separate in-flight guard is needed.
      return (
        <Alert title="Couldn't load trends right now" onRetry={reloadActiveTab}>
          Try again in a moment.
        </Alert>
      )
    }
    if (tab === 'tags') {
      if (tagsState.items.length === 0) {
        return (
          <EmptyState icon={Compass} title="Nothing is trending right now">
            Trends appear once enough people use a hashtag in the same few days.
          </EmptyState>
        )
      }
      return (
        <FramedList aria-label="Trending hashtags">
          {tagsState.items.map((item) => (
            <FramedListItem key={item.name} className="p-0">
              <TrendTagRow tag={item} />
            </FramedListItem>
          ))}
        </FramedList>
      )
    }
    if (tab === 'posts') {
      if (postsState.items.length === 0) {
        return (
          <EmptyState icon={Compass} title="No posts are trending right now">
            Posts trend as people reply, boost, and favourite them.
          </EmptyState>
        )
      }
      return (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={postsState.items}
          currentActor={currentActor}
          showActions
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          // A reply or quote composed here posts to the server and the shared
          // composer closes itself; /explore just doesn't fold the new status
          // into this trends list, so no onStatusCreated is needed. Edits do
          // reflect in place.
          onPostUpdated={(updated) =>
            setPostsState((previous) => ({
              ...previous,
              items: previous.items.map((item) =>
                item.id === updated.id ? updated : item
              )
            }))
          }
        />
      )
    }
    if (linksState.items.length === 0) {
      return (
        <EmptyState icon={Compass} title="No trending links right now">
          Links start trending once enough people share the same article in a
          few days.
        </EmptyState>
      )
    }
    return (
      <FramedList aria-label="Trending links">
        {linksState.items.map((item) => (
          <FramedListItem key={item.url} className="p-0">
            <TrendLinkCard link={item} />
          </FramedListItem>
        ))}
      </FramedList>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Explore"
        description="What's gaining traction across the fediverse right now."
      />

      <SegmentedControl
        aria-label="Explore sections"
        items={tabs}
        value={tab}
        onValueChange={onTabChange}
        className="sm:w-fit"
      />

      {renderBody()}
    </div>
  )
}
