/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { StatusNote } from '@/lib/types/domain/status'

import { Post } from './post'
import { boostedStatus, currentTime, status } from './post.testUtils'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({
    children,
    onReadMore
  }: {
    children: ReactNode
    onReadMore?: () => void
  }) => (
    <div data-testid="collapsible-content">
      {children}
      {onReadMore && (
        <button
          type="button"
          data-testid="read-more-button"
          onClick={onReadMore}
        >
          Read full post
        </button>
      )}
    </div>
  )
}))

vi.mock('./poll', () => ({
  Poll: () => null
}))

vi.mock('./attachments', () => ({
  Attachments: () => null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  deleteStatus: vi.fn(),
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  retryFitnessProcessing: vi.fn(),
  getFitnessProcessingState: vi.fn().mockResolvedValue(null),
  getTranslationCapability: vi.fn(),
  getTranslationLanguages: vi.fn(),
  translateStatus: vi.fn(),
  reactToStatus: vi.fn(),
  unreactFromStatus: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  // QuoteCard loads the quoted status itself; a quoting status renders it.
  getStatusById: vi.fn().mockResolvedValue(null)
}))

describe('Post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('link preview card', () => {
    const linkPreview = {
      url: 'https://example.com/article',
      title: 'A linked article',
      description: 'What it says',
      siteName: 'Example',
      imageUrl: null
    }

    it('renders the card for a status that has one', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{ ...status, summary: null, linkPreview }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('A linked article')).toBeInTheDocument()
    })

    it('renders nothing for a status with no card', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{ ...status, summary: null }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
    })

    // A YouTube link gets the click-to-play player rather than the link
    // anatomy. The card is chosen from the url alone, so it reaches this
    // surface with no other change to the status.
    it('renders a play button for a card that links a YouTube video', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview: {
              ...linkPreview,
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        screen.getByRole('button', { name: 'Play video: A linked article' })
      ).toBeInTheDocument()
    })

    // Media, a quoted post and a fitness activity are all richer
    // representations of what the post is about; the link card yields to them
    // rather than stacking a second block underneath.
    it('yields to media attachments', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            attachments: [
              {
                id: 'attachment-1',
                actorId: status.actorId,
                statusId: status.id,
                type: 'Document',
                mediaType: 'image/png',
                url: 'https://activities.local/image.png',
                width: 100,
                height: 100,
                name: '',
                createdAt: currentTime,
                updatedAt: currentTime
              }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
    })

    // It yields to media the post actually SHOWS, which is not the same as the
    // post having attachments: `Attachments` skips anything `Media` renders as
    // nothing, so a bare `attachments.length` would yield the card to a block
    // that never appears.
    it('does not yield to an attachment nothing can render', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            attachments: [
              {
                id: 'attachment-fit',
                actorId: status.actorId,
                statusId: status.id,
                type: 'Document',
                mediaType: 'application/vnd.ant.fit',
                url: 'https://activities.local/ride.fit',
                name: 'ride.fit',
                createdAt: currentTime,
                updatedAt: currentTime
              }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('A linked article')).toBeInTheDocument()
    })

    it('yields to an audio attachment, which does render', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            attachments: [
              {
                id: 'attachment-audio',
                actorId: status.actorId,
                statusId: status.id,
                type: 'Document',
                mediaType: 'audio/mpeg',
                url: 'https://activities.local/track.mp3',
                name: '',
                createdAt: currentTime,
                updatedAt: currentTime
              }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
    })

    it('yields to a quoted post', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            quote: {
              quotedStatusId: 'https://remote.example/users/a/statuses/9',
              state: 'accepted' as const
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
    })

    // The comment on the suppression names three things the card yields to.
    // Media and quotes were covered; a fitness activity renders a bordered chip
    // directly above where the card would go, so stacking both is exactly the
    // double-card this avoids.
    it('yields to a fitness activity', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            fitness: {
              id: 'fitness-file-1',
              fileName: 'ride.fit',
              fileType: 'fit' as const,
              mimeType: 'application/octet-stream',
              bytes: 1024,
              url: 'https://activities.local/api/v1/files/ride.fit',
              processingStatus: 'completed' as const
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
      // The chip really is on screen, so the card yielded to something.
      expect(screen.getByText('ride.fit')).toBeInTheDocument()
    })

    it('still yields while a fitness file is only processing', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            linkPreview,
            fitness: {
              id: 'fitness-file-2',
              fileName: 'ride.gpx',
              fileType: 'gpx' as const,
              mimeType: 'application/gpx+xml',
              bytes: 2048,
              url: 'https://activities.local/api/v1/files/ride.gpx',
              processingStatus: 'processing' as const
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText('A linked article')).not.toBeInTheDocument()
      expect(screen.getByText('ride.gpx')).toBeInTheDocument()
    })

    it('renders the card of the boosted status, not of the boost', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...boostedStatus,
            originalStatus: {
              ...(boostedStatus.originalStatus as StatusNote),
              summary: null,
              linkPreview
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('A linked article')).toBeInTheDocument()
    })
  })

  describe('header timestamp', () => {
    const MINUTE = 60 * 1000
    const HOUR = 60 * MINUTE

    it('shows the compact time and keeps the spelled-out distance in the button name', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            createdAt: currentTime - 35 * MINUTE
          }}
          onOpenStatus={vi.fn()}
          onShowAttachment={vi.fn()}
        />
      )

      const button = screen.getByRole('button', {
        name: 'Open status by Llun, posted 35 minutes ago'
      })
      expect(button).toHaveTextContent('35m')
    })

    it.each([
      ['less than a minute', 20 * 1000, 'now'],
      ['hours', 2 * HOUR, '2h'],
      ['days', 3 * 24 * HOUR, '3d']
    ])(
      'formats %s ago as %s when the timestamp is not a button',
      (_label, ago, expected) => {
        render(
          <Post
            host="activities.local"
            currentTime={currentTime}
            status={{ ...status, summary: null, createdAt: currentTime - ago }}
            onShowAttachment={vi.fn()}
          />
        )

        expect(screen.getByText(expected)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Open status/ })).toBeNull()
      }
    )

    it('gives the timestamp that is not a button the spelled-out distance for assistive tech', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            createdAt: currentTime - 35 * MINUTE
          }}
          onShowAttachment={vi.fn()}
        />
      )

      // The compact text is what is drawn, and is hidden from the
      // accessibility tree; the long form is visually hidden text.
      const compact = screen.getByText('35m')
      expect(compact).toHaveAttribute('aria-hidden', 'true')
      const long = screen.getByText('35 minutes ago')
      expect(long).toHaveClass('sr-only')
      expect(long.parentElement).toBe(compact.parentElement)
      expect(compact.parentElement).toHaveTextContent('35m35 minutes ago')
    })

    it('spells out "less than a minute" for a post that reads "now"', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            createdAt: currentTime - 20 * 1000
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('now')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByText('less than a minute ago')).toHaveClass('sr-only')
    })

    it('opens the status when the timestamp is pressed', () => {
      const handleOpenStatus = vi.fn()
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{ ...status, summary: null }}
          onOpenStatus={handleOpenStatus}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /Open status/ }))
      expect(handleOpenStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: status.id })
      )
    })

    it('centres the header row on the avatar only for the focused post', () => {
      const { container, rerender } = render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{ ...status, summary: null }}
          onShowAttachment={vi.fn()}
        />
      )
      const headerRow = () =>
        container.querySelector('.flex-1 > .flex.flex-wrap')

      expect(headerRow()).not.toBeNull()
      expect(headerRow()).not.toHaveClass('mt-2.5')

      rerender(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{ ...status, summary: null }}
          focused
          onShowAttachment={vi.fn()}
        />
      )
      expect(headerRow()).toHaveClass('mt-2.5')
    })
  })

  describe('user profile links in status text', () => {
    it('renders mention links in status text with local profile href', () => {
      const statusWithMention: StatusNote = {
        ...status,
        id: 'https://activities.local/users/llun/statuses/mention-status-1',
        summary: '',
        text: '<p>Hello <a href="https://mastodon.social/@remoteuser" class="u-url mention">@remoteuser</a></p>',
        isLocalActor: false,
        tags: [
          {
            id: 'tag-mention-1',
            statusId:
              'https://activities.local/users/llun/statuses/mention-status-1',
            type: 'mention',
            name: '@remoteuser@mastodon.social',
            value: 'https://mastodon.social/@remoteuser',
            createdAt: 0,
            updatedAt: 0
          }
        ]
      }

      const onParentClick = vi.fn()
      render(
        <div onClick={onParentClick}>
          <Post
            host="activities.local"
            currentTime={currentTime}
            status={statusWithMention}
            onShowAttachment={vi.fn()}
          />
        </div>
      )

      const mentionLink = screen.getByRole('link', { name: '@remoteuser' })
      expect(mentionLink).toHaveAttribute(
        'href',
        '/@remoteuser@mastodon.social'
      )
      expect(mentionLink).not.toHaveAttribute('target')

      fireEvent.click(mentionLink)
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})
