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

describe('Settings Layout', () => {
  it('marks the most-specific tab as the current page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/account')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(rail).getByRole('link', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })

  it('resolves a nested fitness path to the Fitness tab, not General', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/fitness/privacy')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'Fitness' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    // '/settings' is a prefix of the path but must not win over '/settings/fitness'.
    expect(
      within(rail).getByRole('link', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })

  it('marks General as current on the settings root', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})
