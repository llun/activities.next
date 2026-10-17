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

  it.each([
    [0.1, 0.05, true],
    [0.1, 0.1, false],
    [0.1, 0.5, false],
    [1, 0.999, true],
    [0, 0, false]
  ])(
    'with a rate of %s and a roll of %s, reports: %s',
    (rate, roll, reports) => {
      vi.spyOn(Math, 'random').mockReturnValue(roll)

      const { container } = render(<WebVitalsReporter sampleRate={rate} />)

      expect(mocks.useReportWebVitals).toHaveBeenCalledTimes(reports ? 1 : 0)
      expect(container.innerHTML).toBe('')
    }
  )

  it('rolls once per page load, not once per render', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01)

    const { rerender } = render(<WebVitalsReporter sampleRate={0.5} />)
    rerender(<WebVitalsReporter sampleRate={0.5} />)

    expect(random).toHaveBeenCalledTimes(1)
  })

  it('sends what web-vitals reports when the page is hidden', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<WebVitalsReporter sampleRate={1} />)
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
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { unmount } = render(<WebVitalsReporter sampleRate={1} />)
    const handler = mocks.useReportWebVitals.mock.calls[0][0]

    unmount()
    handler({ id: 'a', name: 'LCP', value: 1, rating: 'good' })
    window.dispatchEvent(new Event('pagehide'))

    expect(mocks.send).not.toHaveBeenCalled()
  })
})
