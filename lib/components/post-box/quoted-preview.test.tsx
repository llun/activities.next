/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { QuotedPreview } from '@/lib/components/post-box/quoted-preview'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

// Mock the processStatusText utility
vi.mock('@/lib/utils/text/processStatusText', async () => ({
  processStatusText: vi.fn((_host: string, status: Status) => {
    const original = getOriginalStatus(status)
    return original.text
  }),
  getActualStatus: vi.fn((status: Status) => status)
}))

// Mock the cleanClassName utility
vi.mock('@/lib/utils/text/cleanClassName', async () => ({
  cleanClassName: vi.fn((text: string) => <span>{text}</span>)
}))

// Mock the ActorInfo component
vi.mock('@/lib/components/posts/actor', async () => ({
  ActorInfo: ({ actor }: { actor?: ActorProfile | null }) => (
    <span data-testid="actor-info">{actor?.name || 'Unknown'}</span>
  )
}))

describe('QuotedPreview', () => {
  const mockOnClose = vi.fn()

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

  const createMockAnnounceStatus = (): StatusAnnounce => ({
    id: 'announce-1',
    type: StatusType.enum.Announce,
    actorId: 'https://example.com/users/booster',
    actor: createMockActor({
      id: 'https://example.com/users/booster',
      username: 'booster',
      name: 'Booster User'
    }),
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
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('returns null when status is undefined', () => {
      const { container } = render(
        <QuotedPreview host="example.com" status={undefined} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders the quote preview with status content', () => {
      const status = createMockStatus({ text: 'Hello world!' })
      render(<QuotedPreview host="example.com" status={status} />)

      expect(screen.getByText('Quoting')).toBeInTheDocument()
      expect(screen.getByTestId('actor-info')).toHaveTextContent('Test User')
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })

    it('renders "No content preview" when text is empty', async () => {
      const { processStatusText } = await vi.importMock<{
        processStatusText: ReturnType<typeof vi.fn>
      }>('@/lib/utils/text/processStatusText')
      processStatusText.mockReturnValueOnce('')

      const status = createMockStatus({ text: '' })
      render(<QuotedPreview host="example.com" status={status} />)

      expect(screen.getByText('No content preview')).toBeInTheDocument()
    })

    it('applies custom className when provided', () => {
      const status = createMockStatus()
      const { container } = render(
        <QuotedPreview
          host="example.com"
          status={status}
          className="custom-class"
        />
      )

      const section = container.querySelector('section')
      expect(section).toHaveClass('custom-class')
    })

    it('applies overflow-hidden and min-w-0 classes to prevent header overflow', () => {
      const status = createMockStatus()
      const { container } = render(
        <QuotedPreview host="example.com" status={status} />
      )

      const section = container.querySelector('section')
      expect(section).toHaveClass('overflow-hidden')

      const quotingLabel = screen.getByText('Quoting')
      expect(quotingLabel).toHaveClass('shrink-0')

      const headerRow = quotingLabel.parentElement
      expect(headerRow).toHaveClass('min-w-0')

      const actorInfoWrapper = headerRow?.querySelector('.flex-1')
      expect(actorInfoWrapper).toHaveClass('min-w-0')
      expect(actorInfoWrapper).toHaveClass('flex-1')
    })
  })

  describe('close button', () => {
    it('calls onClose when dismiss button is clicked', () => {
      const status = createMockStatus()
      render(
        <QuotedPreview
          host="example.com"
          status={status}
          onClose={mockOnClose}
        />
      )

      const closeButton = screen.getByRole('button', { name: 'Dismiss quote' })
      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('has type="button" to prevent form submission', () => {
      const status = createMockStatus()
      render(<QuotedPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss quote' })
      expect(closeButton).toHaveAttribute('type', 'button')
    })

    it('handles missing onClose gracefully', () => {
      const status = createMockStatus()
      render(<QuotedPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss quote' })
      expect(() => fireEvent.click(closeButton)).not.toThrow()
    })
  })

  describe('status types', () => {
    it('renders Note status correctly', () => {
      const status = createMockStatus({
        type: StatusType.enum.Note,
        text: 'This is a note'
      })
      render(<QuotedPreview host="example.com" status={status} />)

      expect(screen.getByText('This is a note')).toBeInTheDocument()
    })

    it('renders boosted (Announce) status with original content', async () => {
      const { processStatusText } = await vi.importMock<{
        processStatusText: ReturnType<typeof vi.fn>
      }>('@/lib/utils/text/processStatusText')
      processStatusText.mockReturnValueOnce(
        'This is the original boosted status'
      )

      const status = createMockAnnounceStatus()
      render(<QuotedPreview host="example.com" status={status} />)

      expect(
        screen.getByText('This is the original boosted status')
      ).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('uses semantic section element', () => {
      const status = createMockStatus()
      const { container } = render(
        <QuotedPreview host="example.com" status={status} />
      )

      expect(container.querySelector('section')).toBeInTheDocument()
    })

    it('has accessible dismiss button with aria-label', () => {
      const status = createMockStatus()
      render(<QuotedPreview host="example.com" status={status} />)

      const closeButton = screen.getByRole('button', { name: 'Dismiss quote' })
      expect(closeButton).toHaveAttribute('aria-label', 'Dismiss quote')
    })
  })
})
