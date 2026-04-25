/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ContentWarning } from './content-warning'

describe('ContentWarning', () => {
  it('hides content until expanded', () => {
    render(
      <ContentWarning summary="Spoilers">
        <p>Hidden details</p>
      </ContentWarning>
    )

    expect(screen.getByText('Spoilers')).toBeInTheDocument()
    expect(screen.queryByText('Hidden details')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    expect(screen.getByText('Hidden details')).toBeInTheDocument()
  })
})
