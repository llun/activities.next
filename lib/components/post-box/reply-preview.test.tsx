/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { StatusAnnounce, StatusNote, StatusType } from '@/lib/models/status'

import { ReplyPreview } from './reply-preview'

// Mock the processStatusText utility
jest.mock('../../utils/text/processStatusText', () => ({
  processStatusText: jest.fn((_host: string, status: StatusNote) => {
    return status.text
  }),
  getActualStatus: jest.fn((status: StatusNote) => status)
}))

// Mock the cleanClassName utility
jest.mock('../../utils/text/cleanClassName', () => ({
  cleanClassName: jest.fn((text: string) => <span>{text}</span>)
}))

// Mock the ActorInfo component
jest.mock('../posts/actor', () => ({
  ActorInfo: ({ actor }: { actor: { name: string } }) => (
    <span data-testid="actor-info">{actor?.name || 'Unknown'}</span>
  )
}))

describe('ReplyPreview', () => {
  const mockOnClose = jest.fn()

  const createMockStatus = (
    overrides: Partial<StatusNote> = {}
  ): StatusNote => ({
    id: 'status-1',
    type: StatusType.enum.Note,
    url: 'https://example.com/status/1',
    text: 'This is a test status',
    summary: null,
    reply: '',
    replies: [],
    actorId: 'https://example.com/users/testuser',
    actor: {
      id: 'https://example.com/users/testuser',
      username: 'testuser',
      domain: 'example.com',
      name: 'Test User',
      followersUrl: 'https://example.com/users/testuser/followers',
      inboxUrl: 'https://example.com/users/testuser/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      iconUrl: undefined,
      summary: undefined,
      followersCount: 0,
      followingCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: Date.now()
    },
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    attachments: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  })

  const createMockAnnounceStatus = (): StatusAnnounce => ({
    id: 'announce-1',
    type: StatusType.enum.Announce,
    actorId: 'https://example.com/users/booster',
    actor: {
      id: 'https://example.com/users/booster',
      username: 'booster',
      domain: 'example.com',
      name: 'Booster User',
      followersUrl: 'https://example.com/users/booster/followers',
      inboxUrl: 'https://example.com/users/booster/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      iconUrl: undefined,
      summary: undefined,
      followersCount: 0,
      followingCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: Date.now()
    },
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    originalStatus: createMockStatus({
      text: 'This is the original boosted status'
    }),
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('rendering', () => {
    it('returns null when status is undefined', () => {
      const { container } = render(
        <ReplyPreview host="example.com" status={undefined} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders the reply preview with status content', () => {
      const status = createMockStatus({ text: 'Hello world!' })
      render(<ReplyPreview host="example.com" status={status} />)

      expect(screen.getByText('Replying to')).toBeInTheDocument()
      expect(screen.getByTestId('actor-info')).toHaveTextContent('Test User')
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })

    it('renders "No content preview" when text is empty', () => {
      const { processStatusText } = jest.requireMock(
        '../../utils/text/processStatusText'
      )
      processStatusText.mockReturnValueOnce('')

      const status = createMockStatus({ text: '' })
      render(<ReplyPreview host="example.com" status={status} />)

      expect(screen.getByText('No content preview')).toBeInTheDocument()
    })

    it('applies custom className when provided', () => {
      const status = createMockStatus()
      const { container } = render(
        <ReplyPreview
          host="example.com"
          status={status}
          className="custom-class"
        />
      )

      const section = container.querySelector('section')
      expect(section).toHaveClass('custom-class')
    })
  })

  describe('close button', () => {
    it('calls onClose when dismiss button is clicked', () => {
      const status = createMockStatus()
      render(
        <ReplyPreview
          host="example.com"
          status={status}
          onClose={mockOnClose}
        />
      )

      const closeButton = screen.getByRole('button', { name: 'Dismiss reply' })
      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('has type="button" to prevent form submission', () => {
      const status = createMockStatus()
      render(<ReplyPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss reply' })
      expect(closeButton).toHaveAttribute('type', 'button')
    })

    it('handles missing onClose gracefully', () => {
      const status = createMockStatus()
      render(<ReplyPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss reply' })
      expect(() => fireEvent.click(closeButton)).not.toThrow()
    })
  })

  describe('status types', () => {
    it('renders Note status correctly', () => {
      const status = createMockStatus({
        type: StatusType.enum.Note,
        text: 'This is a note'
      })
      render(<ReplyPreview host="example.com" status={status} />)

      expect(screen.getByText('This is a note')).toBeInTheDocument()
    })

    it('renders boosted (Announce) status with original content', () => {
      const { processStatusText } = jest.requireMock(
        '../../utils/text/processStatusText'
      )
      processStatusText.mockReturnValueOnce(
        'This is the original boosted status'
      )

      const status = createMockAnnounceStatus()
      render(<ReplyPreview host="example.com" status={status} />)

      expect(
        screen.getByText('This is the original boosted status')
      ).toBeInTheDocument()
    })
  })

  describe('text processing', () => {
    it('passes host and status to processStatusText', () => {
      const { processStatusText } = jest.requireMock(
        '../../utils/text/processStatusText'
      )

      const status = createMockStatus()
      render(<ReplyPreview host="my-server.com" status={status} />)

      expect(processStatusText).toHaveBeenCalledWith('my-server.com', status)
    })

    it('handles long text content with line clamping styles', () => {
      const longText =
        'This is a very long status that should be truncated. '.repeat(10)
      const status = createMockStatus({ text: longText })
      const { container } = render(
        <ReplyPreview host="example.com" status={status} />
      )

      // The text is inside a span from cleanClassName mock, which is inside the div with line-clamp-2
      const textContainer = container.querySelector('.line-clamp-2')
      expect(textContainer).toBeInTheDocument()
    })
  })

  describe('actor display', () => {
    it('displays actor name when actor is present', () => {
      const status = createMockStatus({
        actor: {
          id: 'https://example.com/users/jane',
          username: 'jane',
          domain: 'example.com',
          name: 'Jane Doe',
          followersUrl: 'https://example.com/users/jane/followers',
          inboxUrl: 'https://example.com/users/jane/inbox',
          sharedInboxUrl: 'https://example.com/inbox',
          iconUrl: undefined,
          summary: undefined,
          followersCount: 100,
          followingCount: 50,
          statusCount: 25,
          lastStatusAt: null,
          createdAt: Date.now()
        }
      })
      render(<ReplyPreview host="example.com" status={status} />)

      expect(screen.getByTestId('actor-info')).toHaveTextContent('Jane Doe')
    })

    it('passes actorId to ActorInfo when actor is null', () => {
      const status = createMockStatus({
        actor: null,
        actorId: 'https://example.com/users/unknown'
      })
      render(<ReplyPreview host="example.com" status={status} />)

      expect(screen.getByTestId('actor-info')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('uses semantic section element', () => {
      const status = createMockStatus()
      const { container } = render(
        <ReplyPreview host="example.com" status={status} />
      )

      expect(container.querySelector('section')).toBeInTheDocument()
    })

    it('has accessible dismiss button with aria-label', () => {
      const status = createMockStatus()
      render(<ReplyPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss reply' })
      expect(closeButton).toHaveAttribute('aria-label', 'Dismiss reply')
    })
  })
})
