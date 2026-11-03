/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { StatusThread } from '@/lib/components/posts/status-thread'
import type { Status } from '@/lib/types/domain/status'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
  getTranslationLanguages: vi.fn().mockResolvedValue([])
}))

const host = 'activities.local'
const MINUTE = 60_000

/** An Alice self-thread: part 1 replies to nothing, part n to part n-1. */
const buildSelfThread = (count: number): Status[] => {
  const parts: Status[] = []
  for (let index = 0; index < count; index++) {
    parts.push(
      createMockNote({
        id: `https://activities.local/users/alice/statuses/part-${index + 1}`,
        actor: mockAlice,
        actorId: mockAlice.id,
        text: `Part ${index + 1}`,
        reply: index === 0 ? '' : parts[index - 1].id,
        createdAt: BASE_TIME + index * MINUTE
      })
    )
  }
  return parts
}

const buildReply = (parent: Status, name: string, minutes: number) =>
  createMockNote({
    id: `https://activities.local/users/bob/statuses/${name}`,
    actor: mockBob,
    actorId: mockBob.id,
    text: `Reply ${name}`,
    reply: parent.id,
    createdAt: BASE_TIME + minutes * MINUTE
  })

describe('StatusThread paging', () => {
  afterEach(() => cleanup())

  it('offers "Load earlier posts" above the thread and calls back', () => {
    const [root, focused] = buildSelfThread(2)
    const onLoadMoreAncestors = vi.fn()
    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        currentTime={BASE_TIME + 10 * MINUTE}
        hasMoreAncestors
        onLoadMoreAncestors={onLoadMoreAncestors}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier posts' }))
    expect(onLoadMoreAncestors).toHaveBeenCalledTimes(1)
  })

  it('offers "Load more replies" under the replies and calls back', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/opened',
      actor: mockAlice
    })
    const onLoadMoreDescendants = vi.fn()
    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={[buildReply(focused, 'r1', 1)]}
        currentTime={BASE_TIME + 10 * MINUTE}
        hasMoreDescendants
        onLoadMoreDescendants={onLoadMoreDescendants}
      />
    )
    const button = screen.getByRole('button', { name: 'Load more replies' })
    expect(
      button.closest('[data-testid="thread-descendants"]')
    ).toBeInTheDocument()
    fireEvent.click(button)
    expect(onLoadMoreDescendants).toHaveBeenCalledTimes(1)
  })

  it('keeps "Load more replies" when every loaded reply is part of the run, and shows no empty state', () => {
    const [focused, ...rest] = buildSelfThread(3)
    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={rest}
        currentTime={BASE_TIME + 10 * MINUTE}
        hasMoreDescendants
        onLoadMoreDescendants={vi.fn()}
      />
    )
    expect(screen.queryByTestId('thread-descendants')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Load more replies' })
    ).toBeInTheDocument()
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
  })

  it('shows no empty state while more replies exist, even without a way to load them', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/alone',
      actor: mockAlice
    })
    render(
      <StatusThread
        host={host}
        status={focused}
        currentTime={BASE_TIME}
        hasMoreDescendants
      />
    )
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
  })

  it('marks a load on its way and turns a failed one into an error with Retry', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/opened-2',
      actor: mockAlice
    })
    const onLoadMoreDescendants = vi.fn()
    const props = {
      host,
      status: focused,
      descendants: [buildReply(focused, 'r2', 1)],
      currentTime: BASE_TIME + 10 * MINUTE,
      hasMoreDescendants: true,
      onLoadMoreDescendants
    }
    const { rerender } = render(
      <StatusThread {...props} loadingMore="descendants" />
    )
    const button = screen.getByRole('button', { name: 'Load more replies' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onLoadMoreDescendants).not.toHaveBeenCalled()

    rerender(<StatusThread {...props} loadMoreError="descendants" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the conversation"
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onLoadMoreDescendants).toHaveBeenCalledTimes(1)
  })

  describe('part labels with earlier posts not loaded', () => {
    // A 50-part thread opened at part 50: the page loaded parts 10-49.
    const thread = buildSelfThread(50)
    const focused = thread[49]
    const loadedAncestors = thread.slice(9, 49)

    it('leaves the "i of n" labels out while earlier posts are missing', () => {
      render(
        <StatusThread
          host={host}
          status={focused}
          ancestors={loadedAncestors}
          currentTime={BASE_TIME + 60 * MINUTE}
          hasMoreAncestors
          onLoadMoreAncestors={vi.fn()}
        />
      )
      const run = screen.getByTestId('self-thread-run')
      expect(run).not.toHaveTextContent(/\d+ of 41/)
      expect(run).not.toHaveTextContent(/\d+ of \d+/)
    })

    it('numbers the parts once the whole thread is loaded', () => {
      render(
        <StatusThread
          host={host}
          status={focused}
          ancestors={thread.slice(0, 49)}
          currentTime={BASE_TIME + 60 * MINUTE}
        />
      )
      expect(screen.getByTestId('self-thread-run')).toHaveTextContent(
        /50 of 50/
      )
    })
  })
})
