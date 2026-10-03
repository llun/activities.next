/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
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

  it('renders the desktop back button and post title, and no menu button', () => {
    render(
      <MobileNavigationProvider>
        <Header fallbackHref={FALLBACK} />
      </MobileNavigationProvider>
    )

    expect(
      screen.queryByRole('button', { name: 'Open navigation' })
    ).not.toBeInTheDocument()
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

  it('offers "Back to profile" as a real link to the author on direct entry', () => {
    render(<Header fallbackHref={FALLBACK} />)

    const link = screen.getByRole('link', { name: 'Back to profile' })
    expect(link).toHaveAttribute('href', FALLBACK)
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(link).toHaveClass('md:hidden')
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
    expect(back).toHaveClass('md:hidden')

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
