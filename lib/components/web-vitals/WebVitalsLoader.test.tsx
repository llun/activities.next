/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

import { WebVitalsLoader } from './WebVitalsLoader'

const mocks = vi.hoisted(() => ({
  reporterModuleLoaded: vi.fn(),
  reporter: vi.fn(() => null)
}))

vi.mock('./WebVitalsReporter', () => {
  mocks.reporterModuleLoaded()
  return {
    WebVitalsReporter: mocks.reporter
  }
})

describe('WebVitalsLoader', () => {
  beforeEach(() => {
    mocks.reporterModuleLoaded.mockClear()
    mocks.reporter.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders no server markup and does not run the reporter during SSR', () => {
    const html = renderToStaticMarkup(<WebVitalsLoader sampleRate={0.5} />)

    expect(html).toBe('')
    expect(mocks.reporterModuleLoaded).not.toHaveBeenCalled()
    expect(mocks.reporter).not.toHaveBeenCalled()
  })

  it('never imports the reporter module when roll is above the sample rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const { container } = render(<WebVitalsLoader sampleRate={0.1} />)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(container.innerHTML).toBe('')
    expect(mocks.reporterModuleLoaded).not.toHaveBeenCalled()
    expect(mocks.reporter).not.toHaveBeenCalled()
  })

  it('imports and mounts the reporter when roll is below the sample rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05)

    const { container } = render(<WebVitalsLoader sampleRate={0.1} />)

    expect(container.innerHTML).toBe('')
    await waitFor(() => {
      expect(mocks.reporter).toHaveBeenCalledTimes(1)
    })
    expect(mocks.reporterModuleLoaded).toHaveBeenCalledTimes(1)
  })

  it('rolls once per page load, not once per render', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9)

    const { rerender } = render(<WebVitalsLoader sampleRate={0.5} />)
    rerender(<WebVitalsLoader sampleRate={0.5} />)

    expect(random).toHaveBeenCalledTimes(1)
  })
})
