/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import {
  PROFILE_SAVED_TOAST_DURATION_MS,
  ProfileSavedToast
} from './ProfileSavedToast'

describe('ProfileSavedToast', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('says the profile was saved and when servers will show it', () => {
    render(<ProfileSavedToast id={1} onDismiss={vi.fn()} />)

    expect(screen.getByText('Profile saved')).toBeVisible()
    expect(
      screen.getByText(
        'Servers that follow you will show the change within a few minutes.'
      )
    ).toBeVisible()
  })

  it('has no live region of its own', () => {
    render(<ProfileSavedToast id={1} onDismiss={vi.fn()} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dismisses itself after its duration, not a moment before', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<ProfileSavedToast id={1} onDismiss={onDismiss} />)

    act(() => vi.advanceTimersByTime(PROFILE_SAVED_TOAST_DURATION_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while the pointer is on it', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<ProfileSavedToast id={1} onDismiss={onDismiss} />)
    const toast = screen.getByTestId('profile-saved-toast')

    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(PROFILE_SAVED_TOAST_DURATION_MS * 2))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(toast)
    act(() => vi.advanceTimersByTime(PROFILE_SAVED_TOAST_DURATION_MS))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('starts the wait again for a new id', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(
      <ProfileSavedToast id={1} onDismiss={onDismiss} />
    )

    act(() => vi.advanceTimersByTime(PROFILE_SAVED_TOAST_DURATION_MS - 1))
    rerender(<ProfileSavedToast id={2} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(PROFILE_SAVED_TOAST_DURATION_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses from its button', () => {
    const onDismiss = vi.fn()
    render(<ProfileSavedToast id={1} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
