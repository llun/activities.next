/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { Post } from './post'
import { currentTime, status } from './post.testUtils'

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

  it('does not nest long-post collapse inside expanded content warnings', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={status}
        collapsible
        postLineLimit={5}
        onShowAttachment={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show content' }))

    expect(screen.queryByTestId('collapsible-content')).not.toBeInTheDocument()
  })

  it('wires onReadMore to onOpenStatus when collapsible and postLineLimit are enabled', () => {
    const handleOpenStatus = vi.fn()
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{ ...status, summary: null }}
        collapsible
        postLineLimit={5}
        onOpenStatus={handleOpenStatus}
        onShowAttachment={vi.fn()}
      />
    )

    const readMoreBtn = screen.getByTestId('read-more-button')
    expect(readMoreBtn).toBeInTheDocument()
    fireEvent.click(readMoreBtn)
    expect(handleOpenStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: status.id })
    )
  })

  it('omits onReadMore when onOpenStatus is not provided', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{ ...status, summary: null }}
        collapsible
        postLineLimit={5}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByTestId('collapsible-content')).toBeInTheDocument()
    expect(screen.queryByTestId('read-more-button')).not.toBeInTheDocument()
  })

  describe('quote-inline RE: fallback', () => {
    // A remote quote post as Mastodon 4.5 federates it: the structured quote
    // edge plus the legacy fallback paragraph prepended to the content.
    const quotedUrl = 'https://remote.example/users/alice/statuses/9'
    const remoteQuoteText = `<p class="quote-inline">RE: <a href="${quotedUrl}">${quotedUrl}</a></p><p>worth a read</p>`

    it('hides the fallback when the quote card renders', () => {
      const { container } = render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            isLocalActor: false,
            summary: null,
            text: remoteQuoteText,
            quote: { quotedStatusId: quotedUrl, state: 'accepted' }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      const fallback = container.querySelector('p.hidden')
      expect(fallback?.textContent).toContain('RE:')
      expect(container.querySelector('.quote-inline')).toBeNull()
    })

    it('keeps the fallback visible when the quote edge is missing', () => {
      // No edge means no quote card — the RE: line is the reader's only clue.
      const { container } = render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            isLocalActor: false,
            summary: null,
            text: remoteQuoteText
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(container.querySelector('p.quote-inline')).not.toBeNull()
      expect(container.querySelector('p.hidden')).toBeNull()
    })
  })
})
