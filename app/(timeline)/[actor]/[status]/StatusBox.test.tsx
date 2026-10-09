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
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { StatusBox } from './StatusBox'

const mockPush = vi.fn()

vi.mock('@/lib/components/posts/collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('./FitnessStatusDetail', () => ({
  FitnessStatusDetail: ({
    onShowAttachment
  }: {
    onShowAttachment: (medias: unknown[], index: number) => void
  }) => (
    <button type="button" onClick={() => onShowAttachment([{}], 0)}>
      Open fitness photo
    </button>
  )
}))

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

vi.mock('./StatusLikes', () => ({
  StatusLikes: () => <div data-testid="status-likes" />
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
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

const mockVotePoll = vi.mocked(votePoll)
const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)

describe('StatusBox', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockVotePoll.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@llun/poll-1')
  })

  it('only opens comment status detail pages from the timestamp', async () => {
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="comment"
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

    fireEvent.click(screen.getByRole('button', { name: /Open status by Llun/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@llun/poll-1')
    })
  })

  it('renders the likes list on the detail view for a signed-in actor', () => {
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="detail"
      />
    )

    expect(screen.getByTestId('status-likes')).toBeInTheDocument()
  })

  it('hides the likes list on the detail view for logged-out visitors', () => {
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentActor={null}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="detail"
      />
    )

    expect(screen.queryByTestId('status-likes')).not.toBeInTheDocument()
  })

  it('offers the shared action row on the detail post for a signed-in actor', () => {
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="detail"
      />
    )

    expect(
      screen.getByRole('button', { name: /Reply to post/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /More actions/ })
    ).toBeInTheDocument()
  })

  it('keeps comment rows read-only even for a signed-in actor', () => {
    // Only the primary (detail) post is interactive; comment rows must not
    // expose reply/quote/edit affordances.
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="comment"
      />
    )

    expect(
      screen.queryByRole('button', { name: /Reply to post/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /More actions/ })
    ).not.toBeInTheDocument()
  })

  describe('viewer albums owner', () => {
    const author = pollStatusFixture.actor!
    const someoneElse = {
      ...author,
      id: 'https://activities.local/users/someone-else'
    }

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
      currentActor: typeof author | null,
      status: StatusNote = withPhoto()
    ) => {
      render(
        <StatusBox
          host="activities.local"
          mapProvider={{ type: 'osm' }}
          currentActor={currentActor}
          currentTime={pollStatusCurrentTime}
          status={status}
          variant="detail"
        />
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Open media: A heron' })
      )
    }

    it('offers the author the albums pill on their own post', () => {
      open(author)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        author.id
      )
    })

    it('offers nobody else’s post an albums pill', () => {
      open(someoneElse)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('offers a signed-out visitor none', () => {
      open(null)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('goes by who wrote a boosted post, not who boosted it', () => {
      const boost = {
        ...pollStatusFixture,
        id: 'https://activities.local/users/llun/statuses/boost-1',
        type: StatusType.enum.Announce,
        originalStatus: withPhoto({
          actorId: 'https://remote.example/users/someone'
        })
      } as unknown as StatusNote

      open(author, boost)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('offers the author the pill from a fitness post’s photos too', () => {
      render(
        <StatusBox
          host="activities.local"
          mapProvider={{ type: 'osm' }}
          currentActor={author}
          currentTime={pollStatusCurrentTime}
          status={withPhoto({
            fitness: { processingStatus: 'completed' }
          } as unknown as Partial<StatusNote>)}
          variant="detail"
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Open fitness photo' })
      )

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        author.id
      )
    })

    it('offers others none on a fitness post’s photos', () => {
      render(
        <StatusBox
          host="activities.local"
          mapProvider={{ type: 'osm' }}
          currentActor={someoneElse}
          currentTime={pollStatusCurrentTime}
          status={withPhoto({
            fitness: { processingStatus: 'completed' }
          } as unknown as Partial<StatusNote>)}
          variant="detail"
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Open fitness photo' })
      )

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })
  })
})
