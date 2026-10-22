/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileCompactHeader } from './mobile-compact-header'
import { MobileNavigationProvider } from './mobile-navigation-context'

vi.mock('@/lib/components/connection/ConnectionStatus', () => ({
  ConnectionStatusStrip: ({ className }: { className?: string }) => (
    <div data-testid="connection-strip" className={className} />
  )
}))

describe('MobileCompactHeader', () => {
  it.each([
    { className: undefined, flush: false },
    { className: 'mb-0', flush: true }
  ])(
    'gives the offline strip the bar’s spacing, so the pair keeps one gap under the strip ($className)',
    ({ className, flush }) => {
      const { container } = render(
        <MobileNavigationProvider>
          <MobileCompactHeader title="Edit list" className={className} />
        </MobileNavigationProvider>
      )

      const bar = container.querySelector('[data-mobile-compact-header]')
      // While the strip follows, the bar hands its gap to the strip.
      expect(bar).toHaveClass('has-[+[data-connection-strip]]:mb-0')
      const strip = screen.getByTestId('connection-strip')
      expect(strip.previousElementSibling).toBe(bar)
      expect(strip.classList.contains('mb-0')).toBe(flush)
    }
  )

  it('renders nothing without a MobileNavigationProvider', () => {
    const { container } = render(<MobileCompactHeader title="Timeline" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('holds only the menu button and one title — no logo, badge or Back', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Notifications" />
      </MobileNavigationProvider>
    )

    const bar = container.querySelector('[data-mobile-compact-header]')
    expect(bar).toBeInTheDocument()
    const scope = within(bar as HTMLElement)
    expect(scope.getAllByRole('button')).toHaveLength(1)
    expect(
      scope.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    expect(
      scope.getByRole('heading', { level: 1, name: 'Notifications' })
    ).toBeInTheDocument()
    expect(scope.queryByRole('link')).not.toBeInTheDocument()
    expect(scope.queryByRole('img')).not.toBeInTheDocument()
    expect(bar?.textContent).toBe('Notifications')
  })

  it('marks the bottom slot with the attribute the strip offset in globals.css targets', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader
          title="Timeline"
          bottomSlot={<span>3 new posts</span>}
        />
      </MobileNavigationProvider>
    )

    const overlay = container.querySelector('[data-compact-header-overlay]')
    expect(overlay).toHaveTextContent('3 new posts')
    expect(overlay?.parentElement).toHaveAttribute('data-mobile-compact-header')
  })

  it('ends with the actions a page opts into, after the title', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader
          title="Timeline"
          actions={<button type="button">Refresh timeline</button>}
        />
      </MobileNavigationProvider>
    )

    const bar = container.querySelector(
      '[data-mobile-compact-header]'
    ) as HTMLElement
    const buttons = within(bar).getAllByRole('button')
    expect(
      buttons.map(
        (button) => button.getAttribute('aria-label') ?? button.textContent
      )
    ).toEqual(['Open navigation', 'Refresh timeline'])
    expect(bar.lastElementChild).toBe(buttons[1].parentElement)
  })

  it('renders the title as a paragraph when the content keeps the heading', () => {
    render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Lists" as="p" />
      </MobileNavigationProvider>
    )

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('Lists').tagName).toBe('P')
  })

  it('keeps a long string title whole in its title attribute', () => {
    const longTitle = 'Morning running crew and friends from the coastal trail'
    render(
      <MobileNavigationProvider>
        <MobileCompactHeader title={longTitle} />
      </MobileNavigationProvider>
    )

    const heading = screen.getByRole('heading', { name: longTitle })
    expect(heading).toHaveAttribute('title', longTitle)
  })

  it('renders the status strip right after the bar, as its sibling', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Timeline" />
      </MobileNavigationProvider>
    )

    const bar = container.querySelector('[data-mobile-compact-header]')
    const strip = screen.getByTestId('connection-strip')
    expect(bar?.nextElementSibling).toBe(strip)
    expect(bar).not.toContainElement(strip)
  })

  it('renders no strip without a MobileNavigationProvider', () => {
    render(<MobileCompactHeader title="Timeline" />)

    expect(screen.queryByTestId('connection-strip')).not.toBeInTheDocument()
  })
})
