/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'

import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { preloadInlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { type InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import type { Status } from '@/lib/types/domain/status'

import { ActivityReplies, REPLIES_PAGE_SIZE } from './ActivityReplies'

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client')>()
  return {
    ...actual,
    deleteStatus: vi.fn(),
    getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
    getTranslationLanguages: vi.fn().mockResolvedValue([])
  }
})

// MockPost ignores onPostDeleted; a reply's delete path needs a way to fire it.
vi.mock('@/lib/components/posts/post', async () => {
  const { MockPost } = await import('./FitnessStatusDetail.mocks')
  return {
    Post: (props: {
      status: { id: string }
      onPostDeleted?: (status: { id: string }) => void
    }) => (
      <>
        <MockPost {...props} />
        {props.onPostDeleted ? (
          <button
            type="button"
            data-testid={`delete-${props.status.id}`}
            onClick={() => props.onPostDeleted?.(props.status)}
          >
            Remove
          </button>
        ) : null}
      </>
    )
  }
})

// The shared stub only opens in the right place; the rail's save callbacks
// need something that fires them.
vi.mock('@/lib/components/posts/inline-status-composer', async () => {
  const { MockInlineStatusComposer } =
    await import('./FitnessStatusDetail.mocks')
  return {
    InlineStatusComposer: (
      props: React.ComponentProps<typeof MockInlineStatusComposer> & {
        onCreated?: (status: unknown) => void
        onUpdated?: (status: unknown) => void
      }
    ) => (
      <>
        <MockInlineStatusComposer {...props} />
        <button type="button" onClick={() => props.onCreated?.(props.status)}>
          Mock created
        </button>
        <button type="button" onClick={() => props.onUpdated?.(props.status)}>
          Mock updated
        </button>
      </>
    )
  }
})

beforeAll(async () => {
  await preloadInlineStatusComposer()
})

const MINUTE = 60 * 1000

const composer = {
  active: null,
  openReply: vi.fn(),
  openQuote: vi.fn(),
  openEdit: vi.fn(),
  close: vi.fn()
} as unknown as InlineComposerControls

const note = (
  name: string,
  actor: typeof mockAlice,
  reply: string,
  minutes: number,
  text = name
) =>
  createMockNote({
    id: `https://activities.local/users/${actor.username}/statuses/${name}`,
    actor,
    actorId: actor.id,
    reply,
    text,
    createdAt: BASE_TIME + minutes * MINUTE
  })

const renderReplies = (
  props: Partial<Parameters<typeof ActivityReplies>[0]> & { status: Status }
) =>
  render(
    <ActivityReplies
      host="activities.local"
      currentActor={null}
      currentTime={BASE_TIME + 60 * MINUTE}
      replies={[]}
      composer={composer}
      onShowAttachment={vi.fn()}
      {...props}
    >
      <div data-testid="activity-body">The activity</div>
    </ActivityReplies>
  )

const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('ActivityReplies in a conversation', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('renders the posts above the activity before it, and no empty state', () => {
    const question = note('question', mockBob, '', 0, 'Where did you ride?')
    const activity = note('ride', mockAlice, question.id, 5, 'Morning ride')

    renderReplies({ status: activity, ancestors: [question] })

    const ancestor = screen.getByTestId('ancestor-status')
    expect(ancestor).toHaveTextContent(question.id)
    expect(isBefore(ancestor, screen.getByTestId('activity-body'))).toBe(true)
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
  })

  it('hides the empty state for an activity whose parent is not shown', () => {
    const activity = note(
      'ride-2',
      mockAlice,
      'https://remote.example/statuses/gone',
      5
    )
    renderReplies({ status: activity })
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
  })

  it('keeps the empty state for an activity on its own', () => {
    renderReplies({ status: note('ride-3', mockAlice, '', 5) })
    expect(screen.getByText('No replies yet')).toBeInTheDocument()
  })

  it("renders the athlete's earlier part as a run above the activity and numbers the follow-up after it", () => {
    const part1 = note('part-1', mockAlice, '', 0, 'Heading out')
    const activity = note('part-2', mockAlice, part1.id, 5, 'The ride')
    const part3 = note('part-3', mockAlice, activity.id, 10, 'Back home')

    renderReplies({
      status: activity,
      ancestors: [part1],
      replies: [part3]
    })

    const earlier = screen.getByTestId('activity-earlier-parts')
    expect(within(earlier).getByText('Heading out')).toBeInTheDocument()
    expect(within(earlier).queryByText('The ride')).not.toBeInTheDocument()
    expect(isBefore(earlier, screen.getByTestId('activity-body'))).toBe(true)

    const followUps = screen.getByTestId('activity-follow-ups')
    expect(
      within(followUps).getByRole('button', { name: /Open part 3 of 3/ })
    ).toBeInTheDocument()
    expect(within(followUps).queryByText('Heading out')).not.toBeInTheDocument()
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
  })

  it("leaves the run's numbers out while earlier posts are not loaded", () => {
    const part1 = note('np-1', mockAlice, '', 0)
    const part2 = note('np-2', mockAlice, part1.id, 1)
    const activity = note('np-3', mockAlice, part2.id, 5)
    const part4 = note('np-4', mockAlice, activity.id, 10)

    renderReplies({
      status: activity,
      ancestors: [part1, part2],
      replies: [part4],
      hasMoreAncestors: true,
      onLoadMoreAncestors: vi.fn()
    })

    expect(screen.getByTestId('activity-earlier-parts')).not.toHaveTextContent(
      / of \d/
    )
    expect(screen.getByTestId('activity-follow-ups')).not.toHaveTextContent(
      / of \d/
    )
  })

  it('offers "Load earlier posts" above the conversation', () => {
    const parent = note('lp-parent', mockBob, 'https://x.example/s/1', 0)
    const activity = note('lp-ride', mockAlice, parent.id, 5)
    const onLoadMoreAncestors = vi.fn()
    renderReplies({
      status: activity,
      ancestors: [parent],
      hasMoreAncestors: true,
      onLoadMoreAncestors
    })
    const button = screen.getByRole('button', { name: 'Load earlier posts' })
    expect(isBefore(button, screen.getByTestId('ancestor-status'))).toBe(true)
    fireEvent.click(button)
    expect(onLoadMoreAncestors).toHaveBeenCalledTimes(1)
  })

  it('shows the loaded replies a page at a time, then asks for more', () => {
    const activity = note('lm-ride', mockAlice, '', 0)
    const replies = Array.from({ length: REPLIES_PAGE_SIZE + 2 }, (_, index) =>
      note(`lm-reply-${index}`, mockBob, activity.id, index + 1)
    )
    const onLoadMoreDescendants = vi.fn()
    renderReplies({
      status: activity,
      replies,
      hasMoreDescendants: true,
      onLoadMoreDescendants
    })

    const list = screen.getByTestId('activity-replies-list')
    expect(within(list).getAllByTestId('thread-node')).toHaveLength(
      REPLIES_PAGE_SIZE
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(within(list).getAllByTestId('thread-node')).toHaveLength(
      REPLIES_PAGE_SIZE + 2
    )
    expect(onLoadMoreDescendants).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(onLoadMoreDescendants).toHaveBeenCalledTimes(1)
  })

  it('offers "Load more replies" when no reply is loaded yet', () => {
    const activity = note('lm-empty', mockAlice, '', 0)
    const onLoadMoreDescendants = vi.fn()
    renderReplies({
      status: activity,
      hasMoreDescendants: true,
      onLoadMoreDescendants
    })
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
    expect(onLoadMoreDescendants).toHaveBeenCalledTimes(1)
  })
})
