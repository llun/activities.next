/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import * as chunkLoadRecovery from '@/lib/client/chunkLoadRecovery'
import * as clientErrorsModule from '@/lib/client/clientErrors'

import ErrorBoundary from './error'

describe('app/error.tsx boundary', () => {
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('renders the 500 error page and fires handleBoundaryError with source "error"', () => {
    const handleBoundarySpy = vi.spyOn(chunkLoadRecovery, 'handleBoundaryError')
    const error = Object.assign(new Error('Server crashed'), {
      digest: 'd-123'
    })
    const reset = vi.fn()

    render(<ErrorBoundary error={error} reset={reset} />)

    expect(handleBoundarySpy).toHaveBeenCalledTimes(1)
    expect(handleBoundarySpy).toHaveBeenCalledWith(error, 'error')
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('triggers the reload path when a chunk error occurs', async () => {
    const reportSpy = vi
      .spyOn(clientErrorsModule, 'reportClientError')
      .mockImplementation(() => {})
    const chunkError = new Error('Loading chunk 404 failed')

    render(<ErrorBoundary error={chunkError} reset={vi.fn()} />)

    expect(reportSpy).toHaveBeenCalledWith(chunkError, 'chunk-load')
    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })
  })
})
