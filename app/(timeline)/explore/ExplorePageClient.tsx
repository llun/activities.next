'use client'

import { Newspaper, TrendingUp } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { TrendLinkCard } from '@/lib/components/trends/trend-link-card'
import { TrendPostRow } from '@/lib/components/trends/trend-post-row'
import { TrendTagRow } from '@/lib/components/trends/trend-tag-row'
import { Button } from '@/lib/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { Tag } from '@/lib/types/mastodon/tag'

type ExploreTab = 'tags' | 'posts' | 'news'

interface ExplorePageClientProps {
  currentTime: number
}

const EXPLORE_LIMIT = 20

const tabs: { value: ExploreTab; label: string }[] = [
  { value: 'tags', label: 'Hashtags' },
  { value: 'posts', label: 'Posts' },
  { value: 'news', label: 'News' }
]

const getExploreTab = (value: string | null): ExploreTab =>
  value === 'posts' || value === 'news' ? value : 'tags'

const SkeletonRows = ({ count = 4 }: { count?: number }) => (
  <div className="space-y-2 px-3 py-2" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="flex items-center justify-between gap-4 py-2">
        <div className="w-full space-y-2">
          <div className="h-3.5 w-32 rounded bg-muted" />
          <div className="h-3 w-48 rounded bg-muted/60" />
        </div>
        <div className="h-6 w-14 rounded bg-muted/60" />
      </div>
    ))}
  </div>
)

const EmptyNote = ({
  children,
  action
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <TrendingUp className="size-[18px]" />
    </span>
    <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    {action && <div className="pt-1">{action}</div>}
  </div>
)

const NewsEmptyNote = () => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Newspaper className="size-[18px]" />
    </span>
    <p className="max-w-sm text-sm text-muted-foreground">
      No trending links right now. Links start trending once enough people share
      the same article in a few days.
    </p>
  </div>
)

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface ListState<T> {
  status: LoadStatus
  items: T[]
}

const initialState = <T,>(): ListState<T> => ({ status: 'idle', items: [] })

// The /explore page body — a segmented tab strip over three trend lists
// (hashtags, posts, news). Each list is fetched lazily the first time its tab
// is shown and cached for the rest of the session.
export const ExplorePageClient = ({ currentTime }: ExplorePageClientProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = getExploreTab(searchParams.get('tab'))

  const [tagsState, setTagsState] = useState<ListState<Tag>>(initialState)
  const [postsState, setPostsState] =
    useState<ListState<MastodonStatus>>(initialState)
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
    router.replace(query ? `/explore?${query}` : '/explore')
  }

  const activeState =
    tab === 'tags' ? tagsState : tab === 'posts' ? postsState : linksState
  const reloadActiveTab =
    tab === 'tags' ? loadTags : tab === 'posts' ? loadPosts : loadLinks

  const renderBody = () => {
    if (activeState.status === 'loading' || activeState.status === 'idle') {
      return <SkeletonRows count={4} />
    }
    if (activeState.status === 'error') {
      // The loader flips the tab back to 'loading' immediately, so the retry
      // button unmounts on click — no separate in-flight guard is needed.
      return (
        <EmptyNote
          action={
            <Button variant="outline" size="sm" onClick={reloadActiveTab}>
              Try again
            </Button>
          }
        >
          Couldn&apos;t load trends right now. Try again in a moment.
        </EmptyNote>
      )
    }
    if (tab === 'tags') {
      if (tagsState.items.length === 0) {
        return (
          <EmptyNote>
            Nothing is trending right now. Trends appear once enough people use
            a hashtag in the same few days.
          </EmptyNote>
        )
      }
      return (
        <div className="divide-y divide-border">
          {tagsState.items.map((item) => (
            <TrendTagRow key={item.name} tag={item} />
          ))}
        </div>
      )
    }
    if (tab === 'posts') {
      if (postsState.items.length === 0) {
        return (
          <EmptyNote>
            No posts are trending right now. Posts trend as people reply, boost,
            and favourite them.
          </EmptyNote>
        )
      }
      return (
        <div className="divide-y divide-border">
          {postsState.items.map((item) => (
            <TrendPostRow
              key={item.id}
              status={item}
              currentTime={currentTime}
            />
          ))}
        </div>
      )
    }
    if (linksState.items.length === 0) {
      return <NewsEmptyNote />
    }
    return (
      <div className="space-y-2 p-1">
        {linksState.items.map((item) => (
          <TrendLinkCard key={item.url} link={item} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Explore"
        description="What's gaining traction across the fediverse right now."
      />

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-lg p-1">
          {tabs.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="rounded-2xl border bg-card/80 p-2 shadow-sm backdrop-blur">
        {renderBody()}
      </div>
    </div>
  )
}
