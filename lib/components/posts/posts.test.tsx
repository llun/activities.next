/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { votePoll } from '@/lib/client'
import {
  pollStatusCurrentTime,
  pollStatusFixture
} from '@/lib/components/posts/__fixtures__/poll-status'
import {
  createMockNote,
  mockAlice
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { preloadInlineStatusComposer } from './lazy-inline-status-composer'
import { Posts, getPrioritizedRowIndex } from './posts'

// A boost (Announce) row wrapping the shared poll fixture as its original, with
// a distinct wrapper id per row.
const makeBoost = (announceId: string): Status =>
  ({
    id: announceId,
    actorId: 'https://remote.example/users/booster',
    actor: pollStatusFixture.actor,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: pollStatusFixture.createdAt,
    updatedAt: pollStatusFixture.updatedAt,
    type: StatusType.enum.Announce,
    originalStatus: pollStatusFixture
  }) as unknown as Status

const mockPush = vi.fn()

// Counts how often each row's <Post> renders, keyed by status id, by wrapping
// the real component.
const postRenders = vi.hoisted(() => new Map<string, number>())
vi.mock('./post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post')>()
  return {
    ...actual,
    Post: (props: React.ComponentProps<typeof actual.Post>) => {
      postRenders.set(
        props.status.id,
        (postRenders.get(props.status.id) ?? 0) + 1
      )
      return <actual.Post {...props} />
    }
  }
})

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

// A stable router, like Next's: a fresh object per render would defeat the
// memoized rows.
const mockRouter = { push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter
}))

vi.mock('@/lib/client', () => ({
  votePoll: vi.fn(),
  getTranslationCapability: vi.fn().mockResolvedValue({
    enabled: false,
    defaultLanguage: null
  }),
  getTranslationLanguages: vi.fn().mockResolvedValue({})
}))

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn()
}))

// Stub the shared inline composer so this test exercises only that Posts wires
// the reply/quote/edit handlers and renders the composer for the active post —
// the composer's own behavior is covered in inline-status-composer.test.tsx.
vi.mock('./inline-status-composer', () => ({
  InlineStatusComposer: ({
    mode,
    status,
    onCancel
  }: {
    mode: string
    status: { id: string }
    onCancel?: () => void
  }) => (
    <div data-testid="inline-composer" data-mode={mode} data-status={status.id}>
      <button type="button" onClick={onCancel}>
        Cancel composer
      </button>
    </div>
  )
}))

// Only what Posts hands the viewer matters here; the viewer has its own tests.
vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    albumsOwnerId,
    onEdit
  }: {
    medias: unknown[] | null
    albumsOwnerId?: string | null
    onEdit?: unknown
  }) =>
    medias ? (
      <div
        data-testid="viewer"
        data-albums-owner={albumsOwnerId ?? 'none'}
        data-editable={onEdit ? 'yes' : 'no'}
      />
    ) : null
}))

const mockVotePoll = vi.mocked(votePoll)
const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)

// The inline composer is loaded lazily; preload it so it renders synchronously.
beforeAll(async () => {
  await preloadInlineStatusComposer()
})

describe('Posts', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockVotePoll.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@llun/poll-1')
  })

  it('does not open the status detail page when poll content is clicked', async () => {
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    const option = screen.getByLabelText('Option A')

    fireEvent.click(screen.getByText('Question'))
    expect(mockGetStatusDetailPathClient).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()

    fireEvent.click(option)

    expect(option).toBeChecked()
    expect(mockGetStatusDetailPathClient).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders no [data-row-overlay] in closed rows, including the edit-history toggle', () => {
    // `data-row-overlay` must exist only while an overlay is open, or the row
    // loses content-visibility containment for nothing.
    const edited = {
      ...pollStatusFixture,
      edits: [
        {
          text: 'the previous text',
          summary: null,
          createdAt: pollStatusCurrentTime - 60_000
        }
      ]
    } as Status
    const { container } = render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[edited, makeBoost('boost-1')]}
        showActions
      />
    )

    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: /Reply to post/ })
    ).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: /Show edit history/ }).length
    ).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-row-overlay]')).toHaveLength(0)
  })

  describe('viewer albums owner', () => {
    const withPhoto = (overrides: Partial<StatusNote> = {}): StatusNote =>
      ({
        ...pollStatusFixture,
        type: StatusType.enum.Note,
        choices: undefined,
        attachments: [
          {
            id: 'attachment-1',
            actorId: pollStatusFixture.actorId,
            statusId: pollStatusFixture.id,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://activities.local/media/1.jpg',
            mediaId: 'm1',
            name: 'A heron',
            width: 800,
            height: 600,
            createdAt: pollStatusCurrentTime,
            updatedAt: pollStatusCurrentTime
          }
        ],
        ...overrides
      }) as unknown as StatusNote

    const open = (
      statuses: Status[],
      currentActor:
        typeof pollStatusFixture.actor | null = pollStatusFixture.actor
    ) => {
      render(
        <Posts
          host="activities.local"
          currentActor={currentActor ?? undefined}
          currentTime={pollStatusCurrentTime}
          statuses={statuses}
        />
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Open media: A heron' })
      )
    }

    it('offers the owner the albums pill on their own post', () => {
      open([withPhoto()])

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        pollStatusFixture.actorId
      )
      // The viewer's Edit button comes with it.
      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-editable',
        'yes'
      )
    })

    it('offers nobody else’s post an albums pill', () => {
      open([withPhoto()], {
        ...pollStatusFixture.actor!,
        id: 'https://activities.local/users/someone-else'
      })

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-editable',
        'no'
      )
    })

    it('offers a signed-out viewer none', () => {
      open([withPhoto()], null)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('goes by who wrote a boosted post, not who boosted it', () => {
      const boost = {
        ...makeBoost('boost-1'),
        originalStatus: withPhoto({
          actorId: 'https://remote.example/users/someone'
        })
      } as Status
      open([boost])

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })
  })

  it('opens the shared inline composer from a post action row', async () => {
    // Every signed-in feed passes the same action wiring, so using an action
    // (reply here) opens the shared composer for that post regardless of page.
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
        showActions
      />
    )

    expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Reply to post/ }))

    const composer = await screen.findByTestId('inline-composer')
    expect(composer).toHaveAttribute('data-mode', 'reply')
    expect(composer).toHaveAttribute('data-status', pollStatusFixture.id)
  })

  it('offers no composer affordance when actions are off', () => {
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    expect(
      screen.queryByRole('button', { name: /Reply to post/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()
  })

  it('renders only one composer when two rows share the same underlying status', () => {
    // Two accounts you follow boosting the same post yields two Announce rows
    // with one original. Anchoring the composer on the wrapper row id (not the
    // unwrapped id) keeps a reply from opening under both rows.
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[
          makeBoost('https://remote.example/users/booster/boost-a/activity'),
          makeBoost('https://remote.example/users/booster/boost-b/activity')
        ]}
        showActions
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /Reply to post/ })[0])

    expect(screen.getAllByTestId('inline-composer')).toHaveLength(1)
  })

  it('opens the status detail page from the timestamp', async () => {
    render(
      <Posts
        host="activities.local"
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open status by Llun/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@llun/poll-1')
    })
  })

  describe('re-rendering rows', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      createMockNote({
        id: `https://activities.local/users/alice/statuses/row-${index}`,
        actor: mockAlice,
        text: `Row ${index}`
      })
    )
    const renderList = (statuses: Status[] = rows) => {
      const props = {
        host: 'activities.local',
        currentActor: mockAlice,
        currentTime: pollStatusCurrentTime,
        showActions: true
      }
      const view = render(<Posts {...props} statuses={statuses} />)
      return {
        rerender: (next: Status[] = statuses) =>
          view.rerender(<Posts {...props} statuses={next} />)
      }
    }
    const reply = (index: number) =>
      fireEvent.click(
        screen.getAllByRole('button', { name: /Reply to post/ })[index]
      )
    const rendered = () => rows.filter((row) => postRenders.get(row.id))

    beforeEach(() => postRenders.clear())

    it('leaves the other rows alone when the composer opens, moves and closes', () => {
      renderList()
      expect(rendered()).toHaveLength(20)

      postRenders.clear()
      reply(3)
      expect(screen.getByTestId('inline-composer')).toBeInTheDocument()
      expect(rendered().filter((row) => row !== rows[3])).toHaveLength(0)

      postRenders.clear()
      reply(5)
      expect(screen.getAllByTestId('inline-composer')).toHaveLength(1)
      expect(
        rendered().filter((row) => row !== rows[3] && row !== rows[5])
      ).toHaveLength(0)

      postRenders.clear()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel composer' }))
      expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()
      expect(rendered().filter((row) => row !== rows[5])).toHaveLength(0)
    })

    it('renders no row again for a rerender with the same props', () => {
      const view = renderList()
      postRenders.clear()
      view.rerender()
      expect(rendered()).toHaveLength(0)
    })

    it('re-renders every row when a shared prop such as currentTime changes', () => {
      const base = {
        host: 'activities.local',
        currentActor: mockAlice,
        showActions: true,
        statuses: rows
      }
      const view = render(
        <Posts {...base} currentTime={pollStatusCurrentTime} />
      )
      postRenders.clear()
      view.rerender(
        <Posts {...base} currentTime={pollStatusCurrentTime + 60000} />
      )
      expect(rendered()).toHaveLength(rows.length)
    })

    it('re-renders only the row whose status changed', () => {
      const view = renderList()
      postRenders.clear()
      const liked = { ...rows[7], totalLikes: 1 } as Status
      view.rerender(rows.map((row, index) => (index === 7 ? liked : row)))
      expect(rendered().map((row) => row.id)).toEqual([rows[7].id])
    })
  })

  describe('first visible media', () => {
    const photoNote = (id: string, overrides: Partial<StatusNote> = {}) => {
      const note = createMockNote({
        id: `https://activities.local/users/alice/statuses/${id}`,
        actor: mockAlice,
        actorId: mockAlice.id,
        text: id,
        ...overrides
      })
      return {
        ...note,
        attachments: [
          {
            id: `attachment-${id}`,
            actorId: note.actorId,
            statusId: note.id,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: `https://activities.local/media/${id}.jpg`,
            name: id,
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            width: 800,
            height: 600,
            createdAt: 0,
            updatedAt: 0
          }
        ]
      } as StatusNote
    }
    const textNote = (id: string) =>
      createMockNote({
        id: `https://activities.local/users/alice/statuses/${id}`,
        actor: mockAlice,
        actorId: mockAlice.id,
        text: id
      })

    const renderRows = (statuses: Status[], prioritizeFirstMedia = true) =>
      render(
        <Posts
          host="activities.local"
          currentTime={0}
          statuses={statuses}
          prioritizeFirstMedia={prioritizeFirstMedia}
        />
      )

    it('keeps every image lazy unless the surface opts in', () => {
      const { container } = renderRows([photoNote('p1')], false)
      expect(container.querySelector('img')).not.toBeNull()
      expect(container.querySelector('[fetchpriority]')).toBeNull()
      expect(container.querySelector('img.opacity-100')).toBeNull()
      expect(container.querySelector('img[loading="eager"]')).toBeNull()
    })

    it('prioritizes only the first image row, skipping text-only rows', () => {
      const { container } = renderRows([
        textNote('t1'),
        photoNote('p1'),
        photoNote('p2')
      ])
      expect(container.querySelector('[fetchpriority]')).toBeNull()
      const eager = container.querySelectorAll('img.opacity-100')
      expect(eager).toHaveLength(1)
      expect(eager[0]).toHaveAttribute('src', expect.stringContaining('p1.jpg'))
      expect(eager[0]).not.toHaveAttribute('loading')
    })

    it('resolves boosts to the boosted post', () => {
      const boost = {
        ...makeBoost('https://remote.example/boost-1'),
        originalStatus: photoNote('boosted')
      } as Status
      expect(getPrioritizedRowIndex([textNote('t1'), boost])).toBe(1)
    })

    it('skips content-warning rows and renders no priority image for them', () => {
      const { container } = renderRows([
        photoNote('cw', { summary: 'Spoilers' }),
        photoNote('p2')
      ])
      expect(container.querySelector('[fetchpriority]')).toBeNull()
      const eager = container.querySelectorAll('img.opacity-100')
      expect(eager).toHaveLength(1)
      expect(eager[0]).toHaveAttribute('src', expect.stringContaining('p2.jpg'))
    })

    it('only looks at the first three rows', () => {
      const statuses = [
        textNote('t1'),
        textNote('t2'),
        textNote('t3'),
        photoNote('late')
      ]
      expect(getPrioritizedRowIndex(statuses)).toBe(-1)
      const { container } = renderRows(statuses)
      expect(container.querySelector('[fetchpriority]')).toBeNull()
      expect(container.querySelector('img.opacity-100')).toBeNull()
    })
  })
})
