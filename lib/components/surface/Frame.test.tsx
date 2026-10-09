/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Frame } from './Frame'

describe('Frame', () => {
  it('is a flat bordered surface with no shadow', () => {
    render(
      <Frame>
        <p>Body</p>
      </Frame>
    )
    const frame = screen.getByText('Body').parentElement as HTMLElement
    expect(frame).toHaveClass('rounded-lg', 'border', 'bg-background')
    expect(frame.className).not.toMatch(/shadow/)
  })

  it('tints the muted variant', () => {
    render(
      <Frame muted>
        <p>Body</p>
      </Frame>
    )
    const frame = screen.getByText('Body').parentElement as HTMLElement
    expect(frame).toHaveClass('bg-muted/40')
    expect(frame).not.toHaveClass('bg-background')
  })

  it('draws hairlines between the children when divided', () => {
    render(
      <Frame divided>
        <p>One</p>
        <p>Two</p>
      </Frame>
    )
    expect(screen.getByText('One').parentElement).toHaveClass('divide-y')
    expect(screen.getByText('Two').parentElement).toBe(
      screen.getByText('One').parentElement
    )
  })

  it('sets the footer off with a top border', () => {
    render(
      <Frame footer={<span>Footer</span>}>
        <p>Body</p>
      </Frame>
    )
    expect(screen.getByText('Footer').parentElement).toHaveClass('border-t')
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
