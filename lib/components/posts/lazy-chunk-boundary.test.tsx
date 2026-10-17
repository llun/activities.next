/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Component, ReactNode, Suspense, lazy } from 'react'

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

  it('shows the alert for a ChunkLoadError by name', async () => {
    const error = new Error('boom')
    error.name = 'ChunkLoadError'
    const Lazy = lazy(() => Promise.reject(error))
    render(
      <LazyChunkBoundary>
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      </LazyChunkBoundary>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load")
  })

  it('rethrows an ordinary render error to the outer boundary', () => {
    class Outer extends Component<{ children: ReactNode }, { error?: Error }> {
      state: { error?: Error } = {}
      static getDerivedStateFromError(error: Error) {
        return { error }
      }
      render() {
        return this.state.error ? (
          <p data-testid="outer">{this.state.error.message}</p>
        ) : (
          this.props.children
        )
      }
    }
    const Broken = () => {
      throw new Error('real bug')
    }
    render(
      <Outer>
        <LazyChunkBoundary>
          <Broken />
        </LazyChunkBoundary>
      </Outer>
    )
    expect(screen.getByTestId('outer')).toHaveTextContent('real bug')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
