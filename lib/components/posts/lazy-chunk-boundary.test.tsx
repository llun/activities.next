/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Suspense, lazy } from 'react'

import { LazyChunkBoundary } from './lazy-chunk-boundary'

describe('LazyChunkBoundary', () => {
  beforeEach(() => {
    // React logs the caught render error; the boundary is what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children when nothing fails', () => {
    render(
      <LazyChunkBoundary>
        <p>picker</p>
      </LazyChunkBoundary>
    )
    expect(screen.getByText('picker')).toBeInTheDocument()
  })

  it('shows an inline alert when a lazy import rejects', async () => {
    // What the App Router's `next/dynamic` is built on: the rejection surfaces
    // as a render error.
    const Lazy = lazy(() =>
      Promise.reject(new Error('Loading chunk 42 failed'))
    )
    render(
      <LazyChunkBoundary>
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      </LazyChunkBoundary>
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load")
    expect(alert).toHaveTextContent('Reload the page to try again.')
  })
})
