/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn()
}))

describe('Fitness layout rail', () => {
  it('renders the four rail items', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    render(<Layout>content</Layout>)
    for (const label of ['Overview', 'Files', 'Privacy', 'Strava']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('marks the longest-prefix match as the active page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    render(<Layout>content</Layout>)
    const active = screen
      .getAllByText('Strava')
      .map((node) => node.closest('a'))
      .find((anchor) => anchor?.getAttribute('aria-current') === 'page')
    expect(active).toBeTruthy()
  })

  it('does not mark Overview active on a deeper route', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/privacy')
    render(<Layout>content</Layout>)
    const overview = screen
      .getAllByText('Overview')
      .map((node) => node.closest('a'))
      .find((anchor) => anchor?.getAttribute('aria-current') === 'page')
    expect(overview).toBeFalsy()
  })
})
