/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

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
const NAME = 'Alice Liddell'

describe('Status Header', () => {
  beforeEach(() => {
    mockBack.mockReset()
    resetInAppHistory()
  })

  it('renders the desktop back button and post title', () => {
    render(<Header fallbackHref={FALLBACK} fallbackName={NAME} />)

    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Post' })).toBeInTheDocument()
    expect(screen.getByText('Conversation thread')).toBeInTheDocument()
  })

  it('navigates back through history from the desktop button', () => {
    render(<Header fallbackHref={FALLBACK} fallbackName={NAME} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(mockBack).toHaveBeenCalled()
  })

  it('offers "Back to profile" as a real link to the author on direct entry', () => {
    render(<Header fallbackHref={FALLBACK} fallbackName={NAME} />)

    // Visible "Back to profile"; the accessible name carries the person.
    const link = screen.getByRole('link', {
      name: 'Back to profile, Alice Liddell'
    })
    expect(link).toHaveTextContent(/^Back to profile$/)
    expect(link).toHaveAttribute('href', FALLBACK)
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(
      screen.queryByRole('button', { name: /^Back/ })
    ).not.toBeInTheDocument()
    // The desktop arrow cannot name a destination it does not know.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
  })

  it('offers a history "Back" named after the page the tab came from', () => {
    recordNavigation('/notifications')
    render(<Header fallbackHref={FALLBACK} fallbackName={NAME} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // Two buttons share the name: the mobile row and the desktop arrow.
    const buttons = screen.getAllByRole('button', {
      name: 'Back to Notifications'
    })
    expect(buttons).toHaveLength(2)
    const back = buttons[1]
    expect(back).toHaveTextContent(/^Back$/)

    fireEvent.click(back)
    expect(mockBack).toHaveBeenCalled()
  })

  it.each([
    ['/', 'Back to Timeline', 'Back'],
    ['/tags/running', 'Back to #running', 'Back'],
    [
      '/@bob@example.com',
      'Back to profile, @bob@example.com',
      'Back to profile'
    ],
    ['/somewhere/unknown', 'Back to previous page', 'Back']
  ])('names the history Back after %s', (previous, accessibleName, visible) => {
    recordNavigation(previous)
    render(<Header fallbackHref={FALLBACK} fallbackName={NAME} />)

    const back = screen
      .getAllByRole('button', { name: accessibleName })
      .find((button) => button.classList.contains('md:hidden'))
    expect(back).toHaveTextContent(new RegExp(`^${visible}$`))
  })

  // The server cannot know this tab's history, so it and the hydrating
  // client render the direct-entry link; the history Back replaces it after.
  it('renders the direct-entry link on the server even with client history', () => {
    recordNavigation('/notifications')
    const html = renderToString(
      <Header fallbackHref={FALLBACK} fallbackName={NAME} />
    )

    expect(html).toContain('href="/@alice@example.com"')
    expect(html).toContain('Back to profile')
    expect(html).not.toContain('Back to Notifications')
  })

  it('renders Activity title for fitness dashboard without thread subtitle', () => {
    render(
      <Header isFitnessDashboard fallbackHref={FALLBACK} fallbackName={NAME} />
    )

    expect(
      screen.getByRole('heading', { name: 'Activity' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Conversation thread')).not.toBeInTheDocument()
  })
})
