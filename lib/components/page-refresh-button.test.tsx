/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { PageRefreshButton } from './page-refresh-button'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh })
}))

describe('PageRefreshButton', () => {
  beforeEach(() => {
    refresh.mockClear()
  })

  it('re-renders the page from the server when pressed', () => {
    render(<PageRefreshButton accessibleName="Refresh queues" />)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh queues' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
