/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import { Header } from './Header'

const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack
  }),
  usePathname: () => '/@alice/status-123'
}))

describe('Status Header', () => {
  beforeEach(() => {
    mockBack.mockClear()
  })

  it('renders mobile navigation trigger and post title', () => {
    render(
      <MobileNavigationProvider>
        <Header />
      </MobileNavigationProvider>
    )

    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Post' })).toBeInTheDocument()
    expect(screen.getByText('Conversation thread')).toBeInTheDocument()
  })

  it('navigates back when clicking back button', () => {
    render(
      <MobileNavigationProvider>
        <Header />
      </MobileNavigationProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('renders Activity title for fitness dashboard without thread subtitle', () => {
    render(
      <MobileNavigationProvider>
        <Header isFitnessDashboard />
      </MobileNavigationProvider>
    )

    expect(
      screen.getByRole('heading', { name: 'Activity' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Conversation thread')).not.toBeInTheDocument()
  })
})
