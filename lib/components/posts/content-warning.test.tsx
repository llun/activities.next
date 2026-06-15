/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ContentWarning } from './content-warning'

describe('ContentWarning', () => {
  it('hides content until expanded', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <ContentWarning summary="Spoilers">
          <p>Hidden details</p>
        </ContentWarning>
      </div>
    )

    expect(screen.getByText('Spoilers')).toBeInTheDocument()
    expect(screen.queryByText('Hidden details')).not.toBeInTheDocument()

    const showButton = screen.getByRole('button', { name: 'Show content' })
    expect(showButton).toHaveAttribute('aria-expanded', 'false')
    expect(showButton).not.toHaveAttribute('aria-controls')

    fireEvent.click(showButton)

    expect(screen.getByText('Hidden details')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide content' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'Hide content' })
    ).toHaveAttribute('aria-controls')
    expect(onParentClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Hide content' }))

    expect(screen.queryByText('Hidden details')).not.toBeInTheDocument()
  })
})
