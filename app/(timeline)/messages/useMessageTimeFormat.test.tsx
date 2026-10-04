/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import { withTimeZone } from '@/lib/testing/withTimeZone'

import { useMessageTimeFormat } from './useMessageTimeFormat'

// 19:05 UTC on 4 Oct is 15:05 in New York (EDT, UTC-4).
const SENT_AT = Date.parse('2026-10-04T19:05:00.000Z')

const OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
}

const Probe = () => (
  <span>{useMessageTimeFormat('MMM d, h:mm a', OPTIONS)(SENT_AT)}</span>
)

describe('useMessageTimeFormat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the server value without Intl, so it is the same in every engine', async () => {
    await withTimeZone('America/New_York', () => {
      const intl = vi.spyOn(Intl, 'DateTimeFormat')

      expect(renderToString(<Probe />)).toContain('Oct 4, 7:05 PM')
      expect(intl).not.toHaveBeenCalled()
    })
  })

  it("formats in the reader's own zone once rendered on the client", async () => {
    await withTimeZone('America/New_York', () => {
      const { result } = renderHook(() =>
        useMessageTimeFormat('MMM d, h:mm a', OPTIONS)
      )

      expect(result.current(SENT_AT)).toBe(
        new Intl.DateTimeFormat(undefined, OPTIONS).format(SENT_AT)
      )
      expect(result.current(SENT_AT)).not.toContain('7:05')
    })
  })

  it('builds the reader-locale formatter once across re-renders', async () => {
    await withTimeZone('America/New_York', () => {
      const intl = vi.spyOn(Intl, 'DateTimeFormat')
      const { result, rerender } = renderHook(() =>
        useMessageTimeFormat('MMM d, h:mm a', OPTIONS)
      )
      const first = result.current

      rerender()
      rerender()
      rerender()

      expect(result.current).toBe(first)
      expect(intl).toHaveBeenCalledTimes(1)
    })
  })
})
