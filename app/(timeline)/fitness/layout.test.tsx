/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
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
  it('renders the four rail items', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Fitness' })
    for (const label of ['Overview', 'Files', 'Privacy', 'Strava']) {
      expect(within(rail).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('marks the Strava link as current on /fitness/strava and Overview as not current', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/strava')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(rail).getByRole('link', { name: 'Strava' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(rail).getByRole('link', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
  })

  it('marks the Privacy link as current on /fitness/privacy and Overview as not current', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/fitness/privacy')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(rail).getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(rail).getByRole('link', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
  })
})
