/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import { MobileNav } from '@/lib/components/layout/mobile-nav'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn()
}))

describe('MobileNav', () => {
  beforeEach(() => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
  })

  it('keeps extra navigation items accessible from the overflow menu', async () => {
    render(<MobileNav fitnessUrl="/@llun@llun.test/fitness" isAdmin />)

    const nav = screen.getByRole('navigation')
    expect(
      within(nav).getByRole('link', { name: /timeline/i })
    ).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: /search/i })).toHaveAttribute(
      'href',
      '/search'
    )
    expect(
      within(nav).getByRole('link', { name: /messages/i })
    ).toHaveAttribute('href', '/messages')
    expect(
      within(nav).getByRole('link', { name: /notifications/i })
    ).toHaveAttribute('href', '/notifications')
    expect(
      within(nav).queryByRole('link', { name: /bookmarks/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /fitness/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /admin/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /settings/i })
    ).not.toBeInTheDocument()

    fireEvent.keyDown(
      within(nav).getByRole('button', { name: 'More navigation' }),
      { key: 'ArrowDown' }
    )

    expect(
      await screen.findByRole('menuitem', { name: /bookmarks/i })
    ).toHaveAttribute('href', '/bookmarks')
    expect(screen.getByRole('menuitem', { name: /fitness/i })).toHaveAttribute(
      'href',
      '/@llun@llun.test/fitness'
    )
    expect(screen.getByRole('menuitem', { name: /admin/i })).toHaveAttribute(
      'href',
      '/admin'
    )
    expect(screen.getByRole('menuitem', { name: /settings/i })).toHaveAttribute(
      'href',
      '/settings'
    )
  })
})
