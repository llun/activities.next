/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Sidebar } from '@/lib/components/layout/sidebar'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn()
}))

describe('Sidebar', () => {
  const push = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(usePathname as jest.Mock).mockReturnValue('/')
    ;(useRouter as jest.Mock).mockReturnValue({ push })
    ;(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams())
  })

  it('routes desktop search submissions to the search page', () => {
    render(
      <Sidebar
        user={{
          name: 'Llun',
          username: 'llun',
          handle: '@llun@activities.local'
        }}
      />
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'trail running' }
    })
    fireEvent.submit(screen.getByRole('search', { name: 'Search' }))

    expect(push).toHaveBeenCalledWith('/search?q=trail+running')
  })

  it('hydrates the desktop search input from the current search URL', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/search')
    ;(useSearchParams as jest.Mock).mockReturnValue(
      new URLSearchParams('q=trail')
    )

    render(
      <Sidebar
        user={{
          name: 'Llun',
          username: 'llun',
          handle: '@llun@activities.local'
        }}
      />
    )

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue(
      'trail'
    )
  })

  it('clears the desktop search input when the URL is not a search page', () => {
    let pathname = '/search'
    let params = new URLSearchParams('q=trail')
    ;(usePathname as jest.Mock).mockImplementation(() => pathname)
    ;(useSearchParams as jest.Mock).mockImplementation(() => params)

    const { rerender } = render(
      <Sidebar
        user={{
          name: 'Llun',
          username: 'llun',
          handle: '@llun@activities.local'
        }}
      />
    )

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue(
      'trail'
    )

    pathname = '/notifications'
    params = new URLSearchParams()
    rerender(
      <Sidebar
        user={{
          name: 'Llun',
          username: 'llun',
          handle: '@llun@activities.local'
        }}
      />
    )

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('')
  })
})
