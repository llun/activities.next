/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TimelineParentPreview } from '@/lib/types/domain/timeline'

import { StatusConnectorRail, StatusContextIndicator } from './status-context'

describe('StatusConnectorRail', () => {
  it('renders connector rail with position first', () => {
    render(<StatusConnectorRail position="first" />)
    const rail = screen.getByTestId('connector-rail')
    expect(rail).toBeInTheDocument()
    expect(rail).toHaveAttribute('data-position', 'first')
    expect(rail).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders connector rail with position middle', () => {
    render(<StatusConnectorRail position="middle" />)
    const rail = screen.getByTestId('connector-rail')
    expect(rail).toBeInTheDocument()
    expect(rail).toHaveAttribute('data-position', 'middle')
  })

  it('renders connector rail with position last', () => {
    render(<StatusConnectorRail position="last" />)
    const rail = screen.getByTestId('connector-rail')
    expect(rail).toBeInTheDocument()
    expect(rail).toHaveAttribute('data-position', 'last')
  })

  it('returns null for position single', () => {
    const { container } = render(<StatusConnectorRail position="single" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StatusContextIndicator', () => {
  const mockParentPreview: TimelineParentPreview = {
    id: 'https://activities.local/users/alice/statuses/parent-1',
    url: 'https://activities.local/@alice/parent-1',
    actor: {
      id: 'https://activities.local/users/alice',
      username: 'alice',
      domain: 'activities.local',
      name: 'Alice Smith',
      avatarUrl: 'https://activities.local/avatars/alice.png'
    },
    contentHtml: '<p>Original parent thought that started discussion</p>',
    text: 'Original parent thought that started discussion',
    createdAt: new Date().toISOString(),
    visibility: 'public'
  }

  it('renders bounded parent preview with author, handle, and accessible label', () => {
    render(<StatusContextIndicator parentPreview={mockParentPreview} />)

    const indicator = screen.getByLabelText('Reply to @alice')
    expect(indicator).toBeInTheDocument()

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('@alice@activities.local')).toBeInTheDocument()
    expect(
      screen.getByText(/Original parent thought that started discussion/)
    ).toBeInTheDocument()

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://activities.local/@alice/parent-1'
    )
  })

  it('respects content warning and does not leak content when parent is sensitive', () => {
    const sensitiveParent: TimelineParentPreview = {
      ...mockParentPreview,
      isSensitive: true,
      spoilerText: 'Spoiler about movie ending',
      text: 'Bruce Willis was a ghost the whole time'
    }

    render(<StatusContextIndicator parentPreview={sensitiveParent} />)

    expect(screen.getByLabelText('Reply to @alice')).toBeInTheDocument()
    expect(
      screen.getByText('CW: Spoiler about movie ending')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Bruce Willis was a ghost the whole time')
    ).not.toBeInTheDocument()
  })

  it('respects content warning when isSensitive is true with empty spoilerText', () => {
    const sensitiveParent: TimelineParentPreview = {
      ...mockParentPreview,
      isSensitive: true,
      spoilerText: '',
      text: 'Sensitive secret body'
    }

    render(<StatusContextIndicator parentPreview={sensitiveParent} />)

    expect(screen.getByText('CW: Sensitive content')).toBeInTheDocument()
    expect(screen.queryByText('Sensitive secret body')).not.toBeInTheDocument()
  })

  it('stops propagation when parent link is clicked', () => {
    const outerClick = vi.fn()
    render(
      <div onClick={outerClick}>
        <StatusContextIndicator parentPreview={mockParentPreview} />
      </div>
    )

    const link = screen.getByRole('link')
    fireEvent.click(link)
    expect(outerClick).not.toHaveBeenCalled()
  })

  it('renders generic reply indicator when parent preview is unknown but isReply is true', () => {
    render(<StatusContextIndicator parentPreview={null} isReply={true} />)

    const indicator = screen.getByLabelText('In reply to a post')
    expect(indicator).toBeInTheDocument()
    expect(screen.getByText('In reply to a post')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders null when not a reply and no parent preview', () => {
    const { container } = render(
      <StatusContextIndicator parentPreview={null} isReply={false} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
