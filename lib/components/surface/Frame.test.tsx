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

  it('gives the content a scroll margin clear of a sticky footer', () => {
    for (const props of [{ form: true }, { divided: true }, {}]) {
      const { container, unmount } = render(
        <Frame {...props} stickyFooter footer={<span>Footer</span>}>
          <input aria-label="Field" />
        </Frame>
      )
      const content = screen.getByLabelText('Field').parentElement
      expect(content, JSON.stringify(props)).toHaveClass('[&_*]:scroll-mb-24')
      expect(container.firstElementChild).not.toHaveClass('[&_*]:scroll-mb-24')
      unmount()
    }
  })

  it('adds no scroll margin without stickyFooter', () => {
    const { container } = render(
      <Frame form footer={<span>Footer</span>}>
        <p>Body</p>
      </Frame>
    )
    expect(container.innerHTML).not.toContain('scroll-mb-24')
  })

  it('lets a flush Alert at either end of a form meet the frame edge', () => {
    const { container } = render(
      <Frame form>
        <p>Body</p>
      </Frame>
    )
    const content = container.querySelector('[data-slot="frame-content"]')
    expect(content).toHaveClass(
      '[&>[data-slot=alert]:first-child]:-mt-1.5',
      '[&>[data-slot=alert]:last-child]:-mb-1.5'
    )
  })
})
