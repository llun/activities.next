/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved
} from '@testing-library/react'

import { getActorStatuses } from '@/lib/client'

import { ActorTimelines } from './ActorTimelines'
import { FIXED_CURRENT_TIME, createStatus } from './ActorTimelines.testUtils'

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('./ActorTimelines.testUtils')).MockPosts
}))

vi.mock('./ProfileGalleryTab', async () => ({
  ProfileGalleryTab: (await import('./ActorTimelines.testUtils'))
    .MockProfileGalleryTab
}))

vi.mock('./ActorMediaGallery', async () => ({
  ActorMediaGallery: (await import('./ActorTimelines.testUtils'))
    .MockActorMediaGallery
}))

vi.mock('@/lib/components/ui/tabs', async () => {
  const utils = await import('./ActorTimelines.testUtils')
  return {
    Tabs: utils.MockTabs,
    TabsContent: utils.MockTabsContent,
    TabsList: utils.MockTabsList,
    TabsTrigger: utils.MockTabsTrigger
  }
})

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./ActorTimelines.testUtils')).MockButton
}))

describe('ActorTimelines', () => {
  const getActorStatusesMock = getActorStatuses as jest.Mock

  beforeEach(() => {
    getActorStatusesMock.mockReset()
  })

  it('loads and appends older actor statuses from the next outbox page', async () => {
    getActorStatusesMock.mockResolvedValue({
      statuses: [createStatus('https://remote.example/statuses/older')],
      statusesCount: 2,
      nextPageUrl: null,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    // Wait on the append landing in the DOM, not on the request being made:
    // the call happens synchronously inside the click, so a `waitFor` on the
    // mock settles before the response resolves, and the commit lands one
    // macrotask later — the very boundary testing-library's own drain awaits.
    // A bare DOM assertion after that `waitFor` therefore has no retry window
    // and loses the race under a loaded machine.
    await screen.findByText('https://remote.example/statuses/older')

    expect(getActorStatusesMock).toHaveBeenCalledWith({
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/older')
    ).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('continues to the next cursor when an outbox page has no renderable statuses', async () => {
    getActorStatusesMock
      .mockResolvedValueOnce({
        statuses: [],
        statusesCount: 3,
        nextPageUrl:
          'https://remote.example/users/actor/outbox?page=true&max_id=2',
        prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
      })
      .mockResolvedValueOnce({
        statuses: [createStatus('https://remote.example/statuses/oldest')],
        statusesCount: 3,
        nextPageUrl: null,
        prevPageUrl:
          'https://remote.example/users/actor/outbox?page=true&max_id=1'
      })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('https://remote.example/statuses/oldest')

    expect(getActorStatusesMock).toHaveBeenCalledTimes(2)
    expect(getActorStatusesMock).toHaveBeenNthCalledWith(1, {
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
    })
    expect(getActorStatusesMock).toHaveBeenNthCalledWith(2, {
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=2'
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/oldest')
    ).toHaveLength(1)
  })

  it('shows load more when the initial actor page has no renderable statuses', async () => {
    getActorStatusesMock.mockResolvedValue({
      statuses: [createStatus('https://remote.example/statuses/first-post')],
      statusesCount: 3,
      nextPageUrl: null,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('https://remote.example/statuses/first-post')

    expect(getActorStatusesMock).toHaveBeenCalledWith({
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/first-post')
    ).toHaveLength(1)
  })

  it('shows a retryable error when loading older statuses fails', async () => {
    getActorStatusesMock.mockRejectedValueOnce(new Error('Network error'))

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load more posts. Please try again.'
      )
    })
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
  })

  it('stops loading when an empty outbox page repeats the same cursor', async () => {
    const repeatedPageUrl =
      'https://remote.example/users/actor/outbox?page=true&max_id=1'

    getActorStatusesMock.mockResolvedValueOnce({
      statuses: [],
      statusesCount: 3,
      nextPageUrl: repeatedPageUrl,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl: repeatedPageUrl,
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    // Nothing is appended here, so the settled state is the control itself
    // going away. It reads "Loading..." while the request is in flight, which
    // means the "Load more" assertion below would pass mid-flight too — wait
    // for the in-flight control to be removed first so it asserts the end state.
    await waitForElementToBeRemoved(() =>
      screen.queryByRole('button', { name: 'Loading...' })
    )

    expect(getActorStatusesMock).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('stops trying and removes load more when an empty feed yields no statuses', async () => {
    const nextPageUrl =
      'https://remote.example/users/actor/outbox?page=true&max_id=1'

    getActorStatusesMock.mockResolvedValue({
      statuses: [],
      statusesCount: 0,
      nextPageUrl:
        'https://remote.example/users/actor/outbox?page=true&max_id=2',
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl,
          prevPageUrl: null
        }}
      />
    )

    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    expect(loadMoreButton).toBeInTheDocument()

    fireEvent.click(loadMoreButton)

    await waitForElementToBeRemoved(() =>
      screen.queryByRole('button', { name: 'Loading...' })
    )

    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })
})
