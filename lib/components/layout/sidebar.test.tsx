/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { usePathname, useRouter } from 'next/navigation'

import { Sidebar } from '@/lib/components/layout/sidebar'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn()
}))

describe('Sidebar', () => {
  const push = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(usePathname as jest.Mock).mockReturnValue('/')
    ;(useRouter as jest.Mock).mockReturnValue({ push })
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
})
