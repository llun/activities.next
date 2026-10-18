/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'

import { WebVitalsReporter } from './WebVitalsReporter'

const mocks = vi.hoisted(() => ({
  useReportWebVitals: vi.fn(),
  send: vi.fn()
}))

vi.mock('next/web-vitals', () => ({
  useReportWebVitals: mocks.useReportWebVitals
}))

vi.mock('@/lib/client/webVitals', () => ({
  sendWebVitalsReport: mocks.send
}))

describe('WebVitalsReporter', () => {
  beforeEach(() => {
    mocks.useReportWebVitals.mockClear()
    mocks.send.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing and registers web vitals reporting', () => {
    const { container } = render(<WebVitalsReporter />)

    expect(mocks.useReportWebVitals).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
  })

  it('sends what web-vitals reports when the page is hidden', () => {
    render(<WebVitalsReporter />)
    const handler = mocks.useReportWebVitals.mock.calls[0][0]

    handler({
      id: 'v5-1',
      name: 'LCP',
      value: 2400.6,
      rating: 'needs-improvement',
      navigationType: 'navigate',
      navigationURL: 'http://localhost:3000/@alice@example.com/abc123'
    })
    window.dispatchEvent(new Event('pagehide'))

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith({
      metrics: [
        {
          name: 'LCP',
          value: 2401,
          rating: 'needs-improvement',
          navigationType: 'navigate',
          route: '/[actor]/[status]',
          device: expect.stringMatching(/^(mobile|tablet|desktop)$/)
        }
      ]
    })
  })

  it('stops listening when unmounted', () => {
    const { unmount } = render(<WebVitalsReporter />)
    const handler = mocks.useReportWebVitals.mock.calls[0][0]

    unmount()
    handler({ id: 'a', name: 'LCP', value: 1, rating: 'good' })
    window.dispatchEvent(new Event('pagehide'))

    expect(mocks.send).not.toHaveBeenCalled()
  })
})
