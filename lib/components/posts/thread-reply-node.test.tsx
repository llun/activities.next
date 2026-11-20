/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComponentProps, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import {
  ThreadFoldRow,
  ThreadReplyNode
} from '@/lib/components/posts/thread-reply-node'
import type { ThreadNode } from '@/lib/components/posts/threadModel'
import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import type { Status } from '@/lib/types/domain/status'

const composer = {
  active: null,
  openReply: vi.fn(),
  openQuote: vi.fn(),
  openEdit: vi.fn(),
  close: vi.fn()
} as unknown as InlineComposerControls

const node = (status: Status): ThreadNode => ({
  status,
  depth: 0,
  replies: [],
  totalDescendantCount: 0
})

const parent = createMockNote({
  id: 'https://activities.local/users/bob/statuses/parent',
  actor: mockBob,
  actorId: mockBob.id,
  text: 'Parent post',
  createdAt: BASE_TIME
})

const reply = createMockNote({
  id: 'https://activities.local/users/alice/statuses/reply',
  actor: mockAlice,
  actorId: mockAlice.id,
  reply: parent.id,
  text: 'Reply post',
  createdAt: BASE_TIME + 1000
})

const rowElement = (
  props: Partial<ComponentProps<typeof ThreadReplyNode>> = {}
) => (
  <ThreadReplyNode
    host="activities.local"
    currentTime={BASE_TIME + 10000}
    composer={composer}
    onOpenStatus={vi.fn()}
    onShowAttachment={vi.fn()}
    onComposerDone={vi.fn()}
    node={node(reply)}
    parent={parent}
    {...props}
  />
)

const srOnlyLabels = (text: string) =>
  [...document.querySelectorAll('.sr-only')].filter(
    (element) => element.textContent === text
  )

describe('ThreadReplyNode', () => {
  it('links a nested row that does not join the row above to its parent', () => {
    render(
      <>
        <div id={parent.id} data-testid="parent-target" tabIndex={-1} />
        {rowElement({ lineAbove: false })}
      </>
    )

    const link = screen.getByRole('link', { name: 'Bob Jones' })
    expect(link).toHaveAttribute('href', `#${parent.id}`)

    // Only the visible label names the parent: no screen-reader twin.
    expect(srOnlyLabels('Replying to Bob Jones')).toEqual([])

    fireEvent.click(link)
    expect(document.activeElement).toBe(screen.getByTestId('parent-target'))
  })

  it('names the parent to screen readers only when the row joins the one above', () => {
    render(rowElement({ lineAbove: true }))

    const label = screen.getByText('Replying to Bob Jones')
    expect(label).toHaveClass('sr-only')
    // Never both: a joined row shows no visible link to its parent.
    expect(screen.queryByRole('link', { name: 'Bob Jones' })).toBeNull()
  })
})

const FoldHarness = ({
  row
}: {
  row: ComponentProps<typeof ThreadFoldRow>['row']
}) => {
  const [expanded, setExpanded] = useState(row.expanded)
  return (
    <ThreadFoldRow
      row={{ ...row, expanded }}
      onToggle={() => setExpanded((value) => !value)}
    />
  )
}

describe('ThreadFoldRow', () => {
  it('keeps focus on the same button when a conversation fold opens', () => {
    render(
      <FoldHarness
        row={{
          kind: 'fold',
          key: 'conversation:parent',
          fold: 'conversation',
          parent,
          hiddenCount: 3,
          expanded: false,
          lineAbove: true,
          lineBelow: false
        }}
      />
    )

    const button = screen.getByTestId('thread-fold-toggle-conversation:parent')
    expect(button).toHaveTextContent('Show 3 more in this conversation')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    button.focus()
    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveTextContent(/^Hide$/)
    expect(button).toHaveAccessibleName('Hide 3 more in this conversation')
    expect(document.activeElement).toBe(button)
  })

  it('names the post whose other replies fold', () => {
    render(
      <FoldHarness
        row={{
          kind: 'fold',
          key: 'others:parent',
          fold: 'others',
          parent,
          hiddenCount: 1,
          expanded: false,
          lineAbove: false,
          lineBelow: false
        }}
      />
    )

    expect(
      screen.getByTestId('thread-fold-toggle-others:parent')
    ).toHaveTextContent('Show 1 other reply to Bob Jones')
  })
})
