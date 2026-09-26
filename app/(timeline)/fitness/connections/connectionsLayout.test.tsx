/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const renderLayout = () =>
  render(
    <Layout>
      <div data-testid="connections-content">Connections Content</div>
    </Layout>
  )

describe('Fitness Connections Layout', () => {
  it.each([
    ['/fitness/connections', 'Strava'],
    ['/fitness/connections/strava', 'Strava'],
    ['/fitness/connections/wahoo', 'Wahoo']
  ])(
    'reflects the active connection in the dropdown trigger on %s',
    (path, label) => {
      ;(usePathname as jest.Mock).mockReturnValue(path)
      renderLayout()

      const nav = screen.getByRole('navigation', { name: 'Connections' })
      expect(within(nav).getByRole('button')).toHaveTextContent(label)
    }
  )

  it('renders the Connections header and description above the sub-nav', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/connections/strava')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Connections' })
    const nav = screen.getByRole('navigation', { name: 'Connections' })

    expect(
      heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Connect third-party fitness platforms to sync activities'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('connections-content')).toBeInTheDocument()
  })

  it('renders Strava and Wahoo as menu items when the dropdown is opened', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/connections/strava')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Connections' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    for (const label of ['Strava', 'Wahoo']) {
      expect(
        within(menu).getByRole('menuitem', { name: label })
      ).toBeInTheDocument()
    }
  })

  it('marks the active connection as current in the opened dropdown', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/connections/wahoo')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Connections' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    const active = within(menu).getByRole('menuitem', { name: 'Wahoo' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active).toHaveAttribute('href', '/fitness/connections/wahoo')
    expect(
      within(menu).getByRole('menuitem', { name: 'Strava' })
    ).not.toHaveAttribute('aria-current')
  })
})
