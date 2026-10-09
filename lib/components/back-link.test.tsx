/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'

import { profileBack } from '@/lib/components/navigation-history/backDestination'

import { BackLink } from './back-link'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

describe('BackLink', () => {
  it('shows "Back" and names the destination for assistive tech', () => {
    render(
      <BackLink
        href="/lists"
        accessibleName="Back to lists"
        iconOnlyFrom="md"
      />
    )

    const link = screen.getByRole('link', { name: 'Back to lists' })
    expect(link).toHaveAttribute('href', '/lists')
    // The visible word is a real text node contained in the accessible name
    // (Label in Name).
    expect(link).toHaveTextContent(/^Back$/)
  })

  it('shows "Back to profile" for a profile and names the person', () => {
    render(
      <BackLink
        href="/@anna@llun.social"
        {...profileBack('Anna Nowak')}
        prefetch={false}
      />
    )

    const link = screen.getByRole('link', {
      name: 'Back to profile, Anna Nowak'
    })
    expect(link).toHaveTextContent(/^Back to profile$/)
    expect(link).toHaveAttribute('data-prefetch', 'false')
  })
})
