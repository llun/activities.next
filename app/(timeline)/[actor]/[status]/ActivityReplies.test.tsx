/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { useState } from 'react'

import { deleteStatus } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  createMockPhoto,
  mockAlice,
  mockBob,
  mockCarol
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { preloadInlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import {
  type InlineComposerControls,
  useInlineComposer
} from '@/lib/components/posts/useInlineComposer'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import type { Status, StatusNote } from '@/lib/types/domain/status'

import {
  ActivityReplies,
  type ActivityRepliesProps,
  REPLIES_EXPANDED_STORAGE_KEY,
  REPLIES_PAGE_SIZE
} from './ActivityReplies'
import { mockRefresh } from './FitnessStatusDetail.mocks'

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

const POST_ID = 'https://activities.local/users/athlete/statuses/ride'
const MINUTE = 60 * 1000

const buildReply = (id: string) =>
  ({
    id,
    type: 'Note',
    actorId: 'https://activities.local/users/friend',
    reply: POST_ID
  }) as unknown as Status

const composer = {
  active: null,
  openReply: vi.fn(),
  openQuote: vi.fn(),
  openEdit: vi.fn(),
  close: vi.fn()
} as unknown as InlineComposerControls

const props: ActivityRepliesProps = {
  host: 'activities.local',
  currentActor: null,
  currentTime: Date.now(),
  status: { id: POST_ID, type: 'Note' } as unknown as Status,
  replies: [buildReply('reply-1')],
  composer,
  onShowAttachment: vi.fn()
}

const makeActivityAndFollowUps = () => {
  const activity = createMockNote({
    id: POST_ID,
    actor: mockAlice,
    actorId: mockAlice.id,
    text: 'Morning ride activity',
    createdAt: BASE_TIME
  })
  const followUp1 = createMockNote({
    id: 'https://activities.local/users/alice/statuses/follow-1',
    actor: mockAlice,
    actorId: mockAlice.id,
    reply: activity.id,
    text: 'Stopped for appeltaart at km 30',
    createdAt: BASE_TIME + 2 * MINUTE,
    totalLikes: 2
  })
  const followUp2 = createMockNote({
    id: 'https://activities.local/users/alice/statuses/follow-2',
    actor: mockAlice,
    actorId: mockAlice.id,
    reply: followUp1.id,
    text: 'New PR on the Lekdijk segment',
    createdAt: BASE_TIME + 4 * MINUTE,
    totalLikes: 5
  })
  return { activity, followUp1, followUp2 }
}

const StatefulActivityReplies = (
  overrideProps: Omit<ActivityRepliesProps, 'composer'>
) => {
  const inlineComposer = useInlineComposer(Boolean(overrideProps.currentActor))
  const [, setTick] = useState(0)
  return (
    <ActivityReplies
      {...overrideProps}
      composer={{
        ...inlineComposer,
        openReply: (target, anchorId) => {
          inlineComposer.openReply(target, anchorId)
          setTick((t) => t + 1)
        }
      }}
    />
  )
}

describe('ActivityReplies', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('renders open on the server and applies a stored "hide" after hydrating', async () => {
    window.localStorage.setItem(REPLIES_EXPANDED_STORAGE_KEY, '0')

    const { serverHtml, container, onRecoverableError, unmount } =
      await hydrateServerHtml(<ActivityReplies {...props} />)
    try {
      // The server has no storage, so its markup is always the open list…
      const server = document.createElement('template')
      server.innerHTML = serverHtml
      expect(
        server.content
          .querySelector('button[aria-expanded]')
          ?.getAttribute('aria-expanded')
      ).toBe('true')

      // …which hydrates without a mismatch, then follows the stored choice.
      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container.querySelector('button[aria-expanded]')).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    } finally {
      unmount()
    }
  })

  it.each([
    { stored: '1', expanded: 'true' },
    { stored: 'something else', expanded: 'true' }
  ])('stays open for a stored "$stored"', async ({ stored, expanded }) => {
    window.localStorage.setItem(REPLIES_EXPANDED_STORAGE_KEY, stored)
    await act(async () => {
      render(<ActivityReplies {...props} />)
    })
    expect(
      screen.getByRole('button', { name: /Replies \(1\)/ })
    ).toHaveAttribute('aria-expanded', expanded)
  })

  describe('athlete self-thread follow-ups', () => {
    it('renders follow-ups as a rail starting at "2 of 3" with no "added N more posts" header, per-part actions, media, and inline composer', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const followUp1WithPhoto: StatusNote = {
        ...followUp1,
        attachments: [createMockPhoto(followUp1, 'Stop photo')]
      }

      const { unmount } = render(
        <StatefulActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 6 * MINUTE}
          status={activity}
          replies={[followUp1WithPhoto, followUp2]}
          onShowAttachment={vi.fn()}
        />
      )

      const rail = screen.getByTestId('self-thread-run')
      expect(rail).toBeInTheDocument()

      // Starts directly at part 2 ("2 of 3 · 4m"), not part 1, and has no "added N more posts" line
      expect(screen.queryByText(/added .* more post/i)).not.toBeInTheDocument()
      expect(
        within(rail).queryByText('Morning ride activity')
      ).not.toBeInTheDocument()
      expect(
        within(rail).getByRole('button', { name: /Open part 2 of 3/i })
      ).toHaveTextContent('2 of 3 · 4m')
      expect(
        within(rail).getByRole('button', { name: /Open part 3 of 3/i })
      ).toHaveTextContent('3 of 3 · 2m')

      // Parts carry data-node-id and data-testid="status-<id>"
      const part2El = screen.getByTestId(`status-${followUp1.id}`)
      const part3El = screen.getByTestId(`status-${followUp2.id}`)
      expect(part2El).toHaveAttribute('data-node-id', followUp1.id)
      expect(part3El).toHaveAttribute('data-node-id', followUp2.id)

      // Media in a follow-up renders as usual
      expect(
        within(part2El).getByRole('button', { name: 'Open media: Stop photo' })
      ).toBeInTheDocument()

      // Each rendered follow-up part has its own action row
      expect(
        within(rail).getAllByRole('group', { name: 'Post actions' })
      ).toHaveLength(2)

      // Clicking Reply on part 2 opens the inline composer under part 2
      fireEvent.click(within(part2El).getByRole('button', { name: /Reply/i }))
      const inlineComposer = within(part2El).getByTestId(
        'inline-status-composer'
      )
      expect(inlineComposer).toHaveAttribute('data-mode', 'reply')
      expect(inlineComposer).toHaveAttribute('data-status-id', followUp1.id)

      unmount()

      // Signed-out viewer gets per-part ReadOnlyStats instead of action rows
      render(
        <ActivityReplies
          host="activities.local"
          currentActor={null}
          currentTime={BASE_TIME + 6 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )
      expect(
        screen.queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()
      expect(screen.getAllByRole('group', { name: 'Engagement' })).toHaveLength(
        2
      )
    })

    it('excludes follow-ups from "Replies (N)" and from REPLIES_PAGE_SIZE paging, and keeps follow-ups visible when Replies is hidden', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const otherReplies = Array.from(
        { length: REPLIES_PAGE_SIZE + 1 },
        (_, i) =>
          createMockNote({
            id: `https://activities.local/users/bob/statuses/other-${i + 1}`,
            actor: mockBob,
            actorId: mockBob.id,
            reply: activity.id,
            text: `Other reply ${i + 1}`,
            createdAt: BASE_TIME + (10 + i) * MINUTE
          })
      )

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 30 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2, ...otherReplies]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      // Replies (N) counts only the 6 non-follow-up replies, not the 2 follow-ups
      const toggle = screen.getByRole('button', {
        name: new RegExp(`Replies \\(${otherReplies.length}\\).*Hide`, 'i')
      })
      expect(toggle).toBeInTheDocument()

      // First page of replies shows REPLIES_PAGE_SIZE (5) items from otherReplies
      expect(screen.getAllByTestId('reply-post')).toHaveLength(
        REPLIES_PAGE_SIZE
      )
      expect(
        screen.getByRole('button', { name: 'Load more replies' })
      ).toBeInTheDocument()

      // Hiding Replies hides the reply list, but the follow-up rail stays visible
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getAllByTestId('reply-post')[0]).not.toBeVisible()
      expect(screen.getByText('Stopped for appeltaart at km 30')).toBeVisible()
      expect(screen.getByText('New PR on the Lekdijk segment')).toBeVisible()
    })

    it('tucks a short text-only reply into the follow-up rail and shows a non-tuckable reply under Replies with "Replying to 2 of 3"', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const bobTucked = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-tucked',
        actor: mockBob,
        actorId: mockBob.id,
        reply: followUp1.id,
        text: 'Best appeltaart in the province!',
        createdAt: BASE_TIME + 3 * MINUTE
      })
      const carolPhotoBase = createMockNote({
        id: 'https://activities.local/users/carol/statuses/carol-photo',
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: followUp1.id,
        text: 'Carol photo reply to part 2',
        createdAt: BASE_TIME + 3 * MINUTE
      })
      const carolWithPhoto: StatusNote = {
        ...carolPhotoBase,
        attachments: [createMockPhoto(carolPhotoBase, 'carol-pic')]
      }

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[followUp1, bobTucked, carolWithPhoto, followUp2]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      const rail = screen.getByTestId('self-thread-run')
      const insetGroup = within(rail).getByRole('group', {
        name: 'Reply by Bob Jones'
      })
      expect(insetGroup).toHaveTextContent('Best appeltaart in the province!')
      expect(
        within(rail).getByTestId(`status-${bobTucked.id}`)
      ).toHaveAttribute('data-node-id', bobTucked.id)

      // Only the non-tuckable photo reply appears under Replies (1) with "Replying to 2 of 3"
      expect(
        screen.getByRole('button', { name: /Replies \(1\)/ })
      ).toBeInTheDocument()
      const repliesList = screen.getByTestId('activity-replies-list')
      expect(repliesList).toHaveTextContent('Replying to 2 of 3')
      expect(within(repliesList).getByTestId('reply-post')).toHaveTextContent(
        carolWithPhoto.id
      )
    })

    it("keeps someone else's short reply to the activity under Replies (not in the rail) and hidden with the toggle", () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const bobToActivity = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-to-activity',
        actor: mockBob,
        actorId: mockBob.id,
        reply: activity.id,
        text: 'Nice ride!',
        createdAt: BASE_TIME + MINUTE
      })

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[bobToActivity, followUp1, followUp2]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      const rail = screen.getByTestId('self-thread-run')
      expect(
        within(rail).queryByTestId(`status-${bobToActivity.id}`)
      ).not.toBeInTheDocument()
      const repliesList = screen.getByTestId('activity-replies-list')
      expect(within(repliesList).getByTestId('reply-post')).toHaveTextContent(
        bobToActivity.id
      )
      expect(repliesList).toHaveTextContent('Replying to 1 of 3')

      const toggle = screen.getByRole('button', { name: /Replies \(1\)/ })
      fireEvent.click(toggle)
      expect(within(repliesList).getByTestId('reply-post')).not.toBeVisible()
      expect(screen.getByText('New PR on the Lekdijk segment')).toBeVisible()
    })

    it('renders no "No replies yet" empty state when the only descendants are follow-ups', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByTestId('self-thread-run')).toBeInTheDocument()
      expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Replies \(/ })
      ).not.toBeInTheDocument()
    })

    it('drops a deleted reply from the list', () => {
      render(
        <ActivityReplies
          {...props}
          replies={[buildReply('reply-1'), buildReply('reply-2')]}
        />
      )
      expect(screen.getAllByTestId('reply-post')).toHaveLength(2)

      fireEvent.click(screen.getByTestId('delete-reply-1'))

      expect(
        screen.getByRole('button', { name: /Replies \(1\)/ })
      ).toBeVisible()
      expect(screen.getAllByTestId('reply-post')).toHaveLength(1)
      expect(screen.queryByText('reply-1')).not.toBeInTheDocument()
    })

    it('hands a rail photo to the media viewer at its index', () => {
      const onShowAttachment = vi.fn()
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const followUp1WithPhoto: StatusNote = {
        ...followUp1,
        attachments: [createMockPhoto(followUp1, 'Stop photo')]
      }

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 6 * MINUTE}
          status={activity}
          replies={[followUp1WithPhoto, followUp2]}
          composer={composer}
          onShowAttachment={onShowAttachment}
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Open media: Stop photo' })
      )

      expect(onShowAttachment).toHaveBeenCalledTimes(1)
      expect(onShowAttachment).toHaveBeenCalledWith(
        followUp1WithPhoto.attachments,
        0
      )
    })

    // The rail's save callbacks belong to the quote and edit composers; a
    // reply composer reports through onReplyCreated instead.
    it.each([
      { saved: 'Mock created', action: 'Quote post' },
      { saved: 'Mock updated', action: 'Edit post' }
    ])(
      'closes the composer and refreshes once a rail part save fires "$saved"',
      async ({ saved, action }) => {
        mockRefresh.mockClear()
        const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()

        render(
          <StatefulActivityReplies
            host="activities.local"
            currentActor={mockAlice}
            currentTime={BASE_TIME + 6 * MINUTE}
            status={activity}
            replies={[followUp1, followUp2]}
            onShowAttachment={vi.fn()}
          />
        )

        const part2El = screen.getByTestId(`status-${followUp1.id}`)
        fireEvent.keyDown(
          within(part2El).getByRole('button', { name: 'More actions' }),
          { key: 'ArrowDown' }
        )
        fireEvent.click(await screen.findByRole('menuitem', { name: action }))
        fireEvent.click(within(part2El).getByRole('button', { name: saved }))

        expect(mockRefresh).toHaveBeenCalledTimes(1)
        expect(
          screen.queryByTestId('inline-status-composer')
        ).not.toBeInTheDocument()
      }
    )

    it('drops a deleted follow-up from the rail', async () => {
      vi.mocked(deleteStatus).mockResolvedValue(true)
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.keyDown(
        within(screen.getByTestId(`status-${followUp2.id}`)).getByRole(
          'button',
          { name: 'More actions' }
        ),
        { key: 'ArrowDown' }
      )
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete post' })
      )
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )

      await waitFor(() =>
        expect(
          screen.queryByText('New PR on the Lekdijk segment')
        ).not.toBeInTheDocument()
      )
      expect(screen.getByText('Stopped for appeltaart at km 30')).toBeVisible()
    })

    it('nests a photo reply to a follow-up without an "unavailable" boundary', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()
      const carolBase = createMockNote({
        id: 'https://activities.local/users/carol/statuses/carol-photo',
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: followUp2.id,
        text: 'Carol photo reply to the last follow-up',
        createdAt: BASE_TIME + 5 * MINUTE
      })
      const carolWithPhoto: StatusNote = {
        ...carolBase,
        attachments: [createMockPhoto(carolBase, 'carol-pic')]
      }

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2, carolWithPhoto]}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByTestId('activity-replies-list')).toHaveTextContent(
        carolWithPhoto.id
      )
      expect(
        screen.queryByTestId('parent-unavailable-boundary')
      ).not.toBeInTheDocument()
    })

    it('opens the reply composer on the activity when only follow-ups exist', () => {
      const { activity, followUp1, followUp2 } = makeActivityAndFollowUps()

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
          status={activity}
          replies={[followUp1, followUp2]}
          composer={
            {
              ...composer,
              active: { mode: 'reply', anchorId: POST_ID, status: activity }
            } as unknown as InlineComposerControls
          }
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByTestId('inline-status-composer')).toHaveAttribute(
        'data-status-id',
        activity.id
      )
    })

    it('keeps the activity out of a collapsed rail of a long thread', () => {
      const { activity } = makeActivityAndFollowUps()
      const followUps: StatusNote[] = []
      for (let i = 0; i < 7; i++) {
        followUps.push(
          createMockNote({
            id: `https://activities.local/users/alice/statuses/long-${i + 1}`,
            actor: mockAlice,
            actorId: mockAlice.id,
            reply: i === 0 ? activity.id : followUps[i - 1].id,
            text: `Follow-up ${i + 1} of the long thread`,
            createdAt: BASE_TIME + (i + 1) * MINUTE
          })
        )
      }

      render(
        <ActivityReplies
          host="activities.local"
          currentActor={mockAlice}
          currentTime={BASE_TIME + 30 * MINUTE}
          status={activity}
          replies={followUps}
          composer={composer}
          onShowAttachment={vi.fn()}
        />
      )

      const rail = screen.getByTestId('self-thread-run')
      expect(
        within(rail).getByRole('button', { name: /more posts in this thread/i })
      ).toBeInTheDocument()
      expect(
        within(rail).queryByText('Morning ride activity')
      ).not.toBeInTheDocument()
      expect(
        within(rail).getByText('Follow-up 1 of the long thread')
      ).toBeInTheDocument()
    })
  })
})
