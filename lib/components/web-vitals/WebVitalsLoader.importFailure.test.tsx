/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react'

import { WebVitalsLoader } from './WebVitalsLoader'

const factory = vi.hoisted(() => vi.fn())

// A factory that throws makes `import('./WebVitalsReporter')` reject, like a
// chunk that fails to download. Kept apart from WebVitalsLoader.test.tsx,
// whose module mock loads the reporter successfully.
vi.mock('./WebVitalsReporter', () => {
  factory()
  throw new Error('chunk load failed')
})

describe('WebVitalsLoader when the reporter import fails', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing and raises no unhandled rejection', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      const { container } = render(<WebVitalsLoader sampleRate={1} />)
      // The factory runs only when the dynamic import is attempted; then let
      // the rejection settle through the loader's handlers.
      await waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(container.innerHTML).toBe('')
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })
})
