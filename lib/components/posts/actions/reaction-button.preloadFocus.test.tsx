/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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

describe('ReactionButton preload on focus', () => {
  it('loads the picker chunk when the trigger takes focus', async () => {
    render(<ReactionButton state={state} />)
    expect(loaded.count).toBe(0)

    fireEvent.focus(screen.getByRole('button', { name: /^Add reaction/ }))
    await waitFor(() => expect(loaded.count).toBe(1))
  })
})
