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

import { getAccountStatusesPage, getActorStatuses } from '@/lib/client'

import { ActorTimelines } from './ActorTimelines'
import { FIXED_CURRENT_TIME, createStatus } from './ActorTimelines.testUtils'

vi.mock('@/lib/client', () => ({
  getAccountStatusesPage: vi.fn(),
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

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./ActorTimelines.testUtils')).MockButton
}))

describe('ActorTimelines', () => {
  const getActorStatusesMock = getActorStatuses as jest.Mock
  const getAccountStatusesPageMock = getAccountStatusesPage as jest.Mock

  beforeEach(() => {
    getActorStatusesMock.mockReset()
    getAccountStatusesPageMock.mockReset()
  })

  it('pages a local account with the max_id cursor until there is no next page', async () => {
    getAccountStatusesPageMock
      .mockResolvedValueOnce({
        statuses: [createStatus('https://local.example/statuses/2')],
        nextMaxStatusId: 'https://local.example/statuses/2'
      })
      .mockResolvedValueOnce({
        statuses: [createStatus('https://local.example/statuses/3')],
        nextMaxStatusId: null
      })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/actor"
        statuses={[createStatus('https://local.example/statuses/1')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl: null,
          prevPageUrl: null,
          nextMaxStatusId: 'https://local.example/statuses/1'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('https://local.example/statuses/2')

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('https://local.example/statuses/3')

    expect(getActorStatusesMock).not.toHaveBeenCalled()
    expect(getAccountStatusesPageMock).toHaveBeenNthCalledWith(1, {
      actorId: 'https://local.example/users/actor',
      maxStatusId: 'https://local.example/statuses/1'
    })
    expect(getAccountStatusesPageMock).toHaveBeenNthCalledWith(2, {
      actorId: 'https://local.example/users/actor',
      maxStatusId: 'https://local.example/statuses/2'
    })
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
    )
  })

  it('steps the max_id cursor back when the post it points at is deleted', async () => {
    getAccountStatusesPageMock.mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/actor"
        statuses={[
          createStatus('https://local.example/statuses/1'),
          createStatus('https://local.example/statuses/2')
        ]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl: null,
          prevPageUrl: null,
          nextMaxStatusId: 'https://local.example/statuses/2'
        }}
      />
    )

    fireEvent.click(
      screen.getByTestId('trigger-delete-https://local.example/statuses/2')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(getAccountStatusesPageMock).toHaveBeenCalledWith({
        actorId: 'https://local.example/users/actor',
        maxStatusId: 'https://local.example/statuses/1'
      })
    )
  })

  it('steps the cursor back when a post appended by load more is deleted', async () => {
    // The delete handler reads the loaded list through a ref, which must have
    // caught up with the page that load more just appended.
    getAccountStatusesPageMock
      .mockResolvedValueOnce({
        statuses: [
          createStatus('https://local.example/statuses/2'),
          createStatus('https://local.example/statuses/3')
        ],
        nextMaxStatusId: 'https://local.example/statuses/3'
      })
      .mockResolvedValue({ statuses: [], nextMaxStatusId: null })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/actor"
        statuses={[createStatus('https://local.example/statuses/1')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl: null,
          prevPageUrl: null,
          nextMaxStatusId: 'https://local.example/statuses/1'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('https://local.example/statuses/3')

    fireEvent.click(
      screen.getByTestId('trigger-delete-https://local.example/statuses/3')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(getAccountStatusesPageMock).toHaveBeenLastCalledWith({
        actorId: 'https://local.example/users/actor',
        maxStatusId: 'https://local.example/statuses/2'
      })
    )
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
        'Failed to load more posts'
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
    // going away. It reads "Loading more" while the request is in flight, which
    // means the "Load more" assertion below would pass mid-flight too — wait
    // for the in-flight control to be removed first so it asserts the end state.
    await waitForElementToBeRemoved(() =>
      screen.queryByRole('button', { name: 'Loading more' })
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
      screen.queryByRole('button', { name: 'Loading more' })
    )

    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })
})
