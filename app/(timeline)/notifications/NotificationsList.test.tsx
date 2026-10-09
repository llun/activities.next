/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, render, screen } from '@testing-library/react'

import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'

import { NotificationsList } from './NotificationsList'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() })
}))

const mockMarkNotificationsRead = vi.fn()
vi.mock('@/lib/client', () => ({
  markNotificationsRead: (params: { notificationIds: string[] }) =>
    mockMarkNotificationsRead(params),
  follow: vi.fn()
}))

const currentTime = new Date('2026-05-10T09:19:26.175Z').getTime()

const account = {
  id: 'https://other.test/users/alice',
  username: 'alice',
  acct: 'alice@other.test',
  display_name: 'Alice'
} as Mastodon.Account

const makeNotification = (
  id: string,
  overrides: Partial<GroupedNotification> = {}
) =>
  ({
    id,
    actorId: 'https://llun.test/users/llun',
    type: 'follow',
    sourceActorId: account.id,
    isRead: false,
    filtered: false,
    createdAt: currentTime,
    updatedAt: currentTime,
    account,
    ...overrides
  }) as GroupedNotification & { account: Mastodon.Account }

// The component creates exactly one IntersectionObserver; capture it so a test
// can report rows as scrolled into view.
let observed: Element[] = []
let triggerIntersection: (
  entries: Partial<IntersectionObserverEntry>[]
) => void = () => {}

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    triggerIntersection = (entries) =>
      callback(
        entries as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver
      )
  }
  observe = (element: Element) => {
    observed.push(element)
  }
  disconnect = vi.fn()
  unobserve = vi.fn()
}

const rowFor = (id: string) =>
  observed.find((el) => el.getAttribute('data-notification-id') === id)!

const scrollIntoView = (...ids: string[]) =>
  act(() => {
    triggerIntersection(
      ids.map((id) => ({ isIntersecting: true, target: rowFor(id) }))
    )
  })

const renderList = (notifications: ReturnType<typeof makeNotification>[]) =>
  render(
    <NotificationsList
      notifications={notifications}
      host="llun.test"
      currentTime={currentTime}
    />
  )

describe('NotificationsList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // mockReset also drops any unused mock...Once value from an earlier test.
    mockMarkNotificationsRead.mockReset()
    observed = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    mockMarkNotificationsRead.mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('observes only unread rows', () => {
    renderList([
      makeNotification('n-unread'),
      makeNotification('n-read', { isRead: true })
    ])

    expect(
      observed.map((el) => el.getAttribute('data-notification-id'))
    ).toEqual(['n-unread'])
  })

  it('marks a row read after it scrolls into view and refreshes the badge', async () => {
    renderList([makeNotification('n1')])
    expect(screen.getByText('Unread')).toBeInTheDocument()

    scrollIntoView('n1')

    // Locally flagged as read straight away, before the request goes out.
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
    expect(mockMarkNotificationsRead).not.toHaveBeenCalled()

    // Pin the 1000 ms debounce on both sides of its boundary.
    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(mockMarkNotificationsRead).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(mockMarkNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['n1']
    })
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('batches rows that scroll into view within the debounce window into one request', async () => {
    renderList([makeNotification('n1'), makeNotification('n2')])

    scrollIntoView('n1')
    await act(() => vi.advanceTimersByTimeAsync(600))
    scrollIntoView('n2')
    await act(() => vi.advanceTimersByTimeAsync(600))
    // The first row's timer was restarted by the second, so nothing is sent yet.
    expect(mockMarkNotificationsRead).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(400))

    expect(mockMarkNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['n1', 'n2']
    })
  })

  it('marks every notification in a grouped row as read, not just the representative id', async () => {
    renderList([
      makeNotification('group-head', {
        groupedIds: ['group-head', 'g2', 'g3'],
        groupedCount: 3
      })
    ])

    scrollIntoView('group-head')
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(mockMarkNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['group-head', 'g2', 'g3']
    })
  })

  it('does not request a row twice when it scrolls into view again', async () => {
    renderList([makeNotification('n1')])

    scrollIntoView('n1')
    await act(() => vi.advanceTimersByTimeAsync(1000))
    scrollIntoView('n1')
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1)
  })

  it('ignores rows that are not intersecting', async () => {
    renderList([makeNotification('n1')])

    act(() => {
      triggerIntersection([{ isIntersecting: false, target: rowFor('n1') }])
    })
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(mockMarkNotificationsRead).not.toHaveBeenCalled()
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it.each([
    ['the server rejects the request', () => Promise.resolve(false)],
    ['the request throws', () => Promise.reject(new Error('offline'))]
  ])(
    'shows an alert and does not refresh when %s',
    async (_, implementation) => {
      mockMarkNotificationsRead.mockImplementation(implementation)
      renderList([makeNotification('n1')])

      scrollIntoView('n1')
      await act(() => vi.advanceTimersByTimeAsync(1000))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Notifications could not be marked as read.'
      )
      expect(mockRefresh).not.toHaveBeenCalled()
    }
  )

  it('retries failed ids together with the next row and clears the alert on success', async () => {
    mockMarkNotificationsRead.mockResolvedValueOnce(false)
    renderList([makeNotification('n1'), makeNotification('n2')])

    scrollIntoView('n1')
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    scrollIntoView('n2')
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(mockMarkNotificationsRead).toHaveBeenLastCalledWith({
      notificationIds: ['n1', 'n2']
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending mark-read request when unmounted', async () => {
    const { unmount } = renderList([makeNotification('n1')])

    scrollIntoView('n1')
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(2000))

    expect(mockMarkNotificationsRead).not.toHaveBeenCalled()
  })
})
