/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { SwitchedNotice } from './SwitchedNotice'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

describe('SwitchedNotice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is an info Alert naming the profile', () => {
    render(<SwitchedNotice handle="@anna@llun.test" />)

    const alert = screen
      .getByText('Switched to @anna@llun.test.')
      .closest('[data-slot="alert"]')
    expect(alert).toHaveAttribute('data-tone', 'info')
    expect(alert).toHaveTextContent('You’re now posting as this profile.')
  })

  it('drops the query from the address on Dismiss', () => {
    render(<SwitchedNotice handle="@anna@llun.test" />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(replace).toHaveBeenCalledWith('/settings/profile')
  })
})
