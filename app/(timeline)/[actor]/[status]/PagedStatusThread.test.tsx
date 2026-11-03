/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { ReactNode } from 'react'

import { getStatusThread } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { preloadInlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import type { Status } from '@/lib/types/domain/status'

import { PagedStatusThread } from './PagedStatusThread'

vi.mock('@/lib/components/posts/collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getStatusThread: vi.fn(),
  getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
  getTranslationLanguages: vi.fn().mockResolvedValue([])
}))

const mockGetStatusThread = vi.mocked(getStatusThread)

beforeAll(async () => {
  await preloadInlineStatusComposer()
})

const host = 'activities.local'
const MINUTE = 60_000

const root = createMockNote({
  id: 'https://activities.local/users/bob/statuses/root',
  actor: mockBob,
  actorId: mockBob.id,
  text: 'Root post',
  createdAt: BASE_TIME
})
const earlier = createMockNote({
  id: 'https://activities.local/users/bob/statuses/earlier',
  actor: mockBob,
  actorId: mockBob.id,
  text: 'Earlier post',
  reply: root.id,
  createdAt: BASE_TIME + MINUTE
})
const parent = createMockNote({
  id: 'https://activities.local/users/bob/statuses/parent',
  actor: mockBob,
  actorId: mockBob.id,
  text: 'Parent post',
  reply: earlier.id,
  createdAt: BASE_TIME + 2 * MINUTE
})
const opened = createMockNote({
  id: 'https://activities.local/users/alice/statuses/opened',
  actor: mockAlice,
  actorId: mockAlice.id,
  text: 'Opened post',
  reply: parent.id,
  createdAt: BASE_TIME + 3 * MINUTE
})
const reply = (name: string, minutes: number): Status =>
  createMockNote({
    id: `https://activities.local/users/bob/statuses/${name}`,
    actor: mockBob,
    actorId: mockBob.id,
    text: `Reply ${name}`,
    reply: opened.id,
    createdAt: BASE_TIME + minutes * MINUTE
  })
const firstReply = reply('first', 10)
const laterReply = reply('later', 20)

const renderThread = (
  props: Partial<Parameters<typeof PagedStatusThread>[0]> = {}
) =>
  render(
    <PagedStatusThread
      host={host}
      status={opened}
      ancestors={[parent]}
      descendants={[firstReply]}
      hasMoreAncestors
      hasMoreDescendants
      currentActor={mockAlice}
      currentTime={BASE_TIME + 30 * MINUTE}
      {...props}
    />
  )

describe('PagedStatusThread', () => {
  beforeEach(() => {
    mockGetStatusThread.mockReset()
  })
  afterEach(() => cleanup())

  it('loads more replies at the next step and keeps the earlier ones', async () => {
    mockGetStatusThread.mockResolvedValue({
      ancestors: [parent],
      descendants: [firstReply, laterReply],
      hasMoreAncestors: true,
      hasMoreDescendants: false
    })
    renderThread()

    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))

    expect(mockGetStatusThread).toHaveBeenCalledWith({
      statusId: opened.id,
      ancestorsLimit: 40,
      descendantsLimit: 200
    })
    expect(await screen.findByText('Reply later')).toBeInTheDocument()
    expect(screen.getByText('Reply first')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more replies' })
    ).not.toBeInTheDocument()
  })

  it('loads earlier posts, keeping the replies limit and the opened post mounted', async () => {
    mockGetStatusThread.mockResolvedValue({
      ancestors: [root, earlier, parent],
      descendants: [firstReply],
      hasMoreAncestors: false,
      hasMoreDescendants: true
    })
    renderThread()
    const focused = screen.getByTestId('focused-status')

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier posts' }))

    expect(mockGetStatusThread).toHaveBeenCalledWith({
      statusId: opened.id,
      ancestorsLimit: 120,
      descendantsLimit: 60
    })
    expect(await screen.findByText('Root post')).toBeInTheDocument()
    expect(screen.getByText('Earlier post')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load earlier posts' })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('focused-status')).toBe(focused)
  })

  it('scrolls by what the earlier posts added above the opened post', async () => {
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy
    mockGetStatusThread.mockResolvedValue({
      ancestors: [root, earlier, parent],
      descendants: [firstReply],
      hasMoreAncestors: false,
      hasMoreDescendants: true
    })
    renderThread()
    // Measured as the answer lands (100) and again once the earlier posts
    // are in, above it (340).
    screen.getByTestId('focused-status').getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce({ top: 100 })
      .mockReturnValueOnce({ top: 340 })

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier posts' }))

    expect(await screen.findByText('Root post')).toBeInTheDocument()
    expect(scrollBy).toHaveBeenCalledWith(0, 240)
  })

  it('keeps an open reply composer across a load', async () => {
    mockGetStatusThread.mockResolvedValue({
      ancestors: [parent],
      descendants: [firstReply, laterReply],
      hasMoreAncestors: true,
      hasMoreDescendants: false
    })
    renderThread()
    const replyButtons = screen.getAllByRole('button', {
      name: /^Reply to post/
    })
    fireEvent.click(replyButtons[1])
    const composer = await screen.findByRole('textbox')

    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(await screen.findByText('Reply later')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBe(composer)
  })

  it('shows a failed load as an error with Retry, which asks again', async () => {
    mockGetStatusThread.mockRejectedValueOnce(new Error('offline'))
    mockGetStatusThread.mockResolvedValueOnce({
      ancestors: [parent],
      descendants: [firstReply, laterReply],
      hasMoreAncestors: true,
      hasMoreDescendants: false
    })
    renderThread()

    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the conversation"
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Reply later')).toBeInTheDocument()
    expect(mockGetStatusThread).toHaveBeenCalledTimes(2)
  })

  it('stops offering more at the last step', async () => {
    const stillMore = {
      ancestors: [parent],
      descendants: [firstReply],
      hasMoreAncestors: false,
      hasMoreDescendants: true
    }
    mockGetStatusThread.mockResolvedValue(stillMore)
    renderThread({ hasMoreAncestors: false })

    for (const limit of [200, 500]) {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Load more replies' })
        ).not.toHaveAttribute('aria-busy')
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
      await waitFor(() =>
        expect(mockGetStatusThread).toHaveBeenLastCalledWith(
          expect.objectContaining({ descendantsLimit: limit })
        )
      )
    }
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Load more replies' })
      ).not.toBeInTheDocument()
    )
  })

  it('follows the page again after a refresh when nothing more was loaded', () => {
    const { rerender } = renderThread()
    rerender(
      <PagedStatusThread
        host={host}
        status={opened}
        ancestors={[parent]}
        descendants={[firstReply, laterReply]}
        currentActor={mockAlice}
        currentTime={BASE_TIME + 30 * MINUTE}
      />
    )
    expect(screen.getByText('Reply later')).toBeInTheDocument()
    expect(mockGetStatusThread).not.toHaveBeenCalled()
  })

  it('re-asks at the limits reached when the page refreshes after a load', async () => {
    mockGetStatusThread.mockResolvedValue({
      ancestors: [parent],
      descendants: [firstReply, laterReply],
      hasMoreAncestors: true,
      hasMoreDescendants: true
    })
    const { rerender } = renderThread()
    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(await screen.findByText('Reply later')).toBeInTheDocument()

    rerender(
      <PagedStatusThread
        host={host}
        status={opened}
        ancestors={[parent]}
        descendants={[firstReply]}
        hasMoreAncestors
        hasMoreDescendants
        currentActor={mockAlice}
        currentTime={BASE_TIME + 30 * MINUTE}
      />
    )
    await waitFor(() => expect(mockGetStatusThread).toHaveBeenCalledTimes(2))
    expect(mockGetStatusThread).toHaveBeenLastCalledWith({
      statusId: opened.id,
      ancestorsLimit: 40,
      descendantsLimit: 200
    })
    // The loaded reply stays on screen meanwhile.
    expect(screen.getByText('Reply later')).toBeInTheDocument()
  })
})
