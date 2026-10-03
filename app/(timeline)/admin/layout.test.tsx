/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

describe('Admin Layout', () => {
  // Below md the description's own 16px bottom padding is the whole gap to
  // the dropdown; from md up the section keeps its 16px top padding.
  it('drops the section top padding below md only', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/admin')
    render(
      <Layout>
        <div>content</div>
      </Layout>
    )

    const nav = screen.getByRole('navigation', { name: 'Admin' })
    expect(nav.parentElement).toHaveClass('pt-4', 'max-md:pt-0')
  })
})
