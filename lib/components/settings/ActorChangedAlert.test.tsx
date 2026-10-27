/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActorChangedAlert } from './ActorChangedAlert'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}))

describe('ActorChangedAlert', () => {
  it('explains the profile change and reloads the current page', () => {
    render(<ActorChangedAlert />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your active profile changed'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
