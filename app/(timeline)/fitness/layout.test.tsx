/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn()
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

  // Open the Radix menu the same way the rest of the suite does (keyboard, since
  // jsdom has no pointer layout), then assert the items the rail used to expose.
  it('renders every section as a menu item when the dropdown is opened', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderLayout()

    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' })

    expect(
      await screen.findByRole('menuitem', { name: 'Overview' })
    ).toBeInTheDocument()
    for (const label of ['Files', 'Privacy', 'Strava']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
  })

  it('marks the active section as current in the opened dropdown', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    renderLayout()

    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' })

    expect(
      await screen.findByRole('menuitem', { name: 'Strava' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('menuitem', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
  })
})
