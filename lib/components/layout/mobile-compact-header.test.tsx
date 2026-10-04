/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileCompactHeader } from './mobile-compact-header'
import { MobileNavigationProvider } from './mobile-navigation-context'

describe('MobileCompactHeader', () => {
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
    expect(buttons[1].parentElement).toHaveClass('shrink-0')
    expect(bar.lastElementChild).toBe(buttons[1].parentElement)
  })

  it('is a 56px sticky bar hidden from md up', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Timeline" />
      </MobileNavigationProvider>
    )

    expect(container.querySelector('[data-mobile-compact-header]')).toHaveClass(
      'sticky',
      'top-0',
      'h-[55px]',
      'border-b',
      'box-content',
      'bg-surface-chrome',
      'md:hidden'
    )
  })

  it('stacks above page content and pads below the notch', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Timeline" />
      </MobileNavigationProvider>
    )

    // z-30 keeps the bar over positioned post media and cards (a z-0 bar
    // paints under them); `safe-area-pt` keeps it from sitting under the
    // notch, and the translucent surface needs its blur to stay legible.
    expect(container.querySelector('[data-mobile-compact-header]')).toHaveClass(
      'z-30',
      'safe-area-pt',
      'backdrop-blur'
    )
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

  it('puts the menu button at x=8 and sets the title at 18/28 semibold', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <MobileCompactHeader title="Timeline" />
      </MobileNavigationProvider>
    )

    // 8px bar padding and no negative margin on the 44px trigger put its
    // 20px icon at x=20 and, after the 8px gap, the title at x=60.
    const bar = container.querySelector('[data-mobile-compact-header]')
    expect(bar).toHaveClass('pl-2', 'gap-2')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    // Any margin, negative or not, with or without a variant prefix.
    expect(trigger.className).not.toMatch(/(^|[\s:])-?m[a-z]?-/)
    expect(screen.getByRole('heading', { name: 'Timeline' })).toHaveClass(
      'text-lg',
      'font-semibold',
      'truncate'
    )
    expect(screen.getByRole('heading', { name: 'Timeline' })).not.toHaveClass(
      'text-base'
    )
    expect(screen.getByRole('heading', { name: 'Timeline' })).not.toHaveClass(
      'tracking-tight'
    )
  })

  it('keeps a long string title whole in its title attribute while it truncates', () => {
    const longTitle = 'Morning running crew and friends from the coastal trail'
    render(
      <MobileNavigationProvider>
        <MobileCompactHeader title={longTitle} />
      </MobileNavigationProvider>
    )

    const heading = screen.getByRole('heading', { name: longTitle })
    expect(heading).toHaveClass('truncate')
    expect(heading).toHaveAttribute('title', longTitle)
  })

  it('hangs the bottom slot below the bar without taking space', () => {
    render(
      <MobileNavigationProvider>
        <MobileCompactHeader
          title="Timeline"
          bottomSlot={<button type="button">3 new posts</button>}
        />
      </MobileNavigationProvider>
    )

    const overlay = screen.getByRole('button', {
      name: '3 new posts'
    }).parentElement
    expect(overlay).toHaveClass('pointer-events-none', 'absolute', 'top-full')
  })
})
