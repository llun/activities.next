/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { withTimeZone } from '@/lib/testing/withTimeZone'

import { ActivityStartTime } from './ActivityStartTime'

// 23:30 on 24 Sep in New York (EDT, UTC-4) is 03:30 on 25 Sep in UTC, so the
// UTC date and the viewer's local date differ for this run.
const NEW_YORK_LATE_RUN = Date.parse('2026-09-25T03:30:00Z')

describe('ActivityStartTime', () => {
  it("shows the start in the viewer's own time zone", async () => {
    await withTimeZone('America/New_York', () => {
      render(<ActivityStartTime timestamp={NEW_YORK_LATE_RUN} />)
    })

    expect(screen.getByText('11:30 PM, September 24, 2026')).toBeInTheDocument()
  })

  it('moves the date forward for a viewer east of UTC', async () => {
    // 20:00 UTC on 24 Sep is 05:00 on 25 Sep in Tokyo (UTC+9).
    await withTimeZone('Asia/Tokyo', () => {
      render(
        <ActivityStartTime timestamp={Date.parse('2026-09-24T20:00:00Z')} />
      )
    })

    expect(screen.getByText('5:00 AM, September 25, 2026')).toBeInTheDocument()
  })

  it('carries the exact instant on the time element', () => {
    render(<ActivityStartTime timestamp={NEW_YORK_LATE_RUN} />)

    expect(screen.getByText(/2026/).closest('time')).toHaveAttribute(
      'datetime',
      '2026-09-25T03:30:00.000Z'
    )
  })

  it('hydrates the server-rendered UTC text without a mismatch, then shows local time', async () => {
    await withTimeZone('America/New_York', async () => {
      const element = <ActivityStartTime timestamp={NEW_YORK_LATE_RUN} />
      // The server cannot know the viewer's zone, so it renders UTC; the
      // hydrating client must render the same text before it switches.
      const serverHtml = renderToString(element)
      expect(serverHtml).toContain('3:30 AM, September 25, 2026')

      const container = document.createElement('div')
      container.innerHTML = serverHtml
      document.body.appendChild(container)
      const onRecoverableError = vi.fn()
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      try {
        await act(async () => {
          hydrateRoot(container, element, { onRecoverableError })
        })

        expect(onRecoverableError).not.toHaveBeenCalled()
        expect(consoleError).not.toHaveBeenCalled()
        expect(container).toHaveTextContent('11:30 PM, September 24, 2026')
      } finally {
        consoleError.mockRestore()
        container.remove()
      }
    })
  })
})
