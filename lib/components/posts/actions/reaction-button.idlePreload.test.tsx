/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'

import { ReactionButton } from '@/lib/components/posts/actions/reaction-button'
import { ReactionState } from '@/lib/components/posts/useReactionState'

const loaded = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/lib/components/posts/reaction-picker', () => {
  loaded.count += 1
  return { ReactionPicker: () => null }
})

const state = {
  isPicking: false,
  setIsPicking: vi.fn(),
  focusTrigger: vi.fn(),
  pendingName: null,
  total: 0,
  mine: false,
  error: null,
  triggerRef: { current: null }
} as unknown as ReactionState

describe('ReactionButton idle preload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads the picker chunk at idle without any hover', async () => {
    render(<ReactionButton state={state} />)
    expect(loaded.count).toBe(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(loaded.count).toBe(1)
  })
})
