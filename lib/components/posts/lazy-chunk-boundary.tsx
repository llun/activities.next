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
  hasFailed: boolean
}

/**
 * Catches a lazily loaded chunk that fails to download (usually a deploy
 * changed its file name under an open tab) and says so inline, so the failure
 * stays with the control that needed it instead of replacing the whole route
 * with its error page.
 */
export class LazyChunkBoundary extends Component<Props, State> {
  state: State = { hasFailed: false }

  static getDerivedStateFromError(): State {
    return { hasFailed: true }
  }

  render() {
    if (!this.state.hasFailed) return this.props.children
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
