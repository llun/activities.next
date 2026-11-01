/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import * as chunkLoadRecovery from '@/lib/client/chunkLoadRecovery'
import * as clientErrorsModule from '@/lib/client/clientErrors'

import GlobalError from './global-error'

describe('app/global-error.tsx boundary', () => {
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

  it('renders the generic error page and fires handleBoundaryError with source "global-error"', () => {
    const handleBoundarySpy = vi.spyOn(chunkLoadRecovery, 'handleBoundaryError')
    const error = Object.assign(new Error('Root crashed'), { digest: 'd-root' })
    const reset = vi.fn()

    render(<GlobalError error={error} reset={reset} />)

    expect(handleBoundarySpy).toHaveBeenCalledTimes(1)
    expect(handleBoundarySpy).toHaveBeenCalledWith(error, 'global-error')
    expect(screen.getByText("Something isn't working")).toBeInTheDocument()
  })

  it('triggers the reload path when a chunk error occurs', async () => {
    const reportSpy = vi
      .spyOn(clientErrorsModule, 'reportClientError')
      .mockImplementation(() => {})
    const chunkError = new Error('Loading CSS chunk 123 failed')

    render(<GlobalError error={chunkError} reset={vi.fn()} />)

    expect(reportSpy).toHaveBeenCalledWith(chunkError, 'chunk-load')
    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })
  })
})
