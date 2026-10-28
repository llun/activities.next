/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActorChangedAlert } from './ActorChangedAlert'

const originalLocation = window.location

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() }
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation
  })
})

describe('ActorChangedAlert', () => {
  it('explains the profile change and reloads the whole page', () => {
    render(<ActorChangedAlert />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your active profile changed'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    // A full reload, not router.refresh(): the client sections keep their
    // state across a refresh, so the alert would stay up and the forms would
    // keep editing the previous profile.
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })
})
