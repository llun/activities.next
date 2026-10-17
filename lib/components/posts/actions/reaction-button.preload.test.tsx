/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ReactionButton } from '@/lib/components/posts/actions/reaction-button'
import { ReactionState } from '@/lib/components/posts/useReactionState'

const loaded = vi.hoisted(() => ({ count: 0 }))

// The factory runs when the chunk is first imported, so it counts preloads.
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

describe('ReactionButton preload', () => {
  it('loads the picker chunk when the trigger is hovered', async () => {
    render(<ReactionButton state={state} />)
    expect(loaded.count).toBe(0)

    fireEvent.pointerEnter(
      screen.getByRole('button', { name: /^Add reaction/ })
    )
    await waitFor(() => expect(loaded.count).toBe(1))
  })
})
