/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { processStatusText } from '@/lib/utils/text/processStatusText'

import { QuotedPreview } from './quoted-preview'
import { ReplyPreview } from './reply-preview'

// Mock the processStatusText utility
vi.mock('@/lib/utils/text/processStatusText', async () => ({
  processStatusText: vi.fn((_host: string, status: Status) =>
    'text' in status ? status.text : ''
  )
}))

// Mock the cleanClassName utility
vi.mock('@/lib/utils/text/cleanClassName', async () => ({
  cleanClassName: vi.fn((text: string) => <span>{text}</span>)
}))

// Mock the ActorInfo component
vi.mock('@/lib/components/posts/actor', async () => ({
  ActorInfo: ({
    actor,
    actorId
  }: {
    actor?: { name: string } | null
    actorId: string
  }) => (
    <span data-testid="actor-info" data-actor-id={actorId}>
      {actor?.name || 'Unknown'}
    </span>
  )
}))

const createMockActor = (
  overrides: Partial<ActorProfile> = {}
): ActorProfile => ({
  id: 'https://example.com/users/testuser',
  username: 'testuser',
  domain: 'example.com',
  name: 'Test User',
  summary: '',
  followersUrl: 'https://example.com/users/testuser/followers',
  inboxUrl: 'https://example.com/users/testuser/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: Date.now(),
  ...overrides
})

const createMockStatus = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: 'status-1',
  type: StatusType.enum.Note,
  url: 'https://example.com/status/1',
  text: 'This is a test status',
  summary: null,
  reply: '',
  replies: [],
  actorId: 'https://example.com/users/testuser',
  actor: createMockActor(),
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides
})

type PreviewProps = {
  host: string
  status?: Status
  onClose?: () => void
}

// The quote and reply previews share one contract, differing only in the
// label and the dismiss button name.
describe.each([
  {
    name: 'QuotedPreview',
    Preview: QuotedPreview as React.FC<PreviewProps>,
    label: 'Quoting',
    dismissLabel: 'Dismiss quote'
  },
  {
    name: 'ReplyPreview',
    Preview: ReplyPreview as React.FC<PreviewProps>,
    label: 'Replying to',
    dismissLabel: 'Dismiss reply'
  }
])('$name', ({ Preview, label, dismissLabel }) => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('returns null when status is undefined', () => {
      const { container } = render(
        <Preview host="example.com" status={undefined} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders the preview with status content', () => {
      const status = createMockStatus({ text: 'Hello world!' })
      render(<Preview host="example.com" status={status} />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByTestId('actor-info')).toHaveTextContent('Test User')
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })

    it('renders "No content preview" when text is empty', () => {
      vi.mocked(processStatusText).mockReturnValueOnce('')

      const status = createMockStatus({ text: '' })
      render(<Preview host="example.com" status={status} />)

      expect(screen.getByText('No content preview')).toBeInTheDocument()
    })
  })

  describe('close button', () => {
    it('calls onClose when dismiss button is clicked', () => {
      const status = createMockStatus()
      render(
        <Preview host="example.com" status={status} onClose={mockOnClose} />
      )

      fireEvent.click(screen.getByRole('button', { name: dismissLabel }))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('has type="button" to prevent form submission', () => {
      const status = createMockStatus()
      render(<Preview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: dismissLabel })
      expect(closeButton).toHaveAttribute('type', 'button')
    })

    it('handles missing onClose gracefully', () => {
      const status = createMockStatus()
      render(<Preview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: dismissLabel })
      expect(() => fireEvent.click(closeButton)).not.toThrow()
    })
  })

  describe('text processing', () => {
    it('passes host and status to processStatusText', () => {
      const status = createMockStatus()
      render(<Preview host="my-server.com" status={status} />)

      expect(processStatusText).toHaveBeenCalledWith('my-server.com', status)
    })
  })

  describe('actor display', () => {
    it('displays actor name when actor is present', () => {
      const status = createMockStatus({
        actor: createMockActor({
          id: 'https://example.com/users/jane',
          name: 'Jane Doe',
          username: 'jane',
          followersCount: 100,
          followingCount: 50,
          statusCount: 25
        })
      })
      render(<Preview host="example.com" status={status} />)

      expect(screen.getByTestId('actor-info')).toHaveTextContent('Jane Doe')
    })

    it('passes actorId to ActorInfo when actor is null', () => {
      const status = createMockStatus({
        actor: null,
        actorId: 'https://example.com/users/unknown'
      })
      render(<Preview host="example.com" status={status} />)

      expect(screen.getByTestId('actor-info')).toHaveAttribute(
        'data-actor-id',
        'https://example.com/users/unknown'
      )
    })
  })
})
