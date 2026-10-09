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
})
