/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { CollapsibleContent } from './collapsible-content'

const COLLAPSED_HEIGHT_REM = `${5 * 1.4375}rem`

let resizeObserverInstances: ResizeObserverMock[] = []
let originalResizeObserver: unknown
let originalScrollHeightDescriptor: PropertyDescriptor | undefined

class ResizeObserverMock {
  observedElements: Element[] = []

  constructor(
    private readonly callback: (entries: never[], observer: unknown) => void
  ) {
    resizeObserverInstances.push(this)
  }

  observe = vi.fn((element: Element) => {
    this.observedElements.push(element)
  })

  disconnect = vi.fn()

  trigger() {
    this.callback([], this)
  }
}

describe('CollapsibleContent', () => {
  beforeEach(() => {
    resizeObserverInstances = []
    originalResizeObserver = global.ResizeObserver
    originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    )
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

  afterEach(() => {
    if (originalResizeObserver) {
      Object.defineProperty(global, 'ResizeObserver', {
        configurable: true,
        value: originalResizeObserver
      })
    } else {
      Reflect.deleteProperty(global, 'ResizeObserver')
    }

    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeightDescriptor
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
    }
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

    const button = screen.getByRole('button', { name: 'Show more content' })
    const content = document.getElementById(
      button.getAttribute('aria-controls')!
    )

    expect(content).toHaveClass('overflow-hidden')
    expect(content?.style.height).toBe(COLLAPSED_HEIGHT_REM)
    expect(content?.style.maxHeight).toBe('')
  })

  it('observes natural content size while the collapsed container has fixed height', async () => {
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

    const button = screen.getByRole('button', { name: 'Show more content' })
    const collapsedContainer = document.getElementById(
      button.getAttribute('aria-controls')!
    )
    const observedElements = resizeObserverInstances.flatMap(
      (instance) => instance.observedElements
    )

    expect(observedElements).not.toContain(collapsedContainer)
    expect(
      observedElements.some((element) =>
        element.textContent?.includes(
          'Long status content that exceeds the timeline line limit.'
        )
      )
    ).toBe(true)
  })

  it('applies caller-provided content classes to the measured wrapper', async () => {
    render(
      <CollapsibleContent
        className="mt-1 text-sm leading-relaxed break-words"
        contentClassName="markdown-content"
        maxLines={5}
      >
        <p>Long status content that exceeds the timeline line limit.</p>
      </CollapsibleContent>
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show more content' })
      ).toBeInTheDocument()
    })

    const observedElements = resizeObserverInstances.flatMap(
      (instance) => instance.observedElements
    )
    const button = screen.getByRole('button', { name: 'Show more content' })
    const collapsedContainer = document.getElementById(
      button.getAttribute('aria-controls')!
    )
    const measuredMarkdownContent = observedElements.find((element) =>
      element.classList.contains('markdown-content')
    )

    expect(collapsedContainer).not.toHaveClass('markdown-content')
    expect(measuredMarkdownContent).toBeDefined()
    expect(
      measuredMarkdownContent?.querySelector(':scope > p')
    ).toHaveTextContent(
      'Long status content that exceeds the timeline line limit.'
    )
  })
})
