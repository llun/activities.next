/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from './mobile-navigation-context'
import { MobileNavigationDrawer } from './mobile-navigation-drawer'
import { MobileNavigationTrigger } from './mobile-navigation-trigger'

vi.mock('next/navigation', () => ({
  usePathname: () => '/'
}))

const renderDrawer = () =>
  render(
    <MobileNavigationProvider>
      <MobileNavigationTrigger />
      <MobileNavigationDrawer>
        {(onNavigate) => (
          <a href="/somewhere" onClick={onNavigate}>
            Somewhere
          </a>
        )}
      </MobileNavigationDrawer>
    </MobileNavigationProvider>
  )

describe('MobileNavigationDrawer', () => {
  it('renders nothing outside MobileNavigationProvider', () => {
    const { container } = render(
      <MobileNavigationDrawer>{() => <span>Body</span>}</MobileNavigationDrawer>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens as a left panel no wider than min(320px, 100vw - 48px)', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass(
      'left-0',
      'z-50',
      'w-[min(320px,calc(100vw-48px))]'
    )
    expect(dialog).toHaveAccessibleName('Navigation drawer')
  })

  it('closes from the close button', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a tap outside the panel', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Radix arms its outside-pointer listener on a timer after opening.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' })
    fireEvent.click(document.body)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes when the body calls onNavigate', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(screen.getByRole('link', { name: 'Somewhere' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
