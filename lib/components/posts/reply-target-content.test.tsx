/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import React from 'react'

import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { ReplyTargetContent } from './reply-target-content'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    prefetch?: boolean
    [key: string]: unknown
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

const currentTime = new Date('2026-10-09T10:00:00.000Z').getTime()

const baseNote: StatusNote = {
  id: 'https://mastodon.social/users/cheeaun/statuses/1',
  actorId: 'https://mastodon.social/users/cheeaun',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://mastodon.social/@cheeaun/1',
  text: '',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

const renderContent = (status: Partial<StatusNote>) =>
  render(
    <ReplyTargetContent
      host="llun.dev"
      status={{ ...baseNote, ...status }}
      fallback={<span>No content preview</span>}
    />
  )

const quote = {
  quotedStatusId: 'https://remote.social/@a/1',
  state: 'accepted' as const
}

describe('ReplyTargetContent', () => {
  it('renders a remote Mastodon mention as one profile link, as the status does', () => {
    renderContent({
      text: '<p><span class="h-card" translate="no"><a href="https://llun.dev/@null" class="u-url mention">@<span>null</span></a></span> Affinity and Pixelmator Pro?</p>',
      tags: [
        {
          id: 'tag-1',
          statusId: baseNote.id,
          type: 'mention',
          name: '@null@llun.dev',
          value: 'https://llun.dev/users/null',
          createdAt: currentTime,
          updatedAt: currentTime
        }
      ]
    })

    const mention = screen.getByRole('link', { name: '@null' })
    expect(mention).toHaveAttribute('href', '/@null')
    expect(screen.getByTestId('reply-target-content')).toHaveTextContent(
      '@null Affinity and Pixelmator Pro?'
    )
  })

  it.each([
    {
      description: 'keeps an unclosed angle bracket in local plain text',
      status: { isLocalActor: true, text: 'for i<n do something useful' },
      expected: 'for i<n do something useful'
    },
    {
      description: 'renders local markdown',
      status: { isLocalActor: true, text: '**bold** and `code`' },
      expected: 'bold and code'
    },
    {
      description: 'decodes entities in remote html',
      status: { text: '<p>isn&#39;t it?</p>' },
      expected: "isn't it?"
    },
    {
      description: 'hides the quote fallback when the status has a quote',
      status: {
        quote,
        text: '<p>my take</p><p class="quote-inline">RE: <a href="https://remote.social/@a/1">https://remote.social/@a/1</a></p>'
      },
      expected: 'my take'
    },
    {
      description: 'keeps the quote fallback when the status has no quote',
      status: {
        text: '<p>my take</p><p class="quote-inline">RE: <a href="https://remote.social/@a/1">https://remote.social/@a/1</a></p>'
      },
      expected: 'my take RE: https://remote.social/@a/1'
    }
  ])('$description', ({ status, expected }) => {
    renderContent(status)
    const content = screen.getByTestId('reply-target-content')
    // The visible text: parts with the `hidden` class do not count, and
    // inline paragraphs are separated by a CSS space jsdom does not render.
    content.querySelectorAll('.hidden').forEach((node) => node.remove())
    content.querySelectorAll('p').forEach((paragraph) => paragraph.append(' '))
    expect(content.textContent?.replace(/\s+/g, ' ').trim()).toBe(expected)
  })

  it('hides the invisible parts of a Mastodon long link', () => {
    renderContent({
      text: '<p>see <a href="https://example.com/longpath"><span class="invisible">https://</span><span class="ellipsis">example.com/long</span><span class="invisible">path</span></a></p>'
    })

    const link = screen.getByRole('link')
    expect(link.querySelectorAll('span.hidden')).toHaveLength(2)
    expect(link.querySelector('span:not(.hidden)')).toHaveTextContent(
      'example.com/long'
    )
  })

  it('renders the fallback when the status has no text', () => {
    renderContent({ text: '' })

    expect(screen.getByText('No content preview')).toBeInTheDocument()
    expect(screen.queryByTestId('reply-target-content')).not.toBeInTheDocument()
  })
})
