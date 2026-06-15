/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Activity, Files, Globe, Lock } from 'lucide-react'
import { usePathname } from 'next/navigation'

import {
  SectionNavDropdown,
  type SectionNavTab
} from '@/lib/components/section-nav-dropdown'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const tabs: SectionNavTab[] = [
  { name: 'Overview', url: '/fitness', icon: Activity },
  { name: 'Files', url: '/fitness/files', icon: Files },
  { name: 'Privacy', url: '/fitness/privacy', icon: Lock },
  { name: 'Strava', url: '/fitness/strava', icon: Globe }
]

const renderDropdown = () =>
  render(<SectionNavDropdown label="Fitness" tabs={tabs} />)

describe('SectionNavDropdown', () => {
  it('labels the nav landmark and reflects the active tab in the trigger', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderDropdown()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Overview')
  })

  it('resolves the most-specific tab, not a shorter prefix', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/files/abc123')
    renderDropdown()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    // '/fitness' (Overview) is a prefix but must not win over '/fitness/files'.
    expect(within(nav).getByRole('button')).toHaveTextContent('Files')
  })

  it('falls back to the first tab when the path matches nothing', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/somewhere/else')
    renderDropdown()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Overview')
  })

  // Open the Radix menu via keyboard (jsdom has no pointer layout), then scope
  // assertions to the open menu.
  it('lists every tab as a menu item and marks the active one current', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    renderDropdown()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    for (const tab of tabs) {
      const item = within(menu).getByRole('menuitem', { name: tab.name })
      expect(item).toBeInTheDocument()
      // Guard against a tab URL regression going undetected.
      expect(item).toHaveAttribute('href', tab.url)
    }
    expect(
      within(menu).getByRole('menuitem', { name: 'Strava' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(menu).getByRole('menuitem', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
  })
})
