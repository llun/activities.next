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

describe('Account Layout', () => {
  it('renders the section-level Account header above the dropdown nav', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/account')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Account' })
    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(
      heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Identity, security, and sessions shared across your actors'
      )
    ).toBeInTheDocument()
  })

  it('reflects the General tab on the account root', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/account')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(within(nav).getByRole('button')).toHaveTextContent('General')
  })

  it.each([
    ['/account/security', 'Security'],
    ['/account/sessions', 'Sessions']
  ])('reflects the %s path as the %s tab', (pathname, label) => {
    ;(usePathname as jest.Mock).mockReturnValue(pathname)
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(within(nav).getByRole('button')).toHaveTextContent(label)
  })

  it('resolves /account/verify-email to General, not a deeper tab', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/account/verify-email')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Account' })
    // '/account' is a prefix of the path; no deeper tab matches, so it stays General.
    expect(within(nav).getByRole('button')).toHaveTextContent('General')
  })

  it('renders every account section as a menu item', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/account')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Account' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    for (const label of ['General', 'Security', 'Sessions']) {
      expect(
        within(menu).getByRole('menuitem', { name: label })
      ).toBeInTheDocument()
    }
  })

  // Below md the description's own 16px bottom padding is the whole gap to
  // the dropdown; from md up the section keeps its 16px top padding.
  it('drops the section top padding below md only', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/account')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(nav.parentElement).toHaveClass('pt-4', 'max-md:pt-0')
  })
})
