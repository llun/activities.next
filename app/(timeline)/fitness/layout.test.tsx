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
})
