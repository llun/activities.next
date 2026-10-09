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
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { Posts } from './posts'

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

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush
  })
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
    status
  }: {
    mode: string
    status: { id: string }
  }) => (
    <div
      data-testid="inline-composer"
      data-mode={mode}
      data-status={status.id}
    />
  )
}))

// Only what Posts hands the viewer matters here; the viewer has its own tests.
vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    albumsOwnerId
  }: {
    medias: unknown[] | null
    albumsOwnerId?: string | null
  }) =>
    medias ? (
      <div data-testid="viewer" data-albums-owner={albumsOwnerId ?? 'none'} />
    ) : null
}))

const mockVotePoll = vi.mocked(votePoll)
const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)

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

  it('opens the shared inline composer from a post action row', () => {
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

    const composer = screen.getByTestId('inline-composer')
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
})
