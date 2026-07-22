/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'

import { InlineStatusComposer } from './inline-status-composer'

interface ReplyBoxStubProps {
  onPostCreated: (status: { id: string }, attachments: unknown[]) => void
  onCancel: () => void
}

interface PostBoxStubProps {
  quotedStatus?: unknown
  editStatus?: unknown
  onPostCreated: (status: { id: string }, attachments: unknown[]) => void
  onPostUpdated: (status: { id: string }) => void
}

vi.mock('./status-reply-box', () => ({
  StatusReplyBox: ({ onPostCreated, onCancel }: ReplyBoxStubProps) => (
    <div data-testid="reply-box">
      <button onClick={() => onPostCreated({ id: 'reply-1' }, [])}>
        reply-create
      </button>
      <button onClick={onCancel}>reply-cancel</button>
    </div>
  )
}))

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: ({
    quotedStatus,
    editStatus,
    onPostCreated,
    onPostUpdated
  }: PostBoxStubProps) => (
    <div
      data-testid="post-box"
      data-mode={editStatus ? 'edit' : quotedStatus ? 'quote' : 'new'}
    >
      <button onClick={() => onPostCreated({ id: 'quote-1' }, [])}>
        pb-create
      </button>
      <button onClick={() => onPostUpdated({ id: 'edit-1' })}>pb-update</button>
    </div>
  )
}))

const profile = {
  id: 'actor-1',
  username: 'llun',
  name: 'Llun'
} as unknown as ActorProfile
const status = { id: 'status-1', actorId: 'actor-1' } as unknown as StatusNote

describe('InlineStatusComposer', () => {
  it('renders the compact reply box in reply mode', () => {
    render(
      <InlineStatusComposer
        host="activities.local"
        profile={profile}
        mode="reply"
        status={status}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('reply-box')).toBeInTheDocument()
    expect(screen.queryByTestId('post-box')).not.toBeInTheDocument()
  })

  it.each([
    { description: 'quote', mode: 'quote' as const },
    { description: 'edit', mode: 'edit' as const }
  ])('renders the full composer in $description mode', ({ mode }) => {
    render(
      <InlineStatusComposer
        host="activities.local"
        profile={profile}
        mode={mode}
        status={status}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('post-box')).toHaveAttribute('data-mode', mode)
    expect(screen.queryByTestId('reply-box')).not.toBeInTheDocument()
  })

  it('bubbles a created reply then closes', () => {
    const onCreated = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineStatusComposer
        host="activities.local"
        profile={profile}
        mode="reply"
        status={status}
        onCancel={onCancel}
        onCreated={onCreated}
      />
    )

    fireEvent.click(screen.getByText('reply-create'))
    expect(onCreated).toHaveBeenCalledWith({ id: 'reply-1' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('bubbles a created quote then closes', () => {
    const onCreated = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineStatusComposer
        host="activities.local"
        profile={profile}
        mode="quote"
        status={status}
        onCancel={onCancel}
        onCreated={onCreated}
      />
    )

    fireEvent.click(screen.getByText('pb-create'))
    expect(onCreated).toHaveBeenCalledWith({ id: 'quote-1' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('bubbles an updated status then closes', () => {
    const onUpdated = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineStatusComposer
        host="activities.local"
        profile={profile}
        mode="edit"
        status={status}
        onCancel={onCancel}
        onUpdated={onUpdated}
      />
    )

    fireEvent.click(screen.getByText('pb-update'))
    expect(onUpdated).toHaveBeenCalledWith({ id: 'edit-1' })
    expect(onCancel).toHaveBeenCalled()
  })
})
