/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'

import {
  createMockNote,
  mockAlice
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { ActorProfile } from '@/lib/types/domain/actor'

import { preloadInlineStatusComposer } from './lazy-inline-status-composer'
import { Posts } from './posts'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('./lazy-inline-status-composer', () => ({
  InlineStatusComposer: () => null,
  preloadInlineStatusComposer: vi.fn()
}))

const note = createMockNote({
  id: 'https://activities.local/users/alice/statuses/1',
  actor: mockAlice,
  actorId: mockAlice.id,
  text: 'hello'
})

describe('Posts composer preload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // jsdom has no requestIdleCallback; the hook falls back to a timeout.
    vi.stubGlobal('requestIdleCallback', undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('preloads the composer chunk for a signed-in viewer', () => {
    render(
      <Posts
        host="activities.local"
        currentTime={0}
        statuses={[note]}
        currentActor={{ id: mockAlice.id, username: 'alice' } as ActorProfile}
        showActions
      />
    )
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(preloadInlineStatusComposer).toHaveBeenCalledTimes(1)
  })

  it('does not preload it for an anonymous viewer', () => {
    render(<Posts host="activities.local" currentTime={0} statuses={[note]} />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(preloadInlineStatusComposer).not.toHaveBeenCalled()
  })

  it('does not preload it when the feed offers no actions', () => {
    render(
      <Posts
        host="activities.local"
        currentTime={0}
        statuses={[note]}
        currentActor={{ id: mockAlice.id, username: 'alice' } as ActorProfile}
      />
    )
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(preloadInlineStatusComposer).not.toHaveBeenCalled()
  })
})
