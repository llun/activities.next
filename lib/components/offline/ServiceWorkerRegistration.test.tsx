/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceWorkerRegistration } from '@/lib/components/offline/ServiceWorkerRegistration'

describe('ServiceWorkerRegistration', () => {
  const originalServiceWorker = navigator.serviceWorker

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      configurable: true,
      writable: true
    })
  })

  it('registers /sw.js with scope / on mount', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined)
    const mockRegister = vi.fn().mockResolvedValue({
      update: mockUpdate
    })

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: mockRegister
      },
      configurable: true,
      writable: true
    })

    render(<ServiceWorkerRegistration />)

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' })
      expect(mockUpdate).toHaveBeenCalled()
    })
  })

  it('handles missing serviceWorker in navigator cleanly', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
      writable: true
    })

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow()
  })

  it('catches registration errors cleanly without throwing', async () => {
    const mockRegister = vi
      .fn()
      .mockRejectedValue(new Error('Registration failed'))

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: mockRegister
      },
      configurable: true,
      writable: true
    })

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow()
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalled()
    })
  })
})
