/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'

import { WebVitalsLoader } from './WebVitalsLoader'

// A factory that throws makes `import('./WebVitalsReporter')` reject, like a
// chunk that fails to download. Kept apart from WebVitalsLoader.test.tsx,
// whose module mock loads the reporter successfully.
vi.mock('./WebVitalsReporter', () => {
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
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(container.innerHTML).toBe('')
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })
})
