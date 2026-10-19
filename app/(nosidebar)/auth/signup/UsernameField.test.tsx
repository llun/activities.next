/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { UsernameField } from './UsernameField'

describe('UsernameField', () => {
  it('previews the handle the server creates', () => {
    render(<UsernameField domain="run.example" />)
    expect(screen.getByText('@name@run.example')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: ' Ana ' }
    })
    expect(screen.getByText('@ana@run.example')).toBeInTheDocument()
    // A leading @ is refused, not stripped, so it is not hidden here.
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: '@ana' }
    })
    expect(screen.getByText('@@ana@run.example')).toBeInTheDocument()
  })
})
