/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { LogoutButton } from './LogoutButton'

describe('LogoutButton', () => {
  it('is described by the hint of the row it sits in', () => {
    render(
      <>
        <p id="hint">You can sign in again at any time.</p>
        <LogoutButton describedBy="hint" />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Sign out' })
    ).toHaveAccessibleDescription('You can sign in again at any time.')
  })

  it('is labelled by the label of the row it sits in', () => {
    render(
      <>
        <span id="label">Sign out of this device</span>
        <LogoutButton labelledBy="label" />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Sign out of this device' })
    ).toHaveAttribute('aria-labelledby', 'label')
  })

  it('opens the SignOutDialog when clicked', async () => {
    render(<LogoutButton />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Sign out?')
  })
})
