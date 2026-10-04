/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'

import { useHasHydrated } from './useHasHydrated'

const Probe = () => <span>{useHasHydrated() ? 'client' : 'server'}</span>

describe('useHasHydrated', () => {
  it('is false while rendering on the server', () => {
    expect(renderToString(<Probe />)).toContain('server')
  })

  it('is true for a component first rendered on the client', () => {
    render(<Probe />)

    expect(screen.getByText('client')).toBeInTheDocument()
  })

  it('hydrates as false without a mismatch, then turns true', async () => {
    const { container, onRecoverableError, unmount } = await hydrateServerHtml(
      <Probe />
    )

    try {
      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container).toHaveTextContent('client')
    } finally {
      unmount()
    }
  })
})
