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

  it('divides its children only when divided', () => {
    const { container } = render(
      <Frame divided>
        <p>One</p>
      </Frame>
    )
    expect(container.querySelector('.divide-y')).not.toBeNull()
  })

  it('spaces form rows with py-1.5 and no rules when form', () => {
    const { container } = render(
      <Frame form>
        <p>One</p>
        <p>Two</p>
      </Frame>
    )
    expect(container.querySelector('.py-1\\.5')).not.toBeNull()
    expect(container.querySelector('.divide-y')).toBeNull()
  })

  it('lets form win over divided', () => {
    const { container } = render(
      <Frame form divided>
        <p>One</p>
      </Frame>
    )
    expect(container.querySelector('.divide-y')).toBeNull()
    expect(container.querySelector('.py-1\\.5')).not.toBeNull()
  })

  it('keeps a plain footer in the flow', () => {
    render(
      <Frame footer={<span>Footer</span>}>
        <p>Body</p>
      </Frame>
    )
    const band = screen.getByText('Footer').parentElement
    expect(band).toHaveClass('border-t', 'px-4', 'py-3')
    expect(band).not.toHaveClass('sticky')
  })

  it('sticks the footer to the bottom, above the safe area, with stickyFooter', () => {
    render(
      <Frame form stickyFooter footer={<span>Footer</span>}>
        <p>Body</p>
      </Frame>
    )
    expect(screen.getByText('Footer').parentElement).toHaveClass(
      'sticky',
      'bottom-0',
      'z-10',
      'rounded-b-lg',
      'bg-background',
      'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
    )
  })
})
