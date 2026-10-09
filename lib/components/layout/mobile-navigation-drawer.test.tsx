/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MobileNavigationProvider } from './mobile-navigation-context'
import { MobileNavigationDrawer } from './mobile-navigation-drawer'
import { MobileNavigationTrigger } from './mobile-navigation-trigger'

let mockPathname = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname
}))

const drawerTree = () => (
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

const renderDrawer = () => render(drawerTree())

const openWithFocusedTrigger = () => {
  const trigger = screen.getByRole('button', { name: 'Open navigation' })
  trigger.focus()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  return trigger
}

// Radix restores focus on a timer after the content unmounts; let it run
// before asserting that it did nothing.
const flushFocusRestore = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)))

describe('MobileNavigationDrawer', () => {
  it('renders nothing outside MobileNavigationProvider', () => {
    const { container } = render(
      <MobileNavigationDrawer>{() => <span>Body</span>}</MobileNavigationDrawer>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens as a dialog named "Navigation drawer"', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Navigation drawer')
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

  describe('focus return', () => {
    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
      mockPathname = '/'
    })

    afterEach(() => {
      window.matchMedia = originalMatchMedia
    })

    // The baseline the two cases below depart from.
    it('returns focus to the trigger when Escape closes the drawer', async () => {
      renderDrawer()
      const trigger = openWithFocusedTrigger()

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(trigger).toHaveFocus())
    })

    // From `md` up the trigger is hidden, so focus must not go back to it.
    it('does not return focus once the viewport is md or wider', async () => {
      renderDrawer()
      const trigger = openWithFocusedTrigger()
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(min-width: 768px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      await flushFocusRestore()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).not.toHaveFocus()
    })

    // A route change while open (browser Back, a link outside the drawer)
    // closes it through the provider; the trigger may belong to the old page.
    it('does not return focus after the pathname changes while open', async () => {
      const { rerender } = renderDrawer()
      const trigger = openWithFocusedTrigger()

      mockPathname = '/elsewhere'
      rerender(drawerTree())
      await flushFocusRestore()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).not.toHaveFocus()
    })

    // A destination closes the drawer without focus return; the next opening
    // starts over — on the page it navigated to — so its Escape returns focus
    // again.
    it('returns focus again after a navigation-close and a reopen', async () => {
      const { rerender } = renderDrawer()
      openWithFocusedTrigger()
      fireEvent.click(screen.getByRole('link', { name: 'Somewhere' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await flushFocusRestore()
      mockPathname = '/somewhere'
      rerender(drawerTree())

      const trigger = openWithFocusedTrigger()
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      await waitFor(() => expect(trigger).toHaveFocus())
    })
  })
})
