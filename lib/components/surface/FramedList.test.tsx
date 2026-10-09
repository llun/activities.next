/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FramedList, FramedListItem } from './FramedList'

describe('FramedList', () => {
  it('is a named list of its rows', () => {
    render(
      <FramedList aria-label="People">
        <FramedListItem>One</FramedListItem>
        <FramedListItem>Two</FramedListItem>
      </FramedList>
    )
    expect(screen.getByRole('list', { name: 'People' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('turns a row with an href into a link', () => {
    render(
      <FramedList>
        <FramedListItem href="/people/1">One</FramedListItem>
      </FramedList>
    )
    expect(screen.getByRole('link', { name: 'One' })).toHaveAttribute(
      'href',
      '/people/1'
    )
  })

  it('renders a footer after the rows', () => {
    render(
      <FramedList footer={<span>Show more</span>}>
        <FramedListItem>One</FramedListItem>
      </FramedList>
    )
    expect(
      screen
        .getByText('One')
        .compareDocumentPosition(screen.getByText('Show more')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
