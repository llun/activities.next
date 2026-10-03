/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'

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
  it('is named by its visible label and points at the parent route', () => {
    render(<BackLink href="/lists" label="Back to lists" iconOnlyFrom="md" />)

    const link = screen.getByRole('link', { name: 'Back to lists' })
    expect(link).toHaveAttribute('href', '/lists')
    // The label is a real text node: visible below md, sr-only from md up,
    // so the desktop arrow keeps the same accessible name.
    expect(screen.getByText('Back to lists')).toHaveClass('md:sr-only')
  })

  it('puts the arrow on the content gutter in a 44px row below md', () => {
    render(<BackLink href="/lists" label="Back to lists" iconOnlyFrom="md" />)

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

  it('keeps a longer accessible name that contains the visible label', () => {
    render(
      <BackLink
        href="/admin/accounts"
        label="Back to accounts"
        accessibleName="Back to accounts list"
        iconOnlyFrom="md"
      />
    )

    expect(
      screen.getByRole('link', { name: 'Back to accounts list' })
    ).toHaveTextContent('Back to accounts')
  })

  it('passes prefetch through for per-user profile targets', () => {
    render(
      <BackLink
        href="/@alice@example.com"
        label="Back to profile"
        prefetch={false}
      />
    )

    expect(
      screen.getByRole('link', { name: 'Back to profile' })
    ).toHaveAttribute('data-prefetch', 'false')
  })
})
