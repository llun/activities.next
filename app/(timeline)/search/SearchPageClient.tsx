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
import type { ReactNode } from 'react'

import { SearchResult, SearchType, search as searchClient } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import { TrendingNowBlock } from '@/lib/components/trends/trending-now-block'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Tag } from '@/lib/types/mastodon/tag'
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
    <Link
      href={`/${handle}`}
      className="flex min-w-0 items-start gap-3 border-b border-border/60 p-4 transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <Avatar className="size-11 shrink-0">
        {account.avatar && <AvatarImage src={account.avatar} />}
        <AvatarFallback>{getAccountInitial(account)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{handle}</p>
        </div>
        {note && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </Link>
  )
}

const HashtagRow = ({ tag }: { tag: SearchTag }) => {
  const postCount = getTagPostCount(tag)

  return (
    <Link
      href={`/tags/${encodeURIComponent(tag.name)}`}
      className="flex items-center gap-3 border-b border-border/60 p-4 transition-colors last:border-b-0 hover:bg-muted/40"
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
  )
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-border/60 last:border-b-0">
    <h2 className="border-b border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </h2>
    {children}
  </section>
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
  }, [activeTab, submittedQuery])

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

  const renderAccounts = (accounts: MastodonAccount[]) =>
    accounts.map((account) => (
      <AccountRow key={account.id} account={account} host={host} />
    ))

  const renderHashtags = (hashtags: Tag[]) =>
    hashtags.map((tag) => <HashtagRow key={tag.name} tag={tag} />)

  const renderPosts = (statuses: Status[]) => (
    <Posts
      host={host}
      framed={false}
      currentTime={currentTime}
      statuses={statuses}
      currentActor={currentActor}
      showActions
      isMediaUploadEnabled={isMediaUploadEnabled}
      postLineLimit={postLineLimit}
    />
  )

  const renderAllResults = () => {
    if (!hasResults(results)) return null

    return (
      <>
        {results.accounts.length > 0 && (
          <Group title="Profiles">{renderAccounts(results.accounts)}</Group>
        )}
        {results.statuses.length > 0 && (
          <Group title="Posts">{renderPosts(results.statuses)}</Group>
        )}
        {results.hashtags.length > 0 && (
          <Group title="Hashtags">{renderHashtags(results.hashtags)}</Group>
        )}
      </>
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
            className="h-11 pl-9"
          />
        </div>
        <Button type="submit" className="h-11 shrink-0">
          Search
        </Button>
      </form>

      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-4 rounded-lg p-1">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Before a query is typed, surface the top trending hashtags. The block
          self-hides when the server has no qualifying trends, falling back to
          the empty-search placeholder below. */}
      {!submittedQuery.trim() && <TrendingNowBlock />}

      <section className="overflow-hidden rounded-lg border bg-background/80 shadow-sm">
        {error && !hasVisibleResults ? (
          <div
            className="p-8 text-center text-muted-foreground"
            aria-live="assertive"
          >
            <h2 className="mb-2 text-xl font-semibold">Search failed</h2>
            <p>Try again in a moment.</p>
          </div>
        ) : isLoading ? (
          <div
            className="p-8 text-center text-muted-foreground"
            aria-live="polite"
          >
            <p className="text-sm font-medium">Searching...</p>
          </div>
        ) : !submittedQuery.trim() ? (
          <div className="p-8 text-center text-muted-foreground">
            <h2 className="mb-2 text-xl font-semibold">No search yet</h2>
            <p>Enter a query to start.</p>
          </div>
        ) : hasVisibleResults ? (
          renderTypedResults()
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <h2 className="mb-2 text-xl font-semibold">No results found</h2>
            <p>No matches for "{submittedQuery}".</p>
          </div>
        )}

        {activeTab !== 'all' && hasMore && (
          <div className="border-t p-4 text-center">
            {error && (
              <p className="mb-2 text-sm text-destructive">
                Failed to load more results. Please try again.
              </p>
            )}
            <Button
              variant="outline"
              disabled={isLoadingMore}
              onClick={loadMore}
            >
              {isLoadingMore ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
