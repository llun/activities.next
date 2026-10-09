'use client'

import { Hash, Search as SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { SearchResult, SearchType, search as searchClient } from '@/lib/client'
import { CustomEmojiText } from '@/lib/components/actors/ActorDisplayName'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { Posts } from '@/lib/components/posts/posts'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { TrendingNowBlock } from '@/lib/components/trends/trending-now-block'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Tag } from '@/lib/types/mastodon/tag'
import { cn } from '@/lib/utils'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

type SearchTab = 'all' | SearchType

interface SearchPageClientProps {
  host: string
  currentActor: ActorProfile
  currentTime: number
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

type SearchTag = Tag & {
  postCount?: number
}

const SEARCH_LIMIT = 20
const ALL_SEARCH_LIMIT = 5

const tabs: { value: SearchTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'accounts', label: 'Profiles' },
  { value: 'statuses', label: 'Posts' },
  { value: 'hashtags', label: 'Hashtags' }
]

const emptySearchResult = (): SearchResult => ({
  accounts: [],
  statuses: [],
  hashtags: []
})

const getSearchTab = (type: string | null): SearchTab => {
  if (type === 'accounts' || type === 'statuses' || type === 'hashtags') {
    return type
  }
  return 'all'
}

const getSearchType = (tab: SearchTab): SearchType | undefined =>
  tab === 'all' ? undefined : tab

const getSearchLimit = (tab: SearchTab) =>
  tab === 'all' ? ALL_SEARCH_LIMIT : SEARCH_LIMIT

const getSearchPath = (query: string, tab: SearchTab) => {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return '/search'

  const params = new URLSearchParams({ q: trimmedQuery })
  const type = getSearchType(tab)
  if (type) params.set('type', type)
  return `/search?${params.toString()}`
}

const hasResults = (results: SearchResult) =>
  results.accounts.length > 0 ||
  results.statuses.length > 0 ||
  results.hashtags.length > 0

const getTabResultCount = (results: SearchResult, tab: SearchTab) => {
  if (tab === 'accounts') return results.accounts.length
  if (tab === 'statuses') return results.statuses.length
  if (tab === 'hashtags') return results.hashtags.length
  return 0
}

const getTabResults = (results: SearchResult, tab: SearchTab) => {
  if (tab === 'accounts') return results.accounts
  if (tab === 'statuses') return results.statuses
  if (tab === 'hashtags') return results.hashtags
  return []
}

const appendUniqueBy = <T,>(
  previous: T[],
  next: T[],
  getKey: (item: T) => string
) => {
  const seen = new Set(previous.map(getKey))
  return [
    ...previous,
    ...next.filter((item) => {
      const key = getKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  ]
}

const appendTabResults = (
  previous: SearchResult,
  next: SearchResult,
  tab: SearchTab
): SearchResult => {
  if (tab === 'accounts') {
    return {
      ...previous,
      accounts: appendUniqueBy(
        previous.accounts,
        next.accounts,
        (account) => account.id
      )
    }
  }
  if (tab === 'statuses') {
    return {
      ...previous,
      statuses: appendUniqueBy(
        previous.statuses,
        next.statuses,
        (status) => status.id
      )
    }
  }
  if (tab === 'hashtags') {
    return {
      ...previous,
      hashtags: appendUniqueBy(
        previous.hashtags,
        next.hashtags,
        (tag) => tag.name
      )
    }
  }
  return previous
}

const isAbortError = (err: unknown) =>
  err instanceof Error && err.name === 'AbortError'

const getAccountUsername = (account: MastodonAccount) =>
  account.username || account.acct?.split('@')[0] || 'unknown'

const getAccountLabel = (account: MastodonAccount) =>
  account.display_name || account.username || account.acct || 'Unknown profile'

const getAccountHandle = (account: MastodonAccount, host: string) => {
  const username = getAccountUsername(account)
  const acct = account.acct || username
  return acct.includes('@') ? `@${acct}` : `@${username}@${host}`
}

const getAccountInitial = (account: MastodonAccount) => {
  const name = account.display_name || account.username || account.acct || ''
  const trimmed = name.trim()
  return Array.from(trimmed)[0]?.toUpperCase() ?? '?'
}

const getTagPostCount = (tag: SearchTag) => {
  if (typeof tag.postCount === 'number') return tag.postCount
  const uses = tag.history?.[0]?.uses
  if (uses === undefined || uses === null || uses === '') return null
  const historyCount = Number(uses)
  return Number.isFinite(historyCount) ? historyCount : null
}

const ROW_LINK_CLASS =
  'flex min-w-0 gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50'

const AccountRow = ({
  account,
  host
}: {
  account: MastodonAccount
  host: string
}) => {
  const handle = getAccountHandle(account, host)
  const label = getAccountLabel(account)
  const note = useMemo(
    () => htmlToPlainText(account.note ?? '').trim(),
    [account.note]
  )

  return (
    <FramedListItem className="p-0">
      <Link
        href={`/${handle}`}
        prefetch={false}
        className={cn(ROW_LINK_CLASS, 'items-start')}
      >
        <Avatar className="size-11 shrink-0">
          {account.avatar && <AvatarImage src={account.avatar} />}
          <AvatarFallback>{getAccountInitial(account)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="truncate text-sm font-medium">
              <CustomEmojiText text={label} emojis={account.emojis} />
            </p>
            <p className="truncate text-xs text-muted-foreground">{handle}</p>
          </div>
          {note && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              <CustomEmojiText text={note} emojis={account.emojis} />
            </p>
          )}
        </div>
      </Link>
    </FramedListItem>
  )
}

const HashtagRow = ({ tag }: { tag: SearchTag }) => {
  const postCount = getTagPostCount(tag)

  return (
    <FramedListItem className="p-0">
      <Link
        href={`/tags/${encodeURIComponent(tag.name)}`}
        prefetch={false}
        className={cn(ROW_LINK_CLASS, 'items-center')}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Hash className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">#{tag.name}</p>
          {postCount !== null && (
            <p className="text-xs text-muted-foreground">
              {postCount} {postCount === 1 ? 'post' : 'posts'}
            </p>
          )}
        </div>
      </Link>
    </FramedListItem>
  )
}

// What a search draws while it runs: post rows on the Posts tab, otherwise
// profile-shaped rows (an avatar over two lines) in a frame. One polite
// "Searching" for assistive tech, no text on screen.
const SearchSkeleton = ({ posts }: { posts: boolean }) => (
  <div role="status">
    <span className="sr-only">Searching</span>
    {posts ? (
      <PostListSkeleton />
    ) : (
      <Frame divided>
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex items-start gap-3 px-4 py-3">
            <SkeletonBar className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-40 max-w-full" />
              <SkeletonBar className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </Frame>
    )}
  </div>
)

export const SearchPageClient = ({
  host,
  currentActor,
  currentTime,
  isMediaUploadEnabled,
  postLineLimit
}: SearchPageClientProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [inputValue, setInputValue] = useState(
    () => searchParams.get('q') ?? ''
  )
  const [submittedQuery, setSubmittedQuery] = useState(
    () => searchParams.get('q') ?? ''
  )
  const [activeTab, setActiveTab] = useState<SearchTab>(() =>
    getSearchTab(searchParams.get('type'))
  )
  const [results, setResults] = useState<SearchResult>(emptySearchResult)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  // Bumped by the failed search's Retry to run the same search again.
  const [retryCount, setRetryCount] = useState(0)
  const submittedQueryRef = useRef(submittedQuery)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const setSubmittedQueryValue = useCallback((query: string) => {
    submittedQueryRef.current = query
    setSubmittedQuery(query)
  }, [])

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? ''
    const nextTab = getSearchTab(searchParams.get('type'))
    if (submittedQueryRef.current !== nextQuery) {
      setInputValue(nextQuery)
    }
    setSubmittedQueryValue(nextQuery)
    setActiveTab(nextTab)
  }, [searchParams, setSubmittedQueryValue])

  useEffect(() => {
    const query = submittedQuery.trim()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortControllerRef.current?.abort()

    if (!query) {
      setResults(emptySearchResult())
      setError(false)
      setIsLoading(false)
      setIsLoadingMore(false)
      setHasMore(false)
      return
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setIsLoading(true)
    setIsLoadingMore(false)
    setError(false)
    setHasMore(false)
    setResults(emptySearchResult())

    void searchClient({
      q: query,
      type: getSearchType(activeTab),
      limit: getSearchLimit(activeTab),
      offset: activeTab === 'all' ? undefined : 0,
      resolve: true,
      signal: abortController.signal
    })
      .then((nextResults) => {
        if (requestIdRef.current !== requestId) return
        setResults(nextResults)
        setHasMore(
          activeTab !== 'all' &&
            getTabResults(nextResults, activeTab).length ===
              getSearchLimit(activeTab)
        )
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return
        if (isAbortError(err)) return
        setResults(emptySearchResult())
        setError(true)
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return
        setIsLoading(false)
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
      })

    return () => {
      abortController.abort()
    }
  }, [activeTab, submittedQuery, retryCount])

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = inputValue.trim()
    const nextTab = query ? activeTab : 'all'
    const previousSubmittedQuery = submittedQueryRef.current
    if (!query) setInputValue('')
    setSubmittedQueryValue(query)
    setActiveTab(nextTab)
    const nextPath = getSearchPath(query, nextTab)
    if (query && query !== previousSubmittedQuery) {
      router.push(nextPath)
    } else {
      router.replace(nextPath)
    }
  }

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setInputValue(value)
    if (value.trim()) return

    requestIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setSubmittedQueryValue('')
    setActiveTab('all')
    if (searchParams.toString()) router.replace('/search')
  }

  const onTabChange = (value: string) => {
    const nextTab = getSearchTab(value)
    setActiveTab(nextTab)
    router.replace(getSearchPath(submittedQuery, nextTab))
  }

  const loadMore = async () => {
    const query = submittedQuery.trim()
    const type = getSearchType(activeTab)
    if (!query || !type || isLoadingMore) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setIsLoadingMore(true)
    setError(false)

    try {
      const nextResults = await searchClient({
        q: query,
        type,
        limit: SEARCH_LIMIT,
        offset: getTabResultCount(results, activeTab),
        resolve: true,
        signal: abortController.signal
      })
      if (requestIdRef.current !== requestId) return
      setResults((previous) =>
        appendTabResults(previous, nextResults, activeTab)
      )
      setHasMore(getTabResults(nextResults, activeTab).length === SEARCH_LIMIT)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      if (isAbortError(err)) return
      setError(true)
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoadingMore(false)
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
      }
    }
  }

  const renderAccounts = (accounts: MastodonAccount[]) => (
    <FramedList aria-label="Profiles">
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} host={host} />
      ))}
    </FramedList>
  )

  const renderHashtags = (hashtags: Tag[]) => (
    <FramedList aria-label="Hashtags">
      {hashtags.map((tag) => (
        <HashtagRow key={tag.name} tag={tag} />
      ))}
    </FramedList>
  )

  const handlePostUpdated = (updated: Status) =>
    setResults((previous) => ({
      ...previous,
      statuses: previous.statuses.map((item) =>
        item.id === updated.id ? updated : item
      )
    }))

  const renderPosts = (statuses: Status[]) => (
    <Posts
      host={host}
      currentTime={currentTime}
      statuses={statuses}
      currentActor={currentActor}
      showActions
      isMediaUploadEnabled={isMediaUploadEnabled}
      postLineLimit={postLineLimit}
      onPostUpdated={handlePostUpdated}
    />
  )

  // The All tab names each kind of result with its own section; a typed tab is
  // already named by the tab, so it draws the one list.
  const renderAllResults = () => {
    if (!hasResults(results)) return null

    return (
      <div className="space-y-6">
        {results.accounts.length > 0 && (
          <Section title="Profiles">{renderAccounts(results.accounts)}</Section>
        )}
        {results.statuses.length > 0 && (
          <Section title="Posts">{renderPosts(results.statuses)}</Section>
        )}
        {results.hashtags.length > 0 && (
          <Section title="Hashtags">{renderHashtags(results.hashtags)}</Section>
        )}
      </div>
    )
  }

  const renderTypedResults = () => {
    if (activeTab === 'accounts') return renderAccounts(results.accounts)
    if (activeTab === 'statuses') return renderPosts(results.statuses)
    if (activeTab === 'hashtags') return renderHashtags(results.hashtags)
    return renderAllResults()
  }

  const hasVisibleResults =
    activeTab === 'all'
      ? hasResults(results)
      : getTabResultCount(results, activeTab) > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Find profiles, posts, and tags."
      />

      <form
        role="search"
        aria-label="Search"
        className="flex gap-2"
        onSubmit={submitSearch}
      >
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search"
            value={inputValue}
            onChange={onInputChange}
            placeholder="Search"
            className="pl-9"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Search
        </Button>
      </form>

      <SegmentedControl
        aria-label="Search in"
        items={tabs}
        value={activeTab}
        onValueChange={onTabChange}
      />

      {/* Before a query is typed, surface the top trending hashtags. The block
          self-hides when the server has no qualifying trends, falling back to
          the empty-search placeholder below. */}
      {!submittedQuery.trim() && <TrendingNowBlock />}

      {error && !hasVisibleResults ? (
        <Alert
          title="Search failed"
          onRetry={() => setRetryCount((count) => count + 1)}
        >
          Try again in a moment.
        </Alert>
      ) : isLoading ? (
        <SearchSkeleton posts={activeTab === 'statuses'} />
      ) : !submittedQuery.trim() ? (
        <EmptyState icon={SearchIcon} titleAs="h2" title="No search yet">
          Enter a query to start.
        </EmptyState>
      ) : hasVisibleResults ? (
        renderTypedResults()
      ) : (
        <EmptyState icon={SearchIcon} titleAs="h2" title="No results found">
          No matches for &quot;{submittedQuery}&quot;.
        </EmptyState>
      )}

      {activeTab !== 'all' && hasMore && (
        <div className="space-y-3">
          {error && (
            <Alert title="Failed to load more results">
              Use Load more to try again.
            </Alert>
          )}
          <div className="text-center">
            <LoadMoreButton isLoading={isLoadingMore} onClick={loadMore} />
          </div>
        </div>
      )}
    </div>
  )
}
