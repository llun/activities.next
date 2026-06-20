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
      <div>content</div>
    </Layout>
  )

describe('Fitness Layout', () => {
  it('shows the dropdown sub-navigation reflecting the Overview tab on /fitness', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Overview')
  })

  it('reflects the Heatmap tab in the dropdown trigger on /fitness/heatmap', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/heatmap')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    // '/fitness' (Overview) is a prefix of the path but must not win over
    // '/fitness/heatmap'.
    expect(within(nav).getByRole('button')).toHaveTextContent('Heatmap')
  })

  it('reflects the Strava tab in the dropdown trigger on /fitness/strava', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Strava')
  })

  it('reflects the Privacy tab in the dropdown trigger on /fitness/privacy', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/privacy')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Privacy')
  })

  it('resolves a nested files path to the Files tab, not Overview', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/files/abc123')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    // '/fitness' (Overview) is a prefix of the path but must not win over
    // '/fitness/files'.
    expect(within(nav).getByRole('button')).toHaveTextContent('Files')
  })

  // Open the Radix menu the same way the rest of the suite does (keyboard, since
  // jsdom has no pointer layout), then assert the items the rail used to expose.
  // Scope to the open menu so the test fails loudly if items ever render outside
  // an opened dropdown.
  it('renders the section-level Fitness header above the dropdown nav', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Fitness' })
    const nav = screen.getByRole('navigation', { name: 'Fitness' })

    // The shared "Fitness" header must precede the dropdown nav so the section
    // leads with the same full-width chrome the other top-level routes use.
    expect(
      heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText('Your training activity and settings')
    ).toBeInTheDocument()
  })

  it('renders every section as a menu item when the dropdown is opened', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    for (const label of ['Overview', 'Heatmap', 'Files', 'Privacy', 'Strava']) {
      expect(
        within(menu).getByRole('menuitem', { name: label })
      ).toBeInTheDocument()
    }
  })

  it('marks the active section as current in the opened dropdown', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    const active = within(menu).getByRole('menuitem', { name: 'Strava' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active).toHaveAttribute('href', '/fitness/strava')
    expect(
      within(menu).getByRole('menuitem', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
  })
})
