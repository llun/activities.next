/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FormGroup } from './FormGroup'

describe('FormGroup', () => {
  it('names its rows by the heading, as a group', () => {
    render(
      <FormGroup title="Privacy">
        <p>Row</p>
      </FormGroup>
    )
    const group = screen.getByRole('group', { name: 'Privacy' })
    expect(group).toContainElement(screen.getByText('Row'))
    expect(
      screen.getByRole('heading', { level: 2, name: 'Privacy' })
    ).toHaveClass('text-base', 'font-semibold')
  })

  it('sets the heading block off from the rows above', () => {
    render(
      <FormGroup title="Privacy">
        <p>Row</p>
      </FormGroup>
    )
    expect(screen.getByRole('heading').parentElement).toHaveClass(
      'px-4',
      'pt-5',
      'pb-0.5',
      'group-first/form-group:pt-2.5'
    )
  })

  it('draws the description muted under the heading', () => {
    render(
      <FormGroup title="Profile" description="Shown on your profile.">
        <p>Row</p>
      </FormGroup>
    )
    expect(screen.getByText('Shown on your profile.')).toHaveClass(
      'text-sm',
      'text-muted-foreground'
    )
  })

  it('takes a heading level', () => {
    render(
      <FormGroup title="Profile" headingLevel={3}>
        <p>Row</p>
      </FormGroup>
    )
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })
})
