/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FramedList, FramedListItem } from './FramedList'

describe('FramedList', () => {
  it('is one frame with hairlines between rows, not separate cards', () => {
    render(
      <FramedList aria-label="People">
        <FramedListItem>One</FramedListItem>
        <FramedListItem>Two</FramedListItem>
      </FramedList>
    )
    const list = screen.getByRole('list', { name: 'People' })
    expect(list).toHaveClass('divide-y')
    expect(list.parentElement).toHaveClass('rounded-lg', 'border')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('pads rows px-4 py-3', () => {
    render(
      <FramedList>
        <FramedListItem>One</FramedListItem>
      </FramedList>
    )
    expect(screen.getByText('One')).toHaveClass('px-4', 'py-3')
  })

  it('turns a row with an href into a link with a hover state', () => {
    render(
      <FramedList>
        <FramedListItem href="/people/1">One</FramedListItem>
      </FramedList>
    )
    const link = screen.getByRole('link', { name: 'One' })
    expect(link).toHaveAttribute('href', '/people/1')
    expect(link).toHaveClass('hover:bg-muted', 'px-4', 'py-3')
  })

  it('renders a footer under the rows', () => {
    render(
      <FramedList footer={<span>Show more</span>}>
        <FramedListItem>One</FramedListItem>
      </FramedList>
    )
    expect(screen.getByText('Show more').parentElement).toHaveClass('border-t')
  })
})
