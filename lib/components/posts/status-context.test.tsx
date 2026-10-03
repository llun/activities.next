/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TimelineParentPreview } from '@/lib/types/domain/timeline'

import { StatusContextIndicator } from './status-context'

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

  it('renders HTML content in parent text as styled elements without raw HTML tags', () => {
    const htmlParent: TimelineParentPreview = {
      ...mockParentPreview,
      text: '<p><span class="h-card" translate="no"><a href="https://llun.dev/@null" class="u-url mention">@<span>null</span></a></span> That might be the reason why suddenly Gemini 4 is good. 🤔</p>',
      contentHtml: ''
    }

    const { container } = render(
      <StatusContextIndicator parentPreview={htmlParent} />
    )

    expect(
      screen.getByText(/That might be the reason why suddenly Gemini 4 is good/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/<p>/)).not.toBeInTheDocument()
    expect(screen.queryByText(/<span/)).not.toBeInTheDocument()

    // Exactly one link should exist on the entire indicator: the parent post link
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute(
      'href',
      'https://activities.local/@alice/parent-1'
    )

    // Mention should be rendered with text-primary class instead of an anchor
    const mention = container.querySelector('span.text-primary')
    expect(mention).not.toBeNull()
    expect(mention).toHaveTextContent('@null')
  })

  it('renders custom emojis and formatting for local parent posts', () => {
    const localParent: TimelineParentPreview = {
      ...mockParentPreview,
      isLocalActor: true,
      text: '**Exciting news** with :party:',
      tags: [
        {
          id: 'tag-emoji',
          statusId: 'parent-1',
          type: 'emoji',
          name: 'party',
          value: 'https://activities.local/custom-emojis/party.png',
          createdAt: 1710000000000,
          updatedAt: 1710000000000
        }
      ]
    }

    const { container } = render(
      <StatusContextIndicator parentPreview={localParent} />
    )

    expect(container.querySelector('strong')).toHaveTextContent('Exciting news')
    const emoji = container.querySelector('img.emoji')
    expect(emoji).not.toBeNull()
    expect(emoji).toHaveAttribute(
      'src',
      'https://activities.local/custom-emojis/party.png'
    )
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
