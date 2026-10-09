/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Frame } from './Frame'

describe('Frame', () => {
  it('renders its children', () => {
    render(
      <Frame>
        <p>Body</p>
      </Frame>
    )
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it.each([{ muted: true }, { divided: true }])(
    'renders its children with %o',
    (props) => {
      render(
        <Frame {...props}>
          <p>One</p>
          <p>Two</p>
        </Frame>
      )
      expect(screen.getByText('One')).toBeInTheDocument()
      expect(screen.getByText('Two')).toBeInTheDocument()
    }
  )

  it('renders the footer after the body', () => {
    render(
      <Frame footer={<span>Footer</span>}>
        <p>Body</p>
      </Frame>
    )
    const footer = screen.getByText('Footer')
    expect(footer).toBeInTheDocument()
    expect(
      screen.getByText('Body').compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders no footer band without a footer', () => {
    const { container } = render(
      <Frame>
        <p>Body</p>
      </Frame>
    )
    expect(container.querySelector('[data-slot="frame-footer"]')).toBeNull()
  })
})
