'use client'

import { Component, ReactNode } from 'react'

import { Alert } from '@/lib/components/surface/Alert'

interface Props {
  children: ReactNode
  /** Classes for the inline message, for a spot that needs it positioned. */
  className?: string
  /**
   * The message is an overlay that leaves its row's box, so the row must not
   * clip it (see `data-row-overlay` in globals.css). Applied only while the
   * message shows.
   */
  'data-row-overlay'?: boolean
}

interface State {
  error: unknown
}

// Webpack and Turbopack name the error `ChunkLoadError`; the messages cover
// Turbopack ("Failed to load chunk"), webpack, and browser dynamic-import
// failures.
const CHUNK_LOAD_MESSAGE =
  /Loading chunk|Loading CSS chunk|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

const isChunkLoadError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  return (
    name === 'ChunkLoadError' ||
    (typeof message === 'string' && CHUNK_LOAD_MESSAGE.test(message))
  )
}

/**
 * Catches a lazily loaded chunk that fails to download (usually a deploy
 * changed its file name under an open tab) and says so inline, so the failure
 * stays with the control that needed it instead of replacing the whole route
 * with its error page. Any other render error is rethrown to the route's
 * error boundary.
 */
export class LazyChunkBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('Unknown render error') }
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    if (!isChunkLoadError(error)) throw error
    const alert = (
      <Alert title="Couldn't load" className={this.props.className}>
        Reload the page to try again.
      </Alert>
    )
    if (!this.props['data-row-overlay']) return alert
    return (
      <div className="contents" data-row-overlay>
        {alert}
      </div>
    )
  }
}
