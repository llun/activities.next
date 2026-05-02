/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { CollapsibleContent } from './collapsible-content'

const COLLAPSED_HEIGHT_REM = `${5 * 1.4375}rem`

class ResizeObserverMock {
  observe = jest.fn()
  disconnect = jest.fn()
}

describe('CollapsibleContent', () => {
  beforeEach(() => {
    document.documentElement.style.fontSize = '16px'

    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock
    })

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 300
    })
  })

  it('uses a fixed collapsed layout height for overflowing content', async () => {
    render(
      <CollapsibleContent maxLines={5}>
        Long status content that exceeds the timeline line limit.
      </CollapsibleContent>
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show more content' })
      ).toBeInTheDocument()
    })

    const content = screen.getByText(
      'Long status content that exceeds the timeline line limit.'
    )
    expect(content).toHaveClass('overflow-hidden')
    expect(content.style.height).toBe(COLLAPSED_HEIGHT_REM)
    expect(content.style.maxHeight).toBe('')
  })
})
