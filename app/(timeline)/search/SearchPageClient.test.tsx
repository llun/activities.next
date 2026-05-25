/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'

import { search } from '@/lib/client'

import { SearchPageClient } from './SearchPageClient'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn()
}))

jest.mock('@/lib/client', () => ({
  search: jest.fn()
}))

jest.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ statuses }: { statuses: { id: string }[] }) => (
    <div data-testid="search-posts">
      {statuses.map((status) => (
        <div key={status.id}>{status.id}</div>
      ))}
    </div>
  )
}))

const mockSearch = search as jest.Mock
const replace = jest.fn()

const currentActor = {
  id: 'https://local.example/users/searcher',
  username: 'searcher',
  domain: 'local.example',
  followersUrl: 'https://local.example/users/searcher/followers',
  inboxUrl: 'https://local.example/users/searcher/inbox',
  sharedInboxUrl: 'https://local.example/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1
}

const account = (id: string, displayName: string, acct: string) => ({
  id,
  username: acct.split('@')[0],
  acct,
  url: `https://remote.example/@${acct}`,
  display_name: displayName,
  note: '<p>Trail runner</p>',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {},
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  created_at: '2026-05-25T00:00:00.000Z',
  last_status_at: null,
  statuses_count: 12,
  followers_count: 3,
  following_count: 4
})

const emptySearchResult = () => ({
  accounts: [],
  statuses: [],
  hashtags: []
})

const renderSearchPage = (params = '') => {
  ;(useRouter as jest.Mock).mockReturnValue({ replace })
  ;(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(params))

  return render(
    <SearchPageClient
      host="local.example"
      currentActor={currentActor}
      currentTime={1_779_664_800_000}
    />
  )
}

const selectTab = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), {
    button: 0,
    ctrlKey: false
  })
}

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('SearchPageClient', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    replace.mockReset()
  })

  it('initializes from the URL query and renders grouped all results', async () => {
    mockSearch.mockResolvedValueOnce({
      accounts: [
        account(
          'https://remote.example/users/alice',
          'Alice Runner',
          'alice@remote.example'
        )
      ],
      statuses: [{ id: 'status-1' }],
      hashtags: [
        {
          name: 'trailrunning',
          url: 'https://local.example/tags/trailrunning',
          history: [{ day: '0', uses: '7', accounts: '2' }]
        }
      ]
    })

    renderSearchPage('q=trail')

    expect(await screen.findByText('Alice Runner')).toBeInTheDocument()
    expect(screen.getByText('@alice@remote.example')).toBeInTheDocument()
    expect(screen.getByText('status-1')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /#trailrunning/i })
    ).toHaveAttribute('href', '/tags/trailrunning')
    expect(screen.getByText('7 posts')).toBeInTheDocument()
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'trail',
        limit: 5,
        resolve: true
      })
    )
  })

  it('renders hashtags without history counts', async () => {
    mockSearch.mockResolvedValueOnce({
      ...emptySearchResult(),
      hashtags: [
        {
          name: 'nocount',
          url: 'https://local.example/tags/nocount'
        }
      ]
    })

    renderSearchPage('q=nocount&type=hashtags')

    expect(await screen.findByText('#nocount')).toBeInTheDocument()
    expect(screen.queryByText(/posts$/)).not.toBeInTheDocument()
  })

  it('renders malformed profile payloads with fallbacks', async () => {
    mockSearch.mockResolvedValueOnce({
      ...emptySearchResult(),
      accounts: [
        {
          ...account('malformed-account', '', ''),
          username: '',
          acct: '',
          note: null
        }
      ]
    })

    renderSearchPage('q=unknown&type=accounts')

    expect(await screen.findByText('Unknown profile')).toBeInTheDocument()
    expect(screen.getByText('@unknown@local.example')).toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('renders profile notes with entity decoding and sanitized markup', async () => {
    mockSearch.mockResolvedValueOnce({
      ...emptySearchResult(),
      accounts: [
        {
          ...account('encoded-account', 'Encoded Runner', 'encoded'),
          note: '<p>Tom &amp; Jerry &lt;run&gt; fast</p><script>alert("x")</script>'
        }
      ]
    })

    renderSearchPage('q=encoded&type=accounts')

    expect(
      await screen.findByText('Tom & Jerry <run> fast')
    ).toBeInTheDocument()
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument()
  })

  it('submits searches to URL state and clears blank searches', async () => {
    mockSearch.mockResolvedValueOnce(emptySearchResult())

    renderSearchPage()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'cycling' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/search?q=cycling')
    })
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'cycling' })
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: '   ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(replace).toHaveBeenCalledWith('/search')
    expect(screen.getByText('No search yet')).toBeInTheDocument()
  })

  it('loads more results from the selected typed tab offset', async () => {
    mockSearch
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        accounts: [account('account-initial', 'Initial Runner', 'initial')]
      })
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        accounts: Array.from({ length: 20 }, (_, index) =>
          account(`account-${index}`, `Runner ${index}`, `runner${index}`)
        )
      })
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        accounts: [account('account-next', 'Next Runner', 'next')]
      })

    renderSearchPage('q=runner')

    expect(await screen.findByText('Initial Runner')).toBeInTheDocument()

    selectTab('Profiles')

    await waitFor(() => {
      expect(mockSearch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'runner',
          type: 'accounts',
          limit: 20,
          offset: 0
        })
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'runner',
          type: 'accounts',
          limit: 20,
          offset: 20
        })
      )
    })
    expect(await screen.findByText('Next Runner')).toBeInTheDocument()
  })

  it('resets load-more state when changing tabs during pagination', async () => {
    const loadMoreSearch =
      createDeferred<ReturnType<typeof emptySearchResult>>()
    mockSearch
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        accounts: Array.from({ length: 20 }, (_, index) =>
          account(`account-${index}`, `Runner ${index}`, `runner${index}`)
        )
      })
      .mockReturnValueOnce(loadMoreSearch.promise)
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        statuses: Array.from({ length: 20 }, (_, index) => ({
          id: `status-${index}`
        }))
      })

    renderSearchPage('q=runner&type=accounts')

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(
      await screen.findByRole('button', { name: 'Loading...' })
    ).toBeDisabled()

    selectTab('Posts')

    await waitFor(() => {
      expect(mockSearch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'runner',
          type: 'statuses',
          limit: 20,
          offset: 0
        })
      )
    })
    expect(
      await screen.findByRole('button', { name: 'Load more' })
    ).toBeEnabled()
  })

  it('aborts active pagination requests when unmounted', async () => {
    const loadMoreSearch =
      createDeferred<ReturnType<typeof emptySearchResult>>()
    mockSearch
      .mockResolvedValueOnce({
        ...emptySearchResult(),
        accounts: Array.from({ length: 20 }, (_, index) =>
          account(`account-${index}`, `Runner ${index}`, `runner${index}`)
        )
      })
      .mockReturnValueOnce(loadMoreSearch.promise)

    const { unmount } = renderSearchPage('q=runner&type=accounts')

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledTimes(2)
    })
    const signal = mockSearch.mock.calls[1][0].signal as AbortSignal

    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)

    await act(async () => {
      loadMoreSearch.resolve(emptySearchResult())
      await loadMoreSearch.promise
    })
  })

  it('shows an error state when the request fails', async () => {
    mockSearch.mockRejectedValueOnce(new Error('network failed'))

    renderSearchPage('q=trail')

    expect(await screen.findByText('Search failed')).toBeInTheDocument()
  })

  it('ignores stale responses from earlier searches', async () => {
    const firstSearch = createDeferred<ReturnType<typeof emptySearchResult>>()
    const secondSearch = createDeferred<ReturnType<typeof emptySearchResult>>()
    mockSearch
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise)

    renderSearchPage('q=first')
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'second' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondSearch.resolve({
        ...emptySearchResult(),
        accounts: [account('second-account', 'Second Result', 'second')]
      })
    })
    expect(await screen.findByText('Second Result')).toBeInTheDocument()

    await act(async () => {
      firstSearch.resolve({
        ...emptySearchResult(),
        accounts: [account('first-account', 'First Result', 'first')]
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('First Result')).not.toBeInTheDocument()
    })
  })
})
