/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  getConnectionSnapshot,
  probeNow,
  resetConnectionForTesting
} from '@/lib/client/connection'
import { checkServerHealth } from '@/lib/client/health'

import { TimelineGapRow } from './TimelineGapRow'

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

const mockHealth = vi.mocked(checkServerHealth)

describe('TimelineGapRow', () => {
  beforeEach(() => {
    resetConnectionForTesting()
    mockHealth.mockReset()
  })

  afterEach(() => {
    resetConnectionForTesting()
    vi.restoreAllMocks()
  })

  it('renders load missing posts button and triggers callback', () => {
    const onLoadGap = vi.fn()
    render(<TimelineGapRow segmentIndex={1} onLoadGap={onLoadGap} />)

    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'false')

    fireEvent.click(button)
    expect(onLoadGap).toHaveBeenCalledWith(1)
  })

  it('disables button and adds spinning animation when isLoading is true', () => {
    const onLoadGap = vi.fn()
    const { container } = render(
      <TimelineGapRow segmentIndex={0} isLoading onLoadGap={onLoadGap} />
    )

    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('animate-spin')

    fireEvent.click(button)
    expect(onLoadGap).not.toHaveBeenCalled()
  })

  it('disables the button while the connection store says offline, and enables it again on recovery', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<TimelineGapRow segmentIndex={2} onLoadGap={vi.fn()} />)
    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).not.toBeDisabled()

    await act(async () => {
      await probeNow()
    })
    expect(button).toBeDisabled()

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mockHealth.mockResolvedValue(true)
    await act(async () => {
      await probeNow()
    })
    expect(button).not.toBeDisabled()
  })

  it('stays enabled when the server is unreachable, because the status slot has Retry', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mockHealth.mockResolvedValue(false)
    render(<TimelineGapRow segmentIndex={2} onLoadGap={vi.fn()} />)

    await act(async () => {
      await probeNow()
    })

    expect(getConnectionSnapshot().state).toBe('unreachable')
    expect(
      screen.getByRole('button', { name: /load missing posts/i })
    ).not.toBeDisabled()
  })

  it('ignores a bare browser offline event until the probe confirms it', () => {
    mockHealth.mockReturnValue(new Promise(() => {}))
    render(<TimelineGapRow segmentIndex={2} onLoadGap={vi.fn()} />)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(
      screen.getByRole('button', { name: /load missing posts/i })
    ).not.toBeDisabled()
  })
})
