'use client'

import { Hash, Search as SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { SearchResult, SearchType, search as searchClient } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Tag } from '@/lib/types/mastodon/tag'
import { cn } from '@/lib/utils'

type SearchTab = 'all' | SearchType

interface SearchPageClientProps {
  host: string
  currentActor: ActorProfile
  currentTime: number
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

const appendTabResults = (
  previous: SearchResult,
  next: SearchResult,
  tab: SearchTab
): SearchResult => {
  if (tab === 'accounts') {
    return {
      ...previous,
      accounts: [...previous.accounts, ...next.accounts]
    }
  }
  if (tab === 'statuses') {
    return {
      ...previous,
      statuses: [...previous.statuses, ...next.statuses]
    }
  }
  if (tab === 'hashtags') {
    return {
      ...previous,
      hashtags: [...previous.hashtags, ...next.hashtags]
    }
  }
  return previous
}

const getAccountHandle = (account: MastodonAccount, host: string) => {
  const acct = account.acct || account.username
  return acct.includes('@') ? `@${acct}` : `@${account.username}@${host}`
}

const getAccountInitial = (account: MastodonAccount) => {
  const name = account.display_name || account.username
  return name.trim()[0]?.toUpperCase() ?? '?'
}

const getPlainTextFromHtml = (html: string) => {
  if (!html) return ''

  if (typeof document === 'undefined') {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const element = document.createElement('div')
  element.innerHTML = html
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const getTagPostCount = (tag: SearchTag) => {
  if (typeof tag.postCount === 'number') return tag.postCount
  const historyCount = Number(tag.history.at(0)?.uses)
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
  const note = getPlainTextFromHtml(account.note)

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
          <p className="truncate text-sm font-medium">
            {account.display_name || account.username}
          </p>
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
  postLineLimit
}: SearchPageClientProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const initialTab = getSearchTab(searchParams.get('type'))
  const [inputValue, setInputValue] = useState(initialQuery)
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery)
  const [activeTab, setActiveTab] = useState<SearchTab>(initialTab)
  const [results, setResults] = useState<SearchResult>(emptySearchResult)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? ''
    const nextTab = getSearchTab(searchParams.get('type'))
    setInputValue(nextQuery)
    setSubmittedQuery(nextQuery)
    setActiveTab(nextTab)
  }, [searchParams])

  useEffect(() => {
    const query = submittedQuery.trim()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortControllerRef.current?.abort()

    if (!query) {
      setResults(emptySearchResult())
      setError(false)
      setIsLoading(false)
      setHasMore(false)
      return
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setIsLoading(true)
    setError(false)
    setHasMore(false)

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
        if (err instanceof DOMException && err.name === 'AbortError') return
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
    setSubmittedQuery(query)
    setActiveTab(nextTab)
    router.replace(getSearchPath(query, nextTab))
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
      if (err instanceof DOMException && err.name === 'AbortError') return
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
      className="mt-0"
      currentTime={currentTime}
      statuses={statuses}
      currentActor={currentActor}
      showActions
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
            onChange={(event) => setInputValue(event.target.value)}
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
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              onClick={() => onTabChange(tab.value)}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <section className="overflow-hidden rounded-lg border bg-background/80 shadow-sm">
        {error ? (
          <div className="p-8 text-center text-muted-foreground">
            <h2 className="mb-2 text-xl font-semibold">Search failed</h2>
            <p>Try again in a moment.</p>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
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

        {activeTab !== 'all' && hasMore && !error && (
          <div
            className={cn('border-t p-4 text-center', isLoading && 'hidden')}
          >
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
