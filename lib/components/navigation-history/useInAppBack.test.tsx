/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import { InAppHistoryTracker } from './InAppHistoryTracker'
import { recordNavigation, resetInAppHistory } from './inAppHistory'
import { useInAppBack } from './useInAppBack'

const mockPathname = vi.fn(() => '/@alice@example.com/1')
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ back: mockBack })
}))

const Probe = () => {
  const { canGoBack, previousPathname, goBack } = useInAppBack()
  return (
    <button
      type="button"
      onClick={goBack}
      data-previous={previousPathname ?? undefined}
    >
      {canGoBack ? 'history' : 'fallback'}
    </button>
  )
}

describe('useInAppBack', () => {
  beforeEach(() => {
    resetInAppHistory()
    mockPathname.mockReset()
    mockPathname.mockReturnValue('/@alice@example.com/1')
    mockBack.mockReset()
  })

  it('renders the fallback on the server even when the client has history', () => {
    recordNavigation('/')
    expect(renderToString(<Probe />)).toContain('fallback')
  })

  it('offers the fallback on direct entry', () => {
    render(
      <>
        <InAppHistoryTracker />
        <Probe />
      </>
    )
    expect(screen.getByRole('button')).toHaveTextContent('fallback')
    expect(screen.getByRole('button')).not.toHaveAttribute('data-previous')
  })

  it('offers history Back after an in-app navigation and calls router.back', () => {
    mockPathname.mockReturnValue('/')
    const { rerender } = render(
      <>
        <InAppHistoryTracker />
        <Probe />
      </>
    )
    expect(screen.getByRole('button')).toHaveTextContent('fallback')

    mockPathname.mockReturnValue('/@alice@example.com/1')
    rerender(
      <>
        <InAppHistoryTracker />
        <Probe />
      </>
    )
    expect(screen.getByRole('button')).toHaveTextContent('history')
    // The page it returns to, for the Back's accessible name.
    expect(screen.getByRole('button')).toHaveAttribute('data-previous', '/')

    act(() => {
      screen.getByRole('button').click()
    })
    expect(mockBack).toHaveBeenCalled()
  })

  // [Notifications, A, Profile], then a link from the Profile back to A: that
  // is a push, so `router.back()` returns to the Profile, and a browser Back
  // from there returns to A with Notifications behind it.
  it('names the page just left after a link, then follows popstate back', () => {
    // A fresh element per render: an identical one would bail out.
    const tree = () => (
      <>
        <InAppHistoryTracker />
        <Probe />
      </>
    )
    const visit = (pathname: string, pop = false) => {
      mockPathname.mockReturnValue(pathname)
      if (pop) {
        // The browser has already changed the URL when it fires `popstate`.
        window.history.pushState({}, '', pathname)
        act(() => {
          window.dispatchEvent(new PopStateEvent('popstate'))
        })
      }
      rerender(tree())
    }
    mockPathname.mockReturnValue('/notifications')
    const { rerender } = render(tree())
    visit('/a')
    visit('/profile')
    visit('/a')
    expect(screen.getByRole('button')).toHaveAttribute(
      'data-previous',
      '/profile'
    )

    visit('/profile', true)
    expect(screen.getByRole('button')).toHaveAttribute('data-previous', '/a')

    visit('/a', true)
    expect(screen.getByRole('button')).toHaveAttribute(
      'data-previous',
      '/notifications'
    )
  })

  it('stops listening for popstate when unmounted', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<InAppHistoryTracker />)
    unmount()
    expect(remove).toHaveBeenCalledWith('popstate', expect.any(Function))
    remove.mockRestore()
  })
})
