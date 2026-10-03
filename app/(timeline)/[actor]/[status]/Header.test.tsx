/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'

import {
  recordNavigation,
  resetInAppHistory
} from '@/lib/components/navigation-history/inAppHistory'

import { Header } from './Header'

const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack
  }),
  usePathname: () => '/@alice@example.com/status-123'
}))

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

const FALLBACK = '/@alice@example.com'

describe('Status Header', () => {
  beforeEach(() => {
    mockBack.mockReset()
    resetInAppHistory()
  })

  it('renders the desktop back button and post title', () => {
    render(<Header fallbackHref={FALLBACK} />)

    expect(screen.getByRole('button', { name: 'Go back' })).toHaveClass(
      'max-md:hidden'
    )
    const heading = screen.getByRole('heading', { name: 'Post' })
    expect(heading.parentElement).toHaveClass('max-md:hidden')
    expect(screen.getByText('Conversation thread')).toBeInTheDocument()
  })

  it('navigates back through history from the desktop button', () => {
    render(<Header fallbackHref={FALLBACK} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(mockBack).toHaveBeenCalled()
  })

  it('lays the mobile Back row on the 16px content gutter', () => {
    const { container } = render(<Header fallbackHref={FALLBACK} />)

    // The row's own 16px padding is the whole gutter: the arrow lines up
    // with the post card's avatar below it.
    expect(container.firstElementChild).toHaveClass('max-md:px-4')
    expect(container.firstElementChild).not.toHaveClass('max-md:px-3')
  })

  it('offers "Back to profile" as a real link to the author on direct entry', () => {
    render(<Header fallbackHref={FALLBACK} />)

    const link = screen.getByRole('link', { name: 'Back to profile' })
    expect(link).toHaveAttribute('href', FALLBACK)
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(link).toHaveClass('md:hidden')
    // Same row geometry as the history Back: no negative margin, 16px arrow.
    expect(link.className).not.toContain('max-md:-ml-1')
    expect(link.querySelector('svg')).toHaveClass('max-md:size-4')
    expect(
      screen.queryByRole('button', { name: 'Back' })
    ).not.toBeInTheDocument()
  })

  it('offers a history "Back" when the tab arrived from a page in the app', () => {
    recordNavigation('/notifications')
    render(<Header fallbackHref={FALLBACK} />)

    expect(
      screen.queryByRole('link', { name: 'Back to profile' })
    ).not.toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back).toHaveClass(
      'md:hidden',
      'max-md:min-h-11',
      'max-md:gap-2',
      'max-md:text-sm',
      'max-md:font-medium',
      'text-muted-foreground'
    )
    // The arrow sits on the 16px content gutter: 16px icon, no negative
    // margin or horizontal padding on the row.
    expect(back.className).not.toContain('max-md:-ml-1')
    expect(back.className).not.toContain('max-md:px-1')
    expect(back.querySelector('svg')).toHaveClass('size-4')

    fireEvent.click(back)
    expect(mockBack).toHaveBeenCalled()
  })

  it('renders Activity title for fitness dashboard without thread subtitle', () => {
    render(<Header isFitnessDashboard fallbackHref={FALLBACK} />)

    expect(
      screen.getByRole('heading', { name: 'Activity' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Conversation thread')).not.toBeInTheDocument()
  })
})
