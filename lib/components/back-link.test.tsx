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
    // (Label in Name): visible below md, sr-only from md up.
    expect(link).toHaveTextContent(/^Back$/)
    expect(screen.getByText('Back')).toHaveClass('md:sr-only')
  })

  it('puts the arrow on the content gutter in a 44px row below md', () => {
    render(
      <BackLink
        href="/lists"
        accessibleName="Back to lists"
        iconOnlyFrom="md"
      />
    )

    // No negative margin and no horizontal padding: the 16px arrow sits on
    // the 16px content gutter and the label follows after an 8px gap.
    const link = screen.getByRole('link', { name: 'Back to lists' })
    expect(link).toHaveClass(
      'max-md:min-h-11',
      'max-md:gap-2',
      'max-md:text-sm',
      'max-md:font-medium',
      'text-muted-foreground'
    )
    expect(link.className).not.toContain('max-md:-ml-1')
    expect(link.className).not.toContain('max-md:px-1')
    // 16px below md, the desktop 20px from md up.
    expect(link.querySelector('svg')).toHaveClass('size-5', 'max-md:size-4')
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
