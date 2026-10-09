/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { Post } from './post'
import { boostedStatus, currentTime } from './post.testUtils'

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

  it('renders boosts with the booster label and original post actor', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={boostedStatus}
        onShowAttachment={vi.fn()}
      />
    )

    const boostLink = screen.getByRole('link', { name: 'Booster' })
    expect(boostLink).toHaveAttribute('href', '/@booster@remote.example')
    expect(boostLink.parentElement).toHaveTextContent('Boosted by Booster')
    // The post header stays the boosted post's author: the booster's link is a
    // separate one, to a different profile.
    expect(screen.getByRole('link', { name: 'Original' })).toHaveAttribute(
      'href',
      '/@original@origin.example'
    )
  })

  it('falls back to the boost actor id when the actor profile is absent', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          actor: null,
          actorId: 'https://remote.example/@booster'
        }}
        onShowAttachment={vi.fn()}
      />
    )

    const boostLink = screen.getByRole('link', {
      name: '@booster@remote.example'
    })
    expect(boostLink).toHaveAttribute('href', '/@booster@remote.example')
    expect(boostLink.parentElement).toHaveTextContent(
      'Boosted by @booster@remote.example'
    )
  })

  it('normalizes prefixed remote actor usernames in post handles', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actor: {
              ...boostedStatus.originalStatus.actor!,
              username: '@original',
              name: undefined
            }
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'original' })).toHaveAttribute(
      'href',
      '/@original@origin.example'
    )
    expect(screen.getByText('@original@origin.example')).toBeInTheDocument()
    expect(
      screen.queryByText('@@original@origin.example')
    ).not.toBeInTheDocument()
  })

  it('normalizes actor id handles when the actor profile is absent', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://origin.example/@original',
            actor: null
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@original' })).toHaveAttribute(
      'href',
      '/@original@origin.example'
    )
    expect(screen.getByText('@origin.example')).toBeInTheDocument()
    expect(
      screen.queryByText('@@original@origin.example')
    ).not.toBeInTheDocument()
  })

  it('uses the status url handle when actor ids are opaque', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId:
              'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c',
            actor: null,
            url: 'https://hackers.pub/@hongminhee/019dc9aa-ebc9-7059-8de2-f5850dbeea4e'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@hongminhee' })).toHaveAttribute(
      'href',
      '/@hongminhee@hackers.pub'
    )
    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(
      screen.queryByText('@019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).not.toBeInTheDocument()
  })

  it('falls back to the actor domain when opaque actor ids have no usable status handle', () => {
    const actorId =
      'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c'

    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId,
            actor: null,
            url: 'https://hackers.pub/ap/notes/019dc9aa-ebc9-7059-8de2-f5850dbeea4e'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@hackers.pub' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('@019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).not.toBeInTheDocument()
  })

  it('uses bsky profile handles from bridgy status urls', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://bsky.brid.gy/ap/did:plc:2gkh62xvzokhlf6li4ol3b3d',
            actor: null,
            url: 'https://bsky.brid.gy/r/https://bsky.app/profile/patak.cat/post/3mknrszqses2y'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@patak.cat' })).toHaveAttribute(
      'href',
      '/@patak.cat@bsky.brid.gy'
    )
    expect(screen.getByText('@bsky.brid.gy')).toBeInTheDocument()
    expect(
      screen.queryByText('@did:plc:2gkh62xvzokhlf6li4ol3b3d')
    ).not.toBeInTheDocument()
  })

  it('ignores malformed bridgy embedded status urls', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://bsky.brid.gy/ap/did:plc:2gkh62xvzokhlf6li4ol3b3d',
            actor: null,
            url: 'https://bsky.brid.gy/r/%E0%A4%A'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@bsky.brid.gy')).toBeInTheDocument()
    expect(screen.queryByText('@patak.cat')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@bsky.brid.gy' })
    ).not.toBeInTheDocument()
  })

  it('does not infer bsky profile handles from unrelated status url paths', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId:
              'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c',
            actor: null,
            url: 'https://example.com/posts/bsky.app/profile/notalice'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(screen.queryByText('@notalice')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@hackers.pub' })
    ).not.toBeInTheDocument()
  })
})
