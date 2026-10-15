/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import type { Status } from '@/lib/types/domain/status'

import {
  ActivityReplies,
  type ActivityRepliesProps,
  REPLIES_EXPANDED_STORAGE_KEY
} from './ActivityReplies'

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

const POST_ID = 'https://activities.local/users/athlete/statuses/ride'

const buildReply = (id: string) =>
  ({
    id,
    type: 'Note',
    actorId: 'https://activities.local/users/friend',
    reply: POST_ID
  }) as unknown as Status

const composer = {
  active: null,
  openReply: vi.fn(),
  openQuote: vi.fn(),
  openEdit: vi.fn(),
  close: vi.fn()
} as unknown as InlineComposerControls

const props: ActivityRepliesProps = {
  host: 'activities.local',
  currentActor: null,
  currentTime: Date.now(),
  status: { id: POST_ID, type: 'Note' } as unknown as Status,
  replies: [buildReply('reply-1')],
  composer,
  onShowAttachment: vi.fn()
}

describe('ActivityReplies', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders open on the server and applies a stored "hide" after hydrating', async () => {
    window.localStorage.setItem(REPLIES_EXPANDED_STORAGE_KEY, '0')

    // The server has no storage, so its markup is always the open list…
    const container = document.createElement('div')
    container.innerHTML = renderToString(<ActivityReplies {...props} />)
    document.body.appendChild(container)
    expect(
      container
        .querySelector('button[aria-expanded]')
        ?.getAttribute('aria-expanded')
    ).toBe('true')

    // …which hydrates without a mismatch, then follows the stored choice.
    const onRecoverableError = vi.fn()
    await act(async () => {
      render(<ActivityReplies {...props} />, {
        container,
        hydrate: true,
        onRecoverableError
      })
    })
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /Replies \(1\)/ })
    ).toHaveAttribute('aria-expanded', 'false')
    container.remove()
  })

  it.each([
    { stored: '1', expanded: 'true' },
    { stored: 'something else', expanded: 'true' }
  ])('stays open for a stored "$stored"', async ({ stored, expanded }) => {
    window.localStorage.setItem(REPLIES_EXPANDED_STORAGE_KEY, stored)
    await act(async () => {
      render(<ActivityReplies {...props} />)
    })
    expect(
      screen.getByRole('button', { name: /Replies \(1\)/ })
    ).toHaveAttribute('aria-expanded', expanded)
  })
})
