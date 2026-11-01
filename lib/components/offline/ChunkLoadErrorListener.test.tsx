/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'

import * as clientErrorsModule from '@/lib/client/clientErrors'

import { ChunkLoadErrorListener } from './ChunkLoadErrorListener'

describe('ChunkLoadErrorListener', () => {
  let reportSpy: ReturnType<typeof vi.spyOn>
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
    reportSpy = vi
      .spyOn(clientErrorsModule, 'reportClientError')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('reports window error event when it is a chunk load error and never reloads', () => {
    render(<ChunkLoadErrorListener />)

    const chunkErr = new Error('Loading chunk 101 failed')
    const event = new ErrorEvent('error', {
      error: chunkErr,
      message: chunkErr.message
    })
    window.dispatchEvent(event)

    expect(reportSpy).toHaveBeenCalledTimes(1)
    expect(reportSpy).toHaveBeenCalledWith(chunkErr, 'chunk-load')
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('reports window unhandledrejection event when it is a chunk load error and never reloads', () => {
    render(<ChunkLoadErrorListener />)

    const chunkErr = new Error(
      'Failed to fetch dynamically imported module: /app.js'
    )
    const event = new PromiseRejectionEvent('unhandledrejection', {
      reason: chunkErr,
      promise: Promise.resolve()
    })
    window.dispatchEvent(event)

    expect(reportSpy).toHaveBeenCalledTimes(1)
    expect(reportSpy).toHaveBeenCalledWith(chunkErr, 'chunk-load')
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('ignores non-chunk errors from window error and unhandledrejection events', () => {
    render(<ChunkLoadErrorListener />)

    const normalErr = new TypeError('Cannot read property of undefined')
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: normalErr,
        message: normalErr.message
      })
    )

    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        reason: new Error('Network error'),
        promise: Promise.resolve()
      })
    )

    expect(reportSpy).not.toHaveBeenCalled()
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('removes window listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<ChunkLoadErrorListener />)

    const errorListener = addSpy.mock.calls.find(
      (call) => call[0] === 'error'
    )?.[1]
    const rejectionListener = addSpy.mock.calls.find(
      (call) => call[0] === 'unhandledrejection'
    )?.[1]

    expect(errorListener).toBeDefined()
    expect(rejectionListener).toBeDefined()

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('error', errorListener)
    expect(removeSpy).toHaveBeenCalledWith(
      'unhandledrejection',
      rejectionListener
    )
  })
})
