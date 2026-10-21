/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { DraftRecord } from '@/lib/client/drafts'

import { DraftEditor } from './DraftEditor'
import { draftRecord, profile, targetStatus } from './draftFixtures.testUtils'

interface ComposerProps {
  draft?: DraftRecord
  quotedStatus?: unknown
  replyStatus?: unknown
  onCancel?: () => void
  onPostCreated?: () => void
  onDiscardQuote?: () => void
}

const postBox = vi.hoisted(() => vi.fn())
const replyBox = vi.hoisted(() => vi.fn())

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: (props: ComposerProps) => {
    postBox(props)
    return (
      <div data-testid="post-box">
        <button onClick={props.onPostCreated}>post created</button>
        <button onClick={props.onDiscardQuote}>discard quote</button>
      </div>
    )
  }
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: (props: ComposerProps) => {
    replyBox(props)
    return (
      <div data-testid="reply-box">
        <button onClick={props.onCancel}>cancel reply</button>
        <button onClick={props.onPostCreated}>reply created</button>
      </div>
    )
  }
}))

const renderEditor = (draft: DraftRecord, onClose = vi.fn()) => {
  render(
    <DraftEditor
      draft={draft}
      host="llun.test"
      profile={profile}
      isMediaUploadEnabled
      onClose={onClose}
    />
  )
  return onClose
}

describe('DraftEditor', () => {
  afterEach(() => vi.clearAllMocks())

  it('opens a post draft in PostBox with the draft and its quote', () => {
    const quoteOf = targetStatus('bob', 'other.example')
    const draft = draftRecord({ quoteOf })
    renderEditor(draft)

    expect(screen.getByTestId('post-box')).toBeInTheDocument()
    expect(screen.queryByTestId('reply-box')).not.toBeInTheDocument()
    expect(postBox).toHaveBeenCalledWith(
      expect.objectContaining({ draft, quotedStatus: quoteOf })
    )
  })

  it('opens a reply draft in StatusReplyBox with the draft and its target', () => {
    const replyTo = targetStatus('alice', 'remote.example')
    const draft = draftRecord({ composer: 'reply-box', replyTo })
    renderEditor(draft)

    expect(screen.getByTestId('reply-box')).toBeInTheDocument()
    expect(screen.queryByTestId('post-box')).not.toBeInTheDocument()
    expect(replyBox).toHaveBeenCalledWith(
      expect.objectContaining({ draft, replyStatus: replyTo })
    )
  })

  it('falls back to PostBox for a reply draft that lost its target', () => {
    renderEditor(draftRecord({ composer: 'reply-box' }))

    expect(screen.getByTestId('post-box')).toBeInTheDocument()
  })

  it('collapses on Close, on a sent post, on a closed quote and on a cancelled or sent reply', () => {
    const onClose = renderEditor(draftRecord())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByText('post created'))
    fireEvent.click(screen.getByText('discard quote'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('collapses when a reply is cancelled or sent', () => {
    const onClose = renderEditor(
      draftRecord({
        composer: 'reply-box',
        replyTo: targetStatus('alice', 'remote.example')
      })
    )
    fireEvent.click(screen.getByText('cancel reply'))
    fireEvent.click(screen.getByText('reply created'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
