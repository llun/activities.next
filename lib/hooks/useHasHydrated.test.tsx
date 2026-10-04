/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

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
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Probe />)
    document.body.appendChild(container)
    const onRecoverableError = vi.fn()

    try {
      await act(async () => {
        hydrateRoot(container, <Probe />, { onRecoverableError })
      })

      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container).toHaveTextContent('client')
    } finally {
      container.remove()
    }
  })
})
