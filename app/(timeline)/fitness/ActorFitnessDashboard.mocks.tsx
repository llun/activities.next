import { AnchorHTMLAttributes, ReactNode } from 'react'

// Kept apart from the testUtils module on purpose: the vi.mock factory loads
// this file, and testUtils imports the component under test, which would make
// the factory wait on a module that is itself waiting on the mocked next/link.
// next/link swallows `prefetch` and `scroll` instead of reflecting them in the
// DOM, so render them ourselves to assert on them.
export const MockLink = ({
  children,
  href,
  prefetch,
  scroll,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  prefetch?: boolean | 'auto' | null
  scroll?: boolean
  children: ReactNode
}) => (
  <a
    href={href}
    data-prefetch={String(prefetch)}
    data-scroll={String(scroll)}
    {...rest}
  >
    {children}
  </a>
)
